"""Run after dotnet build tests/PlanPersistence. PostgreSQL server tools must be on PATH."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import time
import unittest
from urllib.request import urlopen

API = Path(__file__).resolve().parents[1] / "src/Nami.Api"
API_DLL = API / "bin/Debug/net10.0/Nami.Api.dll"


@contextmanager
def running_api(directory, settings, executable=API_DLL, *, args=()):
    with (directory / "api.log").open("w+") as log:
        process = subprocess.Popen(
            ["dotnet", str(executable), "--urls", "http://127.0.0.1:0", *args],
            cwd=API, env={**os.environ, **settings,
                          "Logging__LogLevel__Microsoft.Hosting.Lifetime": "Information"},
            stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            for _ in range(200):
                output = (directory / "api.log").read_text()
                if process.poll() is not None:
                    raise AssertionError(output)
                address = re.search(r"Now listening on: (http://127\.0\.0\.1:\d+)", output)
                if address:
                    yield address[1]
                    return
                time.sleep(0.05)
            raise AssertionError("API startup timed out: " + output)
        finally:
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=10)


@contextmanager
def postgres_settings(directory):
    cluster = str(directory / "cluster")
    subprocess.run(["initdb", "-D", cluster, "-U", "nami", "-A", "trust",
                    "--no-locale"], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["pg_ctl", "-D", cluster, "-l", str(directory / "pg.log"),
                    "-o", f"-k '{directory}' -c listen_addresses='' -p 5432", "-w", "start"],
                   check=True, stdout=subprocess.DEVNULL)
    try:
        yield {"Database__Provider": "PostgreSQL",
               "ConnectionStrings__Nami": f"Host={directory};Port=5432;Database=postgres;Username=nami"}
    finally:
        subprocess.run(["pg_ctl", "-D", cluster, "-m", "fast", "-w", "stop"], check=True,
                       stdout=subprocess.DEVNULL)


def check_startup(directory, settings):
    with running_api(directory, settings) as address:
        with urlopen(address + "/health", timeout=5) as response:
            if response.status != 200 or json.load(response) != {"status": "ready"}:
                raise AssertionError("Unexpected readiness response")


def run_plan_test(settings, phase, *arguments):
    executable = API.parents[1] / "tests/PlanPersistence/bin/Debug/net10.0/PlanPersistence.dll"
    return subprocess.check_output(
        ["dotnet", str(executable), phase, *arguments],
        cwd=API, env={**os.environ, **settings}, text=True, timeout=30,
    )


class DatabaseStartup(unittest.TestCase):
    def exercise(self, directory, settings, sql):
        check_startup(directory, settings)
        self.assertEqual(sql("SELECT max(version) FROM nami_migrations"), "4")
        plan_ids = run_plan_test(settings, "create").splitlines()
        check_startup(directory, settings)
        run_plan_test(settings, "reload", *plan_ids)
        check_startup(directory, settings)
        run_plan_test(settings, "verify-edits", *plan_ids)

        # Restore the original v1 schema in this disposable database.
        sql("DROP TABLE plans")
        sql("DROP TABLE nami_migrations")
        sql("CREATE TABLE nami_migrations (version INTEGER PRIMARY KEY)")
        sql("INSERT INTO nami_migrations VALUES (1)")
        sql("CREATE TABLE plans (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL)")
        sql("INSERT INTO plans VALUES ('line-1', 'Assembly')")
        check_startup(directory, settings)
        self.assertEqual(sql("SELECT max(version) FROM nami_migrations"), "4")
        self.assertEqual(sql("SELECT name FROM plans WHERE id='line-1'"), "Assembly")
        run_plan_test(settings, "legacy", "line-1")
        sql("DROP INDEX plans_name_idx")  # The upgrade physically recreated the index.

    def test_sqlite(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "custom" / "plan.db"

            def sql(statement):
                with sqlite3.connect(path) as connection:
                    row = connection.execute(statement).fetchone()
                    return str(row[0]) if row else ""

            self.exercise(Path(tmp), {"Database__Provider": "SQLite",
                                      "Database__File": str(path)}, sql)

    def test_postgresql(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with postgres_settings(directory) as settings:
                def sql(statement):
                    return subprocess.check_output(
                        ["psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-h", tmp, "-p", "5432",
                         "-U", "nami", "-d", "postgres", "-c", statement], text=True).strip()

                self.exercise(directory, settings, sql)


class DatabaseSetup(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.content = Path(directory.name)
        self.args = ("--contentRoot", str(self.content))
        self.saved = self.content / "data/database-settings.json"

    def setup_database(self, answers, settings=None, args=()):
        result = subprocess.run(
            ["dotnet", str(API_DLL), "--setup", *self.args, *args], cwd=API,
            env={**os.environ, **(settings or {})}, input="\n".join([*answers, ""]),
            text=True, capture_output=True, timeout=30,
        )
        return result

    def plans(self, settings=None, args=()):
        with running_api(self.content, settings or {}, args=(*self.args, *args)) as address:
            with urlopen(address + "/api/plans", timeout=5) as response:
                return json.load(response)

    def test_sqlite_setup_creates_and_reopens_a_selected_file(self):
        file = self.content / "custom path/plans.db"
        first_setup = self.setup_database(["1", "custom path/plans.db", "y"])
        self.assertEqual(first_setup.returncode, 0, first_setup.stderr)
        with sqlite3.connect(file) as database:
            database.execute("INSERT INTO plans (id, name) VALUES ('line-1', 'Assembly')")

        existing_setup = self.setup_database(["1", str(file), "y"])
        self.assertEqual(existing_setup.returncode, 0, existing_setup.stderr)
        self.assertEqual(self.plans(), [{"id": "line-1", "name": "Assembly"}])

        switch = self.setup_database(["1", "another.db", "y"])
        self.assertEqual(switch.returncode, 0, switch.stderr)
        self.assertEqual(self.plans(), [])
        with sqlite3.connect(file) as database:
            self.assertEqual(database.execute("SELECT name FROM plans").fetchone(), ("Assembly",))

    def test_saved_database_yields_to_environment_and_command_line(self):
        override = {"Database__File": str(self.content / "environment.db")}
        cli = ("--Database:File", str(self.content / "command.db"))
        setup = self.setup_database(["1", "saved.db", "y"], override, cli)
        self.assertEqual(setup.returncode, 0, setup.stderr)
        self.assertIn("Deployment settings will take priority at startup: Database:File.", setup.stdout)
        with sqlite3.connect(self.content / "saved.db") as database:
            database.execute("INSERT INTO plans (id, name) VALUES ('saved', 'Saved plan')")

        self.assertEqual(self.plans(override), [])
        with sqlite3.connect(override["Database__File"]) as database:
            database.execute("INSERT INTO plans (id, name) VALUES ('env', 'Environment plan')")
        self.assertEqual(self.plans(override), [{"id": "env", "name": "Environment plan"}])
        self.assertEqual(self.plans(override, cli), [])
        self.assertTrue((self.content / "command.db").is_file())
        self.assertEqual(self.plans(), [{"id": "saved", "name": "Saved plan"}])

    def test_cancelled_or_failed_setup_preserves_the_saved_selection(self):
        first_setup = self.setup_database(["1", "saved.db", "y"])
        self.assertEqual(first_setup.returncode, 0, first_setup.stderr)
        original = self.saved.read_bytes()

        cancelled = self.setup_database(["1", "cancelled.db", "n"])
        self.assertEqual(cancelled.returncode, 0, cancelled.stderr)
        self.assertIn("Database setup cancelled", cancelled.stdout)
        self.assertFalse((self.content / "cancelled.db").exists())
        self.assertEqual(self.saved.read_bytes(), original)

        (self.content / "invalid.db").write_text("This file is not a SQLite database.")
        failed = self.setup_database(["1", "invalid.db", "y"])
        self.assertEqual(failed.returncode, 1, failed.stdout)
        self.assertIn("Database setup failed", failed.stderr)
        self.assertEqual(self.saved.read_bytes(), original)

    def test_postgresql_setup_uses_a_named_schema_and_password_file(self):
        with postgres_settings(self.content):
            def sql(statement):
                return subprocess.check_output(
                    ["psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-h", str(self.content),
                     "-p", "5432", "-U", "nami", "-d", "postgres", "-c", statement], text=True).strip()

            password = "disposable-integration-password"
            sql(f"CREATE ROLE setup_user LOGIN PASSWORD '{password}'; "
                "GRANT CREATE ON DATABASE postgres TO setup_user")
            pg_hba = self.content / "cluster/pg_hba.conf"
            pg_hba.write_text("local postgres setup_user scram-sha-256\n" + pg_hba.read_text())
            subprocess.run(["pg_ctl", "-D", str(pg_hba.parent), "reload"], check=True,
                           stdout=subprocess.DEVNULL)
            passfile = self.content / "passwords"
            passfile.touch(mode=0o600)
            passfile.write_text(f"*:5432:postgres:setup_user:{password}\n")
            credentials = {"PGPASSFILE": str(passfile)}

            setup = self.setup_database(["2", str(self.content), "", "postgres", "setup_user", "NAMI, Plans", "y"],
                                        credentials)
            self.assertEqual(setup.returncode, 0, setup.stderr)
            self.assertNotIn(password, self.saved.read_text())
            self.assertEqual(sql('SELECT max(version) FROM "NAMI, Plans".nami_migrations'), "4")
            self.assertEqual(sql("SELECT to_regclass('public.plans') IS NULL"), "t")
            sql('INSERT INTO "NAMI, Plans".plans (id, name) VALUES (\'line-1\', \'Packaging\')')
            self.assertEqual(self.plans(credentials), [{"id": "line-1", "name": "Packaging"}])

            default_setup = self.setup_database(["2", str(self.content), "", "postgres", "setup_user", "", "y"],
                                                credentials)
            self.assertEqual(default_setup.returncode, 0, default_setup.stderr)
            self.assertEqual(sql("SELECT max(version) FROM nami.nami_migrations"), "4")
            self.assertEqual(self.plans(credentials), [])


if __name__ == "__main__":
    unittest.main()
