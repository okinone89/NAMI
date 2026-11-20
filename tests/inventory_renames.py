"""Exercise confirmed inventory identity changes through the plan API."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from editor_sessions import request, settings_for
from inventory_import import inventory_plan
from plan_api import unlock
from startup import running_api


class InventoryRenames(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        directory = Path(tmp.name)
        api = running_api(directory, settings_for(directory))
        self.address = api.__enter__()
        self.addCleanup(api.__exit__, None, None, None)
        self.cookie = unlock(self.address)
        self.path, plan = inventory_plan(self.address, self.cookie)
        plan["interfaces"].append({"id": "service", "componentId": "plc-b", "name": "Service"})
        plan["links"] = [{"id": "cable", "source": {"componentId": "plc-a", "interfaceId": "lan-a"},
                          "target": {"componentId": "plc-b", "interfaceId": "lan-b"}, "medium": "wired"}]
        self.plan = self.save(plan)
        self.draft = {"rows": [
            {"rowNumber": 2, "componentName": "Capper 2", "interfaceName": "LAN B",
             "networkName": "Cell A", "ipv4": "192.168.1.20"},
            {"rowNumber": 3, "componentName": "Capper 2", "interfaceName": "Service"},
        ], "answers": {}}

    def save(self, plan):
        status, saved, _ = request(self.address, self.path, "PUT", plan, self.cookie)
        self.assertEqual(status, 200, saved)
        return saved

    def preview(self):
        status, body, _ = request(self.address, self.path + "/inventory/preview", "POST", self.draft, self.cookie)
        self.assertEqual(status, 200, body)
        return body

    def commit(self, preview):
        return request(self.address, self.path + "/inventory/commit", "POST",
                       {**self.draft, "stateToken": preview["stateToken"]}, self.cookie)[:2]

    def answer(self, decision, label):
        choice, = [item for item in decision["choices"] if item["label"].startswith(label)]
        self.draft["answers"][decision["id"]] = choice["id"]

    def test_cross_network_address_creates_an_independent_component_without_a_decision(self):
        self.plan["networks"].append({"id": "cell-b", "name": "Cell B", "subnet": "192.168.1.0/24"})
        self.save(self.plan)
        self.draft["rows"][0]["networkName"] = "Cell B"
        preview = self.preview()
        self.assertEqual(preview["decisions"], [])
        status, result = self.commit(preview)
        self.assertEqual(status, 200, result)
        self.assertEqual(result["plan"]["components"][:2], self.plan["components"])
        self.assertEqual(result["plan"]["interfaces"][-2]["networkId"], "cell-b")

    def test_ambiguous_address_requires_selecting_the_specific_owner(self):
        self.plan["interfaces"][0]["ipv4"] = "192.168.1.20"
        self.plan["keepAddressConflicts"] = [{"ipv4": "192.168.1.20", "networkId": "cell-a",
                                              "interfaceIds": ["lan-a", "lan-b"]}]
        self.save(self.plan)
        preview = self.preview()
        decision, = preview["decisions"]
        self.assertFalse(preview["canApply"])
        self.assertEqual(len(decision["choices"]), 3)
        self.answer(decision, "Rename existing component 'Capper PLC'")
        status, result = self.commit(self.preview())
        self.assertEqual(status, 200, result)
        self.assertEqual([c["name"] for c in result["plan"]["components"]], ['Filler, "Line A"', "Capper 2"])

    def test_create_separate_recomputes_address_conflict_without_reusing_the_existing_ports(self):
        decision, = self.preview()["decisions"]
        self.answer(decision, "Create separate")
        preview = self.preview()
        self.assertEqual(preview["decisions"], [])
        issue, = preview["rows"][0]["blockingAddressIssues"]
        self.assertEqual(issue["code"], "duplicateIpv4")
        self.draft["keepAddressConflicts"] = [{"ipv4": issue["ipv4"], "networkId": issue["networkId"],
                                               "interfaceIds": [p["interfaceId"] for p in issue["interfaces"]]}]
        status, result = self.commit(self.preview())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["plan"]["interfaces"][:3], self.plan["interfaces"])
        separate = result["plan"]["components"][-1]
        self.assertNotEqual(separate["id"], "plc-b")
        self.assertEqual([p["name"] for p in result["plan"]["interfaces"] if p["componentId"] == separate["id"]],
                         ["LAN B", "Service"])
        self.assertEqual(result["plan"]["links"], self.plan["links"])

    def test_reciprocal_cabling_resolves_only_after_identity(self):
        self.draft["rows"][0]["interfaceName"] = "Control"
        self.draft["rows"].append({"rowNumber": 4, "interfaceId": "lan-a", "linkPartner": "Capper 2",
                                   "partnerPort": "Control", "connectionType": "FO"})
        first = self.preview()
        self.assertEqual(first["rows"][-1]["errors"], [])
        self.assertEqual(first["links"], [])
        self.answer(first["decisions"][0], "Rename existing component")
        second = self.preview()
        self.assertEqual(second["rows"][-1]["errors"], [])
        self.answer(second["decisions"][0], "Rename existing port")
        resolved = self.preview()
        link, = resolved["links"]
        self.assertEqual(link["before"]["id"], "cable")
        self.assertEqual(link["after"]["id"], "cable")
        status, result = self.commit(resolved)
        self.assertEqual(status, 200, result)
        self.assertEqual(result["plan"]["links"], [{**self.plan["links"][0], "medium": "fiberOptic"}])

    def test_two_confirmed_names_for_one_component_block_until_the_conflict_is_corrected(self):
        self.draft["rows"].append({**self.draft["rows"][0], "rowNumber": 4, "componentName": "Other name"})
        first, second = self.preview()["decisions"]
        self.answer(first, "Rename existing")
        self.answer(second, "Rename existing")
        preview = self.preview()
        self.assertFalse(preview["canApply"])
        self.assertEqual(self.commit(preview), (409, preview))
        self.assertTrue(all(row["errors"] for row in preview["rows"]))

    def test_undo_is_unavailable_if_another_component_now_uses_the_previous_name(self):
        self.answer(self.preview()["decisions"][0], "Rename existing")
        status, saved = self.commit(self.preview())
        self.assertEqual(status, 200)
        plan = saved["plan"]
        plan["components"].append({"id": "new", "name": "Capper PLC", "type": "PLC"})
        later = self.save(plan)
        status, undo, _ = request(self.address, self.path + "/inventory/undo")
        self.assertEqual(status, 200)
        self.assertFalse(undo["canUndo"])
        self.assertEqual(request(self.address, self.path + "/inventory/undo", "POST", saved["undo"], self.cookie)[0], 409)
        self.assertEqual(request(self.address, self.path)[1], later)

    def test_port_choice_preserves_its_id_and_requires_review_after_link_evidence_changes(self):
        self.draft["rows"] = [{"rowNumber": 2, "componentName": "Capper PLC", "interfaceName": "Control",
                               "networkName": "Cell A", "ipv4": "192.168.1.20"}]
        decision, = self.preview()["decisions"]
        self.assertIn("Control", decision["message"])
        self.assertIn("LAN B", decision["message"])
        self.answer(decision, "Rename existing")
        preview = self.preview()
        self.assertTrue(preview["canApply"])
        self.plan["links"] = []
        self.save(self.plan)
        status, stale = self.commit(preview)
        self.assertEqual(status, 409)
        changed, = stale["decisions"]
        self.assertNotEqual(decision["id"], changed["id"])
        self.answer(changed, "Rename existing")
        status, result = self.commit(self.preview())
        self.assertEqual(status, 200, result)
        self.assertEqual([(p["id"], p["name"]) for p in result["plan"]["interfaces"]],
                         [("lan-a", "LAN A"), ("lan-b", "Control"), ("service", "Service")])
        status, undone, _ = request(self.address, self.path + "/inventory/undo", "POST", result["undo"], self.cookie)
        self.assertEqual(status, 200, undone)
        self.assertEqual(undone["interfaces"], self.plan["interfaces"])

    def test_one_component_choice_renames_every_row_and_preserves_ports_and_links(self):
        preview = self.preview()
        decision, = preview["decisions"]
        self.assertEqual(self.commit(preview), (409, preview))
        self.assertEqual(decision["rowNumbers"], [2, 3])
        for evidence in ("Capper PLC", "Capper 2", "Cell A", "192.168.1.20", "LAN B", "Service", "LAN A"):
            self.assertIn(evidence, decision["message"])
        self.answer(decision, "Rename existing")
        resolved = self.preview()
        self.assertEqual(resolved["decisions"], [])
        self.assertEqual([(row["componentId"], row["interfaceId"], row["before"]["componentName"],
                           row["after"]["componentName"]) for row in resolved["rows"]],
                         [("plc-b", "lan-b", "Capper PLC", "Capper 2"), ("plc-b", "service", "Capper PLC", "Capper 2")])
        status, saved = self.commit(resolved)
        self.assertEqual(status, 200, saved)
        self.assertEqual([c["name"] for c in saved["plan"]["components"]], ['Filler, "Line A"', "Capper 2"])
        self.assertEqual(saved["plan"]["interfaces"], self.plan["interfaces"])
        self.assertEqual(saved["plan"]["links"], self.plan["links"])
        plan = saved["plan"]
        plan["interfaces"][0]["ipv4"] = "192.168.1.11"
        self.save(plan)
        status, undone, _ = request(self.address, self.path + "/inventory/undo", "POST", saved["undo"], self.cookie)
        self.assertEqual(status, 200, undone)
        self.assertEqual(undone["components"], self.plan["components"])
        self.assertEqual(undone["interfaces"][0]["ipv4"], "192.168.1.11")
        self.assertEqual(undone["links"], self.plan["links"])


if __name__ == "__main__":
    unittest.main()
