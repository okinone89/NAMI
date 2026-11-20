"""Round-trip cabling through the inventory HTTP and CSV interfaces."""
from contextlib import ExitStack
import csv
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from urllib.request import urlopen

from editor_sessions import request, settings_for
from inventory_import import inventory_plan
from plan_api import unlock
from startup import running_api


class InventoryLinks(unittest.TestCase):
    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        directory = Path(stack.enter_context(TemporaryDirectory()))
        self.address = stack.enter_context(running_api(directory, settings_for(directory)))
        self.cookie = unlock(self.address)
        self.path, self.plan = inventory_plan(self.address, self.cookie)

    def put(self, plan):
        status, saved, _ = request(self.address, self.path, "PUT", plan, self.cookie)
        self.assertEqual(status, 200, saved)
        return saved

    def export(self):
        with urlopen(self.address + self.path + "/inventory.csv", timeout=5) as response:
            return list(csv.DictReader(StringIO(response.read().decode("utf-8-sig"))))

    def post(self, action, data):
        return request(self.address, self.path + "/inventory/" + action, "POST", data, self.cookie)[:2]

    def preview(self, rows):
        status, preview = self.post("preview", {"rows": rows})
        self.assertEqual(status, 200, preview)
        return preview

    def commit(self, rows):
        preview = self.preview(rows)
        self.assertTrue(preview["canApply"], preview)
        status, committed = self.post("commit", {"rows": rows, "stateToken": preview["stateToken"]})
        self.assertEqual(status, 200, committed)
        return committed

    def test_late_ports_multiple_partners_and_reciprocal_declarations_build_one_topology(self):
        rows = [
            {"rowNumber": 2, "interfaceId": "lan-a", "linkPartner": "Switch", "partnerPort": "P1"},
            {"rowNumber": 3, "interfaceId": "lan-a", "linkPartner": "Switch", "connectionType": "Virtual"},
            {"rowNumber": 4, "componentName": "Switch", "interfaceName": "P1", "connectionType": "FO",
             "linkPartner": 'Filler, "Line A"', "partnerPort": "LAN A", "linkProtocol": "EtherCAT"},
        ]
        preview = self.preview(rows)
        self.assertTrue(preview["canApply"], preview)
        reversed_preview = self.preview(rows[::-1])
        self.assertCountEqual(preview["links"], reversed_preview["links"])
        result = self.commit(rows)
        plan = result["plan"]
        self.assertEqual(len(plan["links"]), 2)
        switch_port, = [p for p in plan["interfaces"] if p["name"] == "P1"]
        self.assertIsNone(switch_port["networkId"])
        self.assertEqual(plan["interfaces"][0]["networkId"], "cell-a")
        ends = {link["medium"]: (link["protocol"], sorted(
            [(end["componentId"], end["interfaceId"]) for end in (link["source"], link["target"])]
        )) for link in plan["links"]}
        self.assertEqual(ends, {
            "fiberOptic": ("EtherCAT", sorted([("plc-a", "lan-a"), (switch_port["componentId"], switch_port["id"])])),
            "virtual": (None, sorted([("plc-a", "lan-a"), (switch_port["componentId"], None)])),
        })
        replay = self.preview(rows[::-1])
        self.assertFalse(replay["canApply"], replay)
        self.assertTrue(all(not r["errors"] and not r["hasChanges"] for r in replay["rows"]))

    def test_link_edits_preserve_blank_metadata_and_undo_restores_only_the_imported_changes(self):
        original = self.put({**self.plan, "links": [{
            "id": "installed", "source": {"componentId": "plc-b", "interfaceId": "lan-b"},
            "target": {"componentId": "plc-a", "interfaceId": "lan-a"},
            "medium": "wired", "protocol": "EtherNet/IP",
        }]})
        rows = [
            {"rowNumber": 2, "interfaceId": "lan-a", "linkPartner": "Capper PLC", "partnerPort": "LAN B",
             "connectionType": "FO"},
            {"rowNumber": 3, "componentName": "Panel", "linkPartner": "Capper PLC", "connectionType": "Wireless"},
            {"rowNumber": 4, "interfaceId": "lan-b"},
        ]
        applied = self.commit(rows)
        old_link = original["links"][0]
        self.assertEqual(applied["plan"]["links"][0], {**old_link, "medium": "fiberOptic"})
        later = self.put({**applied["plan"], "name": "Revised plan"})
        status, restored = self.post("undo", {"importId": applied["undo"]["importId"]})
        self.assertEqual(status, 200, restored)
        self.assertEqual(restored, {**original, "name": "Revised plan", "revision": later["revision"] + 1})

        applied = self.commit(rows)
        plan = applied["plan"]
        plan["links"][0]["protocol"] = "EtherCAT"
        edited = self.put(plan)
        self.assertEqual(self.post("undo", {"importId": applied["undo"]["importId"]})[0], 409)
        self.assertEqual(request(self.address, self.path)[:2], (200, edited))

    def test_export_lists_each_partner_and_preserves_component_level_ends(self):
        filler = {"componentId": "plc-a", "interfaceId": "lan-a"}
        capper = {"componentId": "plc-b"}
        self.put({**self.plan, "links": [
            {"id": "fiber", "source": filler, "target": {**capper, "interfaceId": "lan-b"},
             "medium": "fiberOptic", "protocol": "EtherCAT"},
            {"id": "device-link", "source": capper, "target": filler, "medium": "wireless"},
        ]})
        self.assertCountEqual(
            [(r["Interface"], r["Link partner"], r["Partner port"], r["Connection type"], r["Link protocol"])
             for r in self.export()],
            [("LAN A", "Capper PLC", "LAN B", "FO", "EtherCAT"), ("LAN A", "Capper PLC", "", "Wireless", ""),
             ("LAN B", 'Filler, "Line A"', "LAN A", "FO", "EtherCAT"),
             ("", 'Filler, "Line A"', "LAN A", "Wireless", "")])


if __name__ == "__main__":
    unittest.main()
