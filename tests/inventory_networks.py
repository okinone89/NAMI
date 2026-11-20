"""Rebuild and reconcile named networks through inventory HTTP endpoints."""
import csv
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from urllib.request import urlopen

from editor_sessions import request, settings_for
from inventory_import import inventory_plan
from plan_api import seed_legacy_topology, unlock
from startup import running_api


class InventoryNetworks(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        self.settings = settings_for(directory)
        api = running_api(directory, self.settings)
        self.address = api.__enter__()
        self.addCleanup(api.__exit__, None, None, None)
        self.cookie = unlock(self.address)
        self.path, self.plan = inventory_plan(self.address, self.cookie)

    def post(self, action, data, status=200):
        result, body, _ = request(self.address, self.path + "/inventory/" + action,
                                  "POST", data, self.cookie)
        self.assertEqual(result, status, body)
        return body

    def save(self, plan):
        status, saved, _ = request(self.address, self.path, "PUT", plan, self.cookie)
        self.assertEqual(status, 200, saved)
        return saved

    def commit(self, draft):
        preview = self.post("preview", draft)
        self.assertTrue(preview["canApply"], preview)
        return self.post("commit", {**draft, "stateToken": preview["stateToken"]})

    def test_network_only_rows_and_isolated_addresses_round_trip(self):
        draft = {"rows": [
            {"rowNumber": 2, "networkName": "Spare", "networkSubnet": "10.4.0.0/16"},
            {"rowNumber": 3, "networkName": "Future"},
            {"rowNumber": 4, "networkName": "Isolated", "componentName": "Pump", "interfaceName": "LAN"},
            {"rowNumber": 5, "networkName": " isolated ", "componentName": "Pump", "interfaceName": "LAN",
             "ipv4": "192.168.1.10"},
        ]}
        plan = self.commit(draft)["plan"]
        self.assertEqual([(n["name"], n["subnet"]) for n in plan["networks"]],
                         [("Cell A", "192.168.1.0/24"), ("Spare", "10.4.0.0/16"),
                          ("Future", None), ("Isolated", None)])
        with urlopen(self.address + self.path + "/inventory.csv") as response:
            rows = list(csv.DictReader(StringIO(response.read().decode("utf-8-sig"))))
        self.assertEqual([(r["Network"], r["Network subnet"]) for r in rows if not r["Component"]],
                         [("Spare", "10.4.0.0/16"), ("Future", "")])
        status, _, headers = request(self.address, "/api/plans", "POST", {"name": "Empty"}, self.cookie)
        self.assertEqual(status, 201)
        self.path = headers["Location"]
        incoming = {"rows": [{"rowNumber": i, "componentName": r["Component"], "componentType": r["Component type"],
                              "interfaceName": r["Interface"], "ipv4": r["IPv4"], "networkName": r["Network"],
                              "networkSubnet": r["Network subnet"]} for i, r in enumerate(rows, 2)]}
        imported = self.commit(incoming)["plan"]
        networks = {n["id"]: n for n in imported["networks"]}
        self.assertCountEqual([(n["name"], n["subnet"]) for n in networks.values()],
                              [(n["name"], n["subnet"]) for n in plan["networks"]])
        self.assertCountEqual([(networks[p["networkId"]]["name"], p["ipv4"]) for p in imported["interfaces"]],
                              [("Cell A", "192.168.1.10"), ("Cell A", "192.168.1.20"),
                               ("Isolated", "192.168.1.10")])
        self.assertFalse(self.post("preview", incoming)["canApply"])

    def test_subnet_decision_names_displaced_ports_and_selected_rows(self):
        draft = {"rows": [{"rowNumber": 4, "networkName": "Cell A", "networkSubnet": "172.16.0.0/24"},
                          {"rowNumber": 7, "interfaceId": "lan-a", "networkName": "Cell A",
                           "networkSubnet": "192.168.0.0/16"}]}
        preview = self.post("preview", draft)
        self.assertFalse(preview["canApply"])
        decision, = preview["decisions"]
        self.assertEqual(decision["rowNumbers"], [4, 7])
        self.assertIn("172.16.0.0/24", decision["message"])
        self.assertIn("192.168.0.0/16", decision["message"])
        draft["rows"][1]["networkSubnet"] = "172.16.0.0/24"
        mismatch, = self.post("preview", draft)["decisions"]
        self.assertEqual(mismatch["rowNumbers"], [4, 7])
        for text in ('Filler, "Line A" / LAN A', 'Capper PLC / LAN B', "192.168.1.10", "192.168.1.20"):
            self.assertIn(text, mismatch["message"])
        draft["rows"][0]["networkSubnet"] = "192.168.0.0/16"
        draft["rows"][1]["networkSubnet"] = ""
        clean = self.post("preview", draft)
        self.assertEqual(clean["decisions"], [])
        self.assertEqual(self.commit(draft)["plan"]["networks"][0]["subnet"], "192.168.0.0/16")

    def test_repeated_membership_and_address_conflicts_identify_the_rows_in_either_order(self):
        rows = [{"rowNumber": 7, "interfaceId": "lan-a", "networkName": "Isolated", "ipv4": "10.1.0.1"},
                {"rowNumber": 4, "interfaceId": "lan-a", "networkName": "Bench", "ipv4": "10.3.0.1"},
                {"rowNumber": 2, "interfaceId": "lan-a"}]
        for ordered in (rows, list(reversed(rows))):
            preview = self.post("preview", {"rows": ordered})
            self.assertFalse(preview["canApply"])
            decision, = preview["decisions"]
            self.assertEqual(decision["rowNumbers"], [4, 7])
            for text in ("row 4", "Bench", "10.3.0.1", "row 7", "Isolated", "10.1.0.1", "LAN A"):
                self.assertIn(text, decision["message"])
        rows[0]["networkName"] = ""
        rows[1]["ipv4"] = ""
        plan = self.commit({"rows": rows})["plan"]
        bench, = [n for n in plan["networks"] if n["name"] == "Bench"]
        port, = [p for p in plan["interfaces"] if p["id"] == "lan-a"]
        self.assertEqual((port["networkId"], port["ipv4"]), (bench["id"], "10.1.0.1"))

    def test_subnet_confirmation_tracks_affected_network_and_members_then_undo_restores_records(self):
        draft = {"rows": [{"rowNumber": 2, "networkName": "Cell A", "networkSubnet": "192.168.0.0/16"},
                          {"rowNumber": 3, "networkName": "Bench"}]}
        preview = self.post("preview", draft)
        self.plan["networks"][0]["position"] = {"x": 40, "y": 60}
        self.plan = self.save(self.plan)
        refreshed = self.post("commit", {**draft, "stateToken": preview["stateToken"]}, 409)
        self.plan["interfaces"][1]["ipv4"] = "192.168.1.23"
        self.plan = self.save(self.plan)
        refreshed = self.post("commit", {**draft, "stateToken": refreshed["stateToken"]}, 409)
        self.plan["networks"].append({"id": "remote", "name": "Remote"})
        self.plan = self.save(self.plan)
        imported = self.post("commit", {**draft, "stateToken": refreshed["stateToken"]})
        undone = self.post("undo", {"importId": imported["undo"]["importId"]})
        self.assertEqual(undone["networks"], self.plan["networks"])
        self.assertEqual(undone["interfaces"], self.plan["interfaces"])

        imported = self.commit(draft)
        plan = imported["plan"]
        bench, = [n for n in plan["networks"] if n["name"] == "Bench"]
        plan["interfaces"][0]["networkId"] = bench["id"]
        self.save(plan)
        reason = self.post("undo", {"importId": imported["undo"]["importId"]}, 409)
        self.assertIn("network", reason["title"])

    def test_only_referenced_legacy_networks_require_one_choice(self):
        self.plan["networks"].extend([
            {"id": "other-cell", "name": " cell a ", "subnet": "192.168.0.0/16"},
            {"id": "spare-a", "name": "Spare"}, {"id": "spare-b", "name": "spare"},
        ])
        seed_legacy_topology(self.settings, self.plan)
        draft = {"rows": [{"rowNumber": 2, "networkName": "Cell A", "componentName": "HMI", "interfaceName": "A"},
                          {"rowNumber": 3, "networkName": "CELL A", "componentName": "HMI", "interfaceName": "B"}]}
        preview = self.post("preview", draft)
        network, = preview["decisions"]
        self.assertEqual(network["rowNumbers"], [2, 3])
        self.assertEqual({choice["id"] for choice in network["choices"]}, {"cell-a", "other-cell"})
        draft["answers"] = {network["id"]: "other-cell"}
        saved = self.commit(draft)["plan"]
        self.assertCountEqual([p["networkId"] for p in saved["interfaces"] if p["name"] in ("A", "B")],
                              ["other-cell", "other-cell"])
