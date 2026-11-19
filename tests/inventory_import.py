"""Exercise inventory CSV export and import preview through the plan API."""
import csv
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from urllib.request import urlopen

from editor_sessions import request, settings_for
from plan_api import unlock
from startup import running_api


def inventory_plan(address, cookie):
    _, plan, headers = request(address, "/api/plans", "POST", {"name": "Inventory"}, cookie)
    path = headers["Location"]
    plan.update(
        networks=[{"id": "cell-a", "name": "Cell A", "subnet": "192.168.1.0/24"}],
        components=[{"id": "plc-a", "name": 'Filler, "Line A"', "type": "PLC"},
                    {"id": "plc-b", "name": "Capper PLC", "type": "PLC"}],
        interfaces=[{"id": "lan-a", "componentId": "plc-a", "name": "LAN A",
                     "networkId": "cell-a", "ipv4": "192.168.1.10"},
                    {"id": "lan-b", "componentId": "plc-b", "name": "LAN B",
                     "networkId": "cell-a", "ipv4": "192.168.1.20"}],
    )
    status, saved, _ = request(address, path, "PUT", plan, cookie)
    if status != 200:
        raise AssertionError(saved)
    return path, saved


class InventoryImport(unittest.TestCase):
    def test_export_preserves_stable_ids_and_quotes_component_names(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                path, _ = inventory_plan(address, unlock(address))
                with urlopen(address + path + "/inventory.csv", timeout=5) as response:
                    self.assertEqual(response.headers.get_content_type(), "text/csv")
                    self.assertIn("attachment", response.headers["Content-Disposition"])
                    rows = list(csv.DictReader(StringIO(response.read().decode("utf-8-sig"))))
                self.assertEqual(rows, [
                    {"Component ID": "plc-a", "Interface ID": "lan-a", "Component": 'Filler, "Line A"',
                     "Interface": "LAN A", "Component type": "PLC", "Network ID": "cell-a",
                     "Network": "Cell A", "IPv4": "192.168.1.10"},
                    {"Component ID": "plc-b", "Interface ID": "lan-b", "Component": "Capper PLC",
                     "Interface": "LAN B", "Component type": "PLC", "Network ID": "cell-a",
                     "Network": "Cell A", "IPv4": "192.168.1.20"},
                ])

    def test_preview_matches_ids_and_falls_back_to_unique_names_without_writing(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                path, saved = inventory_plan(address, cookie)
                incoming = {"rows": [
                    {"rowNumber": 2, "componentId": "plc-a", "interfaceId": "lan-a",
                     "componentName": "Old name", "interfaceName": "Old port", "ipv4": "192.168.1.40"},
                    {"rowNumber": 3, "componentName": "Capper PLC", "interfaceName": "LAN B"},
                    {"rowNumber": 4, "componentName": "Capper PLC", "interfaceName": "LAN C"},
                    {"rowNumber": 5, "componentName": "Packer PLC", "interfaceName": "LAN D",
                     "componentType": "PLC", "networkName": "Cell A"},
                    {"rowNumber": 6, "componentId": "plc-a", "interfaceId": "lan-b"},
                    {"rowNumber": 7, "interfaceId": "missing", "componentName": "Capper PLC",
                     "interfaceName": "LAN B"},
                ]}
                status, preview, _ = request(address, path + "/inventory/preview", "POST", incoming, cookie)
                self.assertEqual(status, 200)
                updated, unchanged, port, addition, inconsistent, missing = preview["rows"]
                self.assertEqual((updated["match"], updated["interfaceId"]), ("id", "lan-a"))
                self.assertEqual(updated["before"]["ipv4"], "192.168.1.10")
                self.assertEqual(updated["after"]["ipv4"], "192.168.1.40")
                self.assertEqual((unchanged["match"], unchanged["interfaceId"]), ("name", "lan-b"))
                self.assertEqual(unchanged["before"], unchanged["after"])
                self.assertEqual((port["match"], port["componentId"], port["before"]), ("addition", "plc-b", None))
                self.assertEqual((addition["match"], addition["after"]["networkId"]), ("addition", "cell-a"))
                self.assertEqual(inconsistent["errors"][0]["code"], "inconsistentIds")
                self.assertEqual(missing["errors"][0]["code"], "unknownInterfaceId")
                self.assertEqual(request(address, path)[:2], (200, saved))

    def test_preview_exposes_repeated_targets_and_supports_clear_skip_and_exact_conflict_approval(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                path, saved = inventory_plan(address, cookie)
                incoming = {"rows": [
                    {"rowNumber": 2, "interfaceId": "lan-a", "ipv4": "192.168.1.20"},
                    {"rowNumber": 3, "componentName": 'Filler, "Line A"', "interfaceName": "LAN A",
                     "clear": ["network", "ipv4"]},
                ]}
                preview_path = path + "/inventory/preview"

                def preview():
                    status, result, _ = request(address, preview_path, "POST", incoming, cookie)
                    self.assertEqual(status, 200)
                    return result["rows"]

                rows = preview()
                self.assertEqual([row["errors"][0]["code"] for row in rows], ["repeatedTarget", "repeatedTarget"])
                self.assertFalse(any(row["canApply"] for row in rows))
                cleared = rows[1]
                self.assertEqual(cleared["clear"], ["network", "ipv4"])
                self.assertEqual((cleared["after"]["networkId"], cleared["after"]["ipv4"]), (None, None))

                incoming["rows"][1]["skip"] = True
                conflicted, skipped = preview()
                self.assertEqual(skipped["match"], "skipped")
                self.assertFalse(conflicted["canApply"])
                issue, = conflicted["blockingAddressIssues"]
                self.assertEqual(issue["code"], "duplicateIpv4")
                self.assertEqual([(port["componentName"], port["interfaceName"]) for port in issue["interfaces"]],
                                 [('Filler, "Line A"', "LAN A"), ("Capper PLC", "LAN B")])
                incoming["keepAddressConflicts"] = [
                    {"networkId": "cell-a", "ipv4": "192.168.1.20", "interfaceIds": ["lan-a", "wrong"]}
                ]
                self.assertFalse(preview()[0]["canApply"])
                incoming["keepAddressConflicts"][0]["interfaceIds"] = ["lan-a", "lan-b"]
                kept = preview()[0]
                self.assertTrue(kept["canApply"])
                self.assertEqual(kept["blockingAddressIssues"], [])
                self.assertEqual(kept["addressIssues"], [issue])
                incoming["rows"][0]["ipv4"] = "192.168.2.20"
                invalid = preview()[0]
                self.assertEqual(invalid["blockingAddressIssues"][0]["code"], "outsideSubnet")
                self.assertFalse(invalid["canApply"])
                self.assertEqual(request(address, path)[:2], (200, saved))

    def test_preview_only_proposes_unique_name_matches_and_groups_additions_under_one_component(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                path, plan = inventory_plan(address, cookie)
                plan["components"].append({"id": "plc-c", "name": "Capper PLC", "type": "PLC"})
                plan["interfaces"].append({"id": "lan-c", "componentId": "plc-c", "name": "LAN C"})
                status, plan, _ = request(address, path, "PUT", plan, cookie)
                self.assertEqual(status, 200)
                incoming = {"rows": [
                    {"rowNumber": 2, "componentName": "Capper PLC", "interfaceName": "LAN B"},
                    {"rowNumber": 3, "componentName": "Capper PLC", "interfaceName": "LAN D"},
                    {"rowNumber": 4, "componentName": "Packer PLC", "interfaceName": "LAN E"},
                    {"rowNumber": 5, "componentName": "packer plc", "interfaceName": "LAN F", "componentType": "PLC"},
                ]}

                def preview():
                    status, result, _ = request(address, path + "/inventory/preview", "POST", incoming, cookie)
                    self.assertEqual(status, 200)
                    return result["rows"]

                unique, ambiguous, first, second = preview()
                self.assertEqual(unique["interfaceId"], "lan-b")
                self.assertEqual(ambiguous["errors"][0]["code"], "ambiguousMatch")
                self.assertEqual(first["componentId"], second["componentId"])
                self.assertNotEqual(first["interfaceId"], second["interfaceId"])
                self.assertEqual([row["after"]["componentType"] for row in (first, second)], ["PLC", "PLC"])
                self.assertEqual([row["after"]["componentName"] for row in (first, second)], ["Packer PLC", "Packer PLC"])

                incoming["rows"][2]["componentType"] = "Switch"
                _, _, first, second = preview()
                self.assertEqual([row["errors"][0]["code"] for row in (first, second)],
                                 ["inconsistentComponentType", "inconsistentComponentType"])

                plan["interfaces"][-1]["name"] = "LAN B"
                self.assertEqual(request(address, path, "PUT", plan, cookie)[0], 200)
                self.assertEqual(preview()[0]["errors"][0]["code"], "ambiguousMatch")

    def test_preview_token_tracks_selected_interface_records_but_ignores_unrelated_edits(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                path, plan = inventory_plan(address, cookie)
                preview_path = path + "/inventory/preview"
                incoming = {"rows": [
                    {"rowNumber": 2, "interfaceId": "lan-a", "ipv4": "192.168.1.45"},
                    {"rowNumber": 3, "interfaceId": "lan-b", "skip": True},
                ]}

                def preview():
                    status, result, _ = request(address, preview_path, "POST", incoming, cookie)
                    self.assertEqual(status, 200)
                    return result

                self.assertEqual(request(address, preview_path, "POST", incoming)[0], 401)
                first = preview()
                self.assertEqual(first, preview())
                plan["interfaces"][1]["ipv4"] = "192.168.1.25"
                status, plan, _ = request(address, path, "PUT", plan, cookie)
                self.assertEqual(status, 200)
                self.assertEqual(first["stateToken"], preview()["stateToken"])
                plan["interfaces"][0]["protocolProfiles"] = {"profinet": {"stationName": "filler"}}
                self.assertEqual(request(address, path, "PUT", plan, cookie)[0], 200)
                latest = preview()
                self.assertEqual(first["rows"], latest["rows"])
                self.assertNotEqual(first["stateToken"], latest["stateToken"])


if __name__ == "__main__":
    unittest.main()
