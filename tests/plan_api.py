"""Exercise plan management through the HTTP API on both providers."""
from concurrent.futures import ThreadPoolExecutor, wait
from contextlib import closing
from pathlib import Path
import json
import sqlite3
from tempfile import TemporaryDirectory
import unittest

from editor_sessions import PASSWORD, SESSION, create_password, request, settings_for
from startup import postgres_settings, running_api


class PlanManagement(unittest.TestCase):
    def test_editors_create_plans_that_anyone_can_reopen(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            with running_api(directory, settings) as address:
                self.assertEqual(request(address, "/api/plans")[:2], (200, []))
                name = {"name": "Assembly line"}
                self.assertEqual(request(address, "/api/plans", "POST", name)[0], 401)
                cookie = unlock(address)
                status, plan, headers = request(address, "/api/plans", "POST", name, cookie)
                self.assertEqual(status, 201)
                path = f"/api/plans/{plan['id']}"
                self.assertEqual(headers["Location"], path)
                self.assertEqual(plan["revision"], 0)

            with running_api(directory, settings) as address:
                self.assertEqual(request(address, "/api/plans")[:2],
                                 (200, [{"id": plan["id"], **name}]))
                self.assertEqual(request(address, path)[:2], (200, plan))
                self.assertEqual(request(address, "/api/plans/missing")[0], 404)

    def test_topology_updates_persist_on_sqlite(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            self.exercise_topology_updates(directory, settings_for(directory))

    def test_topology_updates_persist_on_postgresql(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with postgres_settings(directory) as postgres:
                self.exercise_topology_updates(directory, {**settings_for(directory), **postgres})

    def test_inventory_names_are_unique_within_their_owner(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                _, plan, headers = request(address, "/api/plans", "POST", {"name": "Assembly"}, cookie)
                path = headers["Location"]
                plan.update(
                    networks=[{"id": "a", "name": "Cell A", "subnet": "10.0.0.0/24"},
                              {"id": "b", "name": "Cell B", "subnet": "10.0.0.0/24"}],
                    components=[{"id": "east", "name": "East", "type": "Switch"},
                                {"id": "west", "name": "West", "type": "Switch"}],
                    interfaces=[{"id": "e8", "componentId": "east", "name": "P08",
                                 "networkId": "a", "ipv4": "10.0.0.8"},
                                {"id": "w8", "componentId": "west", "name": "P08",
                                 "networkId": "b", "ipv4": "10.0.0.8"}])
                status, saved, _ = request(address, path, "PUT", plan, cookie)
                self.assertEqual(status, 200)
                for field, name, owner, items in (
                    ("components", " East ", "Assembly", [saved["components"][0], {**saved["components"][1], "name": " eAsT "}]),
                    ("networks", "Cell A", "Assembly", [*saved["networks"], {"id": "c", "name": " cell a "}]),
                    ("interfaces", "P08", "East", [*saved["interfaces"], {"id": "second", "componentId": "east", "name": " p08 "}]),
                ):
                    with self.subTest(field=field):
                        status, error, _ = request(address, path, "PUT", {**saved, field: items}, cookie)
                        self.assertEqual(status, 400)
                        self.assertIn(name.strip().lower(), error["title"].lower())
                        self.assertIn(owner, error["title"])
                self.assertEqual(request(address, path)[:2], (200, saved))

    def test_existing_duplicate_names_can_be_reopened_edited_and_resolved(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            with running_api(directory, settings) as address:
                cookie = unlock(address)
                _, plan, headers = request(address, "/api/plans", "POST", {"name": "Assembly"}, cookie)
                path = headers["Location"]
                plan["components"] = [{"id": "east", "name": "Pump", "type": "PLC"},
                                      {"id": "west", "name": " pump ", "type": "PLC"}]
                seed_legacy_topology(settings, plan)
                status, opened, _ = request(address, path)
                self.assertEqual(status, 200)
                self.assertEqual([c["name"] for c in opened["components"]], ["Pump", " pump "])
                status, saved, _ = request(address, path, "PUT", {**opened, "name": "New line"}, cookie)
                self.assertEqual(status, 200)
                third = {"id": "third", "name": "PUMP", "type": "PLC"}
                self.assertEqual(request(address, path, "PUT", {**saved, "components": [*saved["components"], third]}, cookie)[0], 400)
                saved["components"][1]["name"] = "West pump"
                self.assertEqual(request(address, path, "PUT", saved, cookie)[0], 200)
                self.assertEqual([c["name"] for c in request(address, path)[1]["components"]], ["Pump", "West pump"])

    def test_sqlite_saves_both_plans_when_a_reader_delays_commit(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            with running_api(directory, settings) as address, ThreadPoolExecutor(2) as editors:
                cookie = unlock(address)
                edits = []
                for name in ("Packaging", "Assembly"):
                    status, plan, headers = request(address, "/api/plans", "POST", {"name": name}, cookie)
                    self.assertEqual(status, 201)
                    edits.append((headers["Location"], {**plan, "name": f"{name} revised"}))

                # A separate reader holds a shared lock while the HTTP saves reach their commits.
                with closing(sqlite3.connect(settings["Database__File"])) as reader:
                    reader.execute("BEGIN")
                    self.assertEqual(reader.execute("SELECT COUNT(*) FROM plans").fetchone(), (2,))
                    pending = [editors.submit(request, address, path, "PUT", edit, cookie)
                               for path, edit in edits]
                    wait(pending, timeout=0.75)
                    reader.rollback()

                for (path, edit), pending_save in zip(edits, pending):
                    status, saved, _ = pending_save.result()
                    log = (directory / "api.log").read_text()
                    locked = "SQLite Error 5: 'database is locked'" in log
                    self.assertEqual(status, 200, f"SQLite reported a locked database: {locked}")
                    self.assertEqual(saved, {**edit, "revision": 1})
                    self.assertEqual(request(address, path)[:2], (200, saved))

    def exercise_topology_updates(self, directory, settings):
        with running_api(directory, settings) as address:
            cookie = unlock(address)
            _, plan, headers = request(address, "/api/plans", "POST", {"name": "Packaging"}, cookie)
            path = headers["Location"]
            plan.update(
                networks=[{"id": "plant", "name": "Plant"}, {"id": "controls", "name": "Controls"}],
                components=[{"id": "host-a", "name": "Server A", "type": "server"},
                            {"id": "host-b", "name": "Server B", "type": "server"},
                            {"id": "switch", "name": "Switch", "type": "switch"},
                            {"id": "vm", "name": "Runtime", "type": "vm", "hostId": "host-a"}],
                interfaces=[{"id": "a-eth0", "componentId": "host-a", "name": "eth0",
                             "networkId": "plant", "ipv4": "10.50.0.12"},
                            {"id": "a-eth1", "componentId": "host-a", "name": "eth1",
                             "networkId": "controls", "ipv4": "10.51.0.12"},
                            {"id": "port-1", "componentId": "switch", "name": "Port 1",
                             "networkId": "plant"},
                            {"id": "vm-eth0", "componentId": "vm", "name": "eth0",
                             "networkId": "plant", "ipv4": "10.50.0.34"}],
                links=[{"id": "server-uplink", "source": {"componentId": "host-a", "interfaceId": "a-eth0"},
                        "target": {"componentId": "switch", "interfaceId": "port-1"}, "medium": "wired"}],
            )
            self.assertEqual(request(address, path, "PUT", plan)[0], 401)
            status, saved, _ = request(address, path, "PUT", plan, cookie)
            self.assertEqual(status, 200)
            self.assertEqual(saved["revision"], 1)
            self.assertEqual(saved["links"][0]["medium"], "wired")

        with running_api(directory, settings) as address:
            self.assertEqual(request(address, path)[:2], (200, saved))
            cookie = unlock(address)
            saved["networks"][0]["name"] = "Plant Backbone"
            saved["components"][3]["hostId"] = "host-b"
            saved["interfaces"][1]["ipv4"] = "10.51.0.13"
            status, updated, _ = request(address, path, "PUT", saved, cookie)
            self.assertEqual(status, 200)
            self.assertEqual(updated["revision"], 2)
            self.assertEqual(request(address, path, "PUT", plan, cookie)[0], 409)
            self.assertEqual(request(address, path, "PUT", {**updated, "id": "elsewhere"}, cookie)[0], 400)
            self.assertEqual(request(address, path, "PUT", {**updated, "networks": []}, cookie)[0], 400)
            for field in ("networks", "components", "interfaces", "links"):
                with self.subTest(missing_topology_field=field):
                    incomplete = {key: value for key, value in updated.items() if key != field}
                    self.assertEqual(request(address, path, "PUT", incomplete, cookie)[0], 400)
            self.assertEqual(request(address, path)[:2], (200, updated))

        with running_api(directory, settings) as address:
            status, reopened, _ = request(address, path)
            self.assertEqual(status, 200)
            self.assertEqual(reopened["networks"][0]["name"], "Plant Backbone")
            self.assertEqual(reopened["components"][3]["hostId"], "host-b")
            self.assertEqual(reopened["interfaces"][0]["ipv4"], "10.50.0.12")
            self.assertEqual(reopened["interfaces"][1]["ipv4"], "10.51.0.13")
            self.assertIsNone(reopened["interfaces"][2]["ipv4"])
            self.assertEqual(reopened["interfaces"][3], {"id": "vm-eth0", "componentId": "vm",
                                 "name": "eth0", "networkId": "plant", "ipv4": "10.50.0.34"})
            self.assertEqual(reopened["links"], updated["links"])


def seed_legacy_topology(settings, plan):
    # Old releases persisted snapshots with duplicate names. Seed only the fixture at that version.
    topology = {key: plan[key] for key in ("networks", "components", "interfaces", "links")}
    with closing(sqlite3.connect(settings["Database__File"])) as database:
        database.execute("UPDATE plans SET topology = ? WHERE id = ?", (json.dumps(topology), plan["id"]))
        database.commit()


def unlock(address):
    status, _, headers = request(address, SESSION, "POST", {"password": PASSWORD})
    if status == 409:
        status, _, headers = create_password(address)
        if status == 201:
            return headers["Set-Cookie"].split(";", 1)[0]
        if status == 409:
            status, _, headers = request(address, SESSION, "POST", {"password": PASSWORD})
    if status != 200:
        raise AssertionError(f"Editor unlock failed with HTTP {status}")
    return headers["Set-Cookie"].split(";", 1)[0]


if __name__ == "__main__":
    unittest.main()
