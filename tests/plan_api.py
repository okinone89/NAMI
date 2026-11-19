"""Exercise plan management through the HTTP API on both providers."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from editor_sessions import PASSPHRASE, SESSION, request, settings_for
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
            self.assertEqual(request(address, path, "PUT", {"id": updated["id"], "name": "Partial"}, cookie)[0], 400)

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


def unlock(address):
    status, _, headers = request(address, SESSION, "POST", {"passphrase": PASSPHRASE})
    if status != 200:
        raise AssertionError(f"Editor unlock failed with HTTP {status}")
    return headers["Set-Cookie"].split(";", 1)[0]


if __name__ == "__main__":
    unittest.main()
