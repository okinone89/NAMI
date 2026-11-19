"""Run after dotnet build src/Nami.Api. PostgreSQL server tools must be on PATH."""
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


@contextmanager
def running_api(directory, settings, executable=API / "bin/Debug/net10.0/Nami.Api.dll"):
    with (directory / "api.log").open("w+") as log:
        process = subprocess.Popen(
            ["dotnet", str(executable), "--urls", "http://127.0.0.1:0"],
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


def check_startup(directory, settings):
    with running_api(directory, settings) as address:
        with urlopen(address + "/health", timeout=5) as response:
            if response.status != 200 or json.load(response) != {"status": "ready"}:
                raise AssertionError("Unexpected readiness response")


class DatabaseStartup(unittest.TestCase):
    def exercise(self, directory, settings, sql):
        check_startup(directory, settings)
        self.assertEqual(sql("SELECT max(version) FROM nami_migrations"), "2")
        sql("INSERT INTO plans (id, name) VALUES ('line-1', 'Assembly')")
        check_startup(directory, settings)
        self.assertEqual(sql("SELECT name FROM plans WHERE id='line-1'"), "Assembly")

        # Restore the original v1 schema in this disposable database.
        sql("DROP TABLE plans")
        sql("DROP TABLE nami_migrations")
        sql("CREATE TABLE nami_migrations (version INTEGER PRIMARY KEY)")
        sql("INSERT INTO nami_migrations VALUES (1)")
        sql("CREATE TABLE plans (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL)")
        sql("INSERT INTO plans VALUES ('line-1', 'Assembly')")
        check_startup(directory, settings)
        self.assertEqual(sql("SELECT max(version) FROM nami_migrations"), "2")
        self.assertEqual(sql("SELECT name FROM plans WHERE id='line-1'"), "Assembly")
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
            cluster = str(directory / "cluster")
            subprocess.run(["initdb", "-D", cluster, "-U", "nami", "-A", "trust",
                            "--no-locale"], check=True, stdout=subprocess.DEVNULL)
            subprocess.run(["pg_ctl", "-D", cluster, "-l", str(directory / "pg.log"),
                            "-o", f"-k '{tmp}' -c listen_addresses='' -p 5432", "-w", "start"],
                           check=True, stdout=subprocess.DEVNULL)
            try:
                def sql(statement):
                    return subprocess.check_output(
                        ["psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-h", tmp, "-p", "5432",
                         "-U", "nami", "-d", "postgres", "-c", statement], text=True).strip()

                self.exercise(directory, {"Database__Provider": "PostgreSQL",
                              "ConnectionStrings__Nami": f"Host={tmp};Port=5432;Database=postgres;Username=nami"}, sql)
            finally:
                subprocess.run(["pg_ctl", "-D", cluster, "-m", "fast", "-w", "stop"], check=True)


if __name__ == "__main__":
    unittest.main()
