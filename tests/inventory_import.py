"""Exercise inventory CSV export and import preview through the plan API."""
from contextlib import nullcontext
import csv
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from urllib.request import urlopen

from editor_sessions import request, settings_for
from plan_api import seed_legacy_topology, unlock
from startup import postgres_settings, running_api


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
    def test_unchanged_and_skipped_commits_preserve_the_plan_and_last_import(self):
        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), TemporaryDirectory() as tmp:
                directory = Path(tmp)
                database = postgres_settings(directory) if provider == "PostgreSQL" else nullcontext({})
                with database as settings, running_api(directory, {**settings_for(directory), **settings}) as address:
                    cookie = unlock(address)
                    path, original = inventory_plan(address, cookie)
                    inventory = path + "/inventory"

                    def preview(rows):
                        status, result, _ = request(address, inventory + "/preview", "POST", {"rows": rows}, cookie)
                        self.assertEqual(status, 200)
                        return result

                    def commit(rows, token):
                        return request(address, inventory + "/commit", "POST", {"rows": rows, "stateToken": token}, cookie)[:2]

                    def verify_no_writes(plan, expected_undo):
                        for row in ({"ipv4": plan["interfaces"][0]["ipv4"]}, {"ipv4": "192.168.1.99", "skip": True}):
                            rows = [{"rowNumber": 2, "interfaceId": "lan-a", **row}]
                            result = preview(rows)
                            self.assertFalse(result["canApply"])
                            self.assertEqual(result["decisions"], [])
                            self.assertEqual(result["rows"][0]["errors"], [])
                            self.assertEqual(commit(rows, result["stateToken"]), (409, result))
                            self.assertEqual(request(address, path)[:2], (200, plan))
                            self.assertEqual(request(address, inventory + "/undo")[:2], expected_undo)

                    verify_no_writes(original, (204, None))
                    change = [{"rowNumber": 2, "interfaceId": "lan-a", "ipv4": "192.168.1.44"}]
                    token = preview(change)["stateToken"]
                    status, committed = commit(change, token)
                    self.assertEqual(status, 200)
                    self.assertEqual(committed["plan"]["interfaces"][0]["ipv4"], "192.168.1.44")
                    # Retrying the original confirmation refreshes the preview to the saved state.
                    self.assertEqual(commit(change, token), (409, preview(change)))
                    verify_no_writes(committed["plan"], (200, committed["undo"]))
                    status, restored, _ = request(address, inventory + "/undo", "POST",
                                                  {"importId": committed["undo"]["importId"]}, cookie)
                    self.assertEqual(status, 200)
                    self.assertEqual(restored["interfaces"], original["interfaces"])

    def test_commits_selected_changes_and_additions_together_on_both_providers(self):
        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), TemporaryDirectory() as tmp:
                directory = Path(tmp)
                database = postgres_settings(directory) if provider == "PostgreSQL" else nullcontext({})
                with database as settings, running_api(directory, {**settings_for(directory), **settings}) as address:
                    cookie = unlock(address)
                    path, saved = inventory_plan(address, cookie)
                    preview_path, commit_path = (path + "/inventory/" + action for action in ("preview", "commit"))
                    draft = {"rows": [
                        {"rowNumber": 2, "interfaceId": "lan-a", "ipv4": "192.168.1.20"},
                        {"rowNumber": 3, "componentName": "Packer", "interfaceName": "LAN",
                         "networkId": "cell-a", "ipv4": "192.168.1.30"},
                        {"rowNumber": 4, "componentName": "Skipped device", "interfaceName": "LAN", "skip": True},
                    ]}
                    status, preview, _ = request(address, preview_path, "POST", draft, cookie)
                    self.assertEqual(status, 200)
                    confirmation = {**draft, "stateToken": preview["stateToken"]}
                    self.assertEqual(request(address, commit_path, "POST", confirmation)[0], 401)
                    self.assertEqual(request(address, commit_path, "POST", confirmation, cookie)[:2], (409, preview))
                    self.assertEqual(request(address, path)[:2], (200, saved))

                    draft["keepAddressConflicts"] = [
                        {"networkId": "cell-a", "ipv4": "192.168.1.20", "interfaceIds": ["lan-a", "lan-b"]}
                    ]
                    status, approved, _ = request(address, preview_path, "POST", draft, cookie)
                    self.assertEqual(status, 200)
                    self.assertTrue(approved["rows"][0]["canApply"])
                    status, committed, _ = request(address, commit_path, "POST",
                                                   {**draft, "stateToken": approved["stateToken"]}, cookie)
                    self.assertEqual(status, 200)
                    plan = committed["plan"]
                    self.assertEqual(plan["revision"], saved["revision"] + 1)
                    self.assertEqual([component["name"] for component in plan["components"]],
                                     ['Filler, "Line A"', "Capper PLC", "Packer"])
                    self.assertEqual([port["ipv4"] for port in plan["interfaces"]],
                                     ["192.168.1.20", "192.168.1.20", "192.168.1.30"])
                    self.assertEqual(plan["addressIssues"][0]["code"], "duplicateIpv4")
                    self.assertEqual(request(address, path)[:2], (200, plan))

    def test_stale_confirmation_refreshes_all_rows_without_writing_on_both_providers(self):
        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), TemporaryDirectory() as tmp:
                directory = Path(tmp)
                database = postgres_settings(directory) if provider == "PostgreSQL" else nullcontext({})
                with database as settings, running_api(directory, {**settings_for(directory), **settings}) as address:
                    cookie = unlock(address)
                    path, saved = inventory_plan(address, cookie)
                    draft = {"rows": [
                        {"rowNumber": 2, "interfaceId": "lan-a", "ipv4": "192.168.1.40"},
                        {"rowNumber": 3, "componentName": "Packer", "interfaceName": "LAN"},
                    ]}
                    status, preview, _ = request(address, path + "/inventory/preview", "POST", draft, cookie)
                    self.assertEqual(status, 200)
                    saved["interfaces"][0]["ipv4"] = "192.168.1.25"
                    saved["interfaces"][1]["ipv4"] = "192.168.1.35"
                    status, concurrent, _ = request(address, path, "PUT", saved, cookie)
                    self.assertEqual(status, 200)

                    commit_path = path + "/inventory/commit"
                    status, refreshed, _ = request(address, commit_path, "POST",
                                                   {**draft, "stateToken": preview["stateToken"]}, cookie)
                    self.assertEqual(status, 409)
                    self.assertNotEqual(refreshed["stateToken"], preview["stateToken"])
                    self.assertEqual(refreshed["rows"][0]["before"]["ipv4"], "192.168.1.25")
                    self.assertEqual(request(address, path)[:2], (200, concurrent))

                    status, committed, _ = request(address, commit_path, "POST",
                                                   {**draft, "stateToken": refreshed["stateToken"]}, cookie)
                    self.assertEqual(status, 200)
                    self.assertEqual([port["ipv4"] for port in committed["plan"]["interfaces"]],
                                     ["192.168.1.40", "192.168.1.35", None])

    def test_undo_requires_unchanged_records_and_preserves_later_edits_on_both_providers(self):
        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), TemporaryDirectory() as tmp:
                directory = Path(tmp)
                database = postgres_settings(directory) if provider == "PostgreSQL" else nullcontext({})
                with database as settings:
                    environment = {**settings_for(directory), **settings}
                    with running_api(directory, environment) as address:
                        cookie = unlock(address)
                        path, _ = inventory_plan(address, cookie)
                        inventory = path + "/inventory"
                        draft = {"rows": [
                            {"rowNumber": 2, "interfaceId": "lan-a", "ipv4": "192.168.1.40"},
                            {"rowNumber": 3, "componentName": "Packer", "interfaceName": "LAN"},
                            {"rowNumber": 4, "componentId": "plc-b", "interfaceName": "LAN B2"},
                        ]}
                        status, preview, _ = request(address, inventory + "/preview", "POST", draft, cookie)
                        self.assertEqual(status, 200)
                        status, committed, _ = request(address, inventory + "/commit", "POST",
                                                       {**draft, "stateToken": preview["stateToken"]}, cookie)
                        self.assertEqual(status, 200)
                        after = committed["plan"]
                        change = {"importId": committed["undo"]["importId"]}

                    with running_api(directory, environment) as address:
                        cookie = unlock(address)
                        status, available, _ = request(address, inventory + "/undo")
                        self.assertEqual((status, available["importId"], available["canUndo"]),
                                         (200, change["importId"], True))
                        self.assertEqual(request(address, inventory + "/undo", "POST", change)[0], 401)
                        self.assertEqual(request(address, path)[:2], (200, after))

                        later_edit = {**after, "interfaces": [
                            {**port, "ipv4": "192.168.1.24"} if port["id"] == "lan-b" else port
                            for port in after["interfaces"]
                        ]}
                        status, edited, _ = request(address, path, "PUT", later_edit, cookie)
                        self.assertEqual(status, 200)
                        status, undone, _ = request(address, inventory + "/undo", "POST", change, cookie)
                        self.assertEqual(status, 200)
                        self.assertEqual(undone["revision"], edited["revision"] + 1)
                        self.assertEqual([component["id"] for component in undone["components"]], ["plc-a", "plc-b"])
                        self.assertEqual([(port["id"], port["ipv4"]) for port in undone["interfaces"]],
                                         [("lan-a", "192.168.1.10"), ("lan-b", "192.168.1.24")])
                        self.assertEqual(request(address, inventory + "/undo")[0], 204)
                        self.assertEqual(request(address, inventory + "/undo", "POST", change, cookie)[0], 409)
                        self.assertEqual(request(address, path)[:2], (200, undone))

                        status, preview, _ = request(address, inventory + "/preview", "POST", draft, cookie)
                        self.assertEqual(status, 200)
                        status, committed, _ = request(address, inventory + "/commit", "POST",
                                                       {**draft, "stateToken": preview["stateToken"]}, cookie)
                        self.assertEqual(status, 200)
                        after = committed["plan"]
                        change = {"importId": committed["undo"]["importId"]}
                        added = next(port for port in after["interfaces"] if port["name"] == "LAN B2")
                        linked = {**after, "links": [{
                            "id": "new-link", "medium": "wired",
                            "source": {"componentId": "plc-a"},
                            "target": {"componentId": "plc-b", "interfaceId": added["id"]},
                        }]}
                        status, linked, _ = request(address, path, "PUT", linked, cookie)
                        self.assertEqual(status, 200)
                        status, reason, _ = request(address, inventory + "/undo", "POST", change, cookie)
                        self.assertEqual(status, 409)
                        self.assertIn("references an imported", reason["title"])
                        self.assertEqual(request(address, path)[:2], (200, linked))

                        linked["links"] = []
                        linked["interfaces"][0]["protocolProfiles"] = {"profinet": {"stationName": "updated"}}
                        status, edited, _ = request(address, path, "PUT", linked, cookie)
                        self.assertEqual(status, 200)
                        status, unavailable, _ = request(address, inventory + "/undo")
                        self.assertEqual(status, 200)
                        self.assertFalse(unavailable["canUndo"])
                        self.assertIn("changed after import", unavailable["reason"])
                        self.assertEqual(request(address, inventory + "/undo", "POST", change, cookie)[0], 409)
                        self.assertEqual(request(address, path)[:2], (200, edited))

    def test_export_includes_portable_headers_quoted_names_and_components_without_interfaces(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                path, plan = inventory_plan(address, cookie)
                plan["components"].append({"id": "cabinet", "name": "Cabinet", "type": "Other"})
                self.assertEqual(request(address, path, "PUT", plan, cookie)[0], 200)
                with urlopen(address + path + "/inventory.csv", timeout=5) as response:
                    self.assertEqual(response.headers.get_content_type(), "text/csv")
                    self.assertIn("attachment", response.headers["Content-Disposition"])
                    rows = list(csv.reader(StringIO(response.read().decode("utf-8-sig"))))
                self.assertEqual(rows, [
                    ["Component", "Interface", "Component type", "Network", "Network subnet", "IPv4",
                     "Link partner", "Partner port", "Connection type", "Link protocol"],
                    ['Filler, "Line A"', "LAN A", "PLC", "Cell A", "192.168.1.0/24", "192.168.1.10", "", "", "", ""],
                    ["Capper PLC", "LAN B", "PLC", "Cell A", "192.168.1.0/24", "192.168.1.20", "", "", "", ""],
                    ["Cabinet", "", "Other", "", "", "", "", "", "", ""],
                ])

    def test_preview_blocks_populated_subnet_until_it_can_be_imported(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                path, saved = inventory_plan(address, cookie)
                supplied = {"networkSubnet": "192.168.1.0/24", "linkPartner": "Capper PLC",
                            "partnerPort": "LAN B", "connectionType": "Wired", "linkProtocol": "Ethernet"}
                rows = [{"rowNumber": 2, "componentName": 'Filler, "Line A"', "interfaceName": "LAN A",
                         "ipv4": "192.168.1.41", **supplied}]
                status, preview, _ = request(address, path + "/inventory/preview", "POST", {"rows": rows}, cookie)
                self.assertEqual(status, 200)
                self.assertFalse(preview["canApply"])
                messages = " ".join(error["message"] for error in preview["rows"][0]["errors"])
                self.assertIn("Network subnet", messages)
                status, _, _ = request(address, path + "/inventory/commit", "POST",
                                       {"rows": rows, "stateToken": preview["stateToken"]}, cookie)
                self.assertEqual(status, 409)
                self.assertEqual(request(address, path)[:2], (200, saved))

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

    def test_preview_requires_network_id_and_name_to_agree(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                path, saved = inventory_plan(address, cookie)
                saved["networks"].append({"id": "cell-b", "name": "Cell B", "subnet": "192.168.1.0/24"})
                status, saved, _ = request(address, path, "PUT", saved, cookie)
                self.assertEqual(status, 200)
                preview_path = path + "/inventory/preview"
                row = {"rowNumber": 2, "interfaceId": "lan-a", "ipv4": "192.168.1.30"}

                status, preview, _ = request(address, preview_path, "POST", {"rows": [
                    {**row, "networkId": "cell-a", "networkName": "Cell B"},
                ]}, cookie)
                self.assertEqual(status, 200)
                self.assertFalse(preview["canApply"])
                self.assertEqual(preview["rows"][0]["errors"][0]["code"], "inconsistentIds")
                self.assertEqual(request(address, path)[:2], (200, saved))

                for network_columns, expected_id in (
                    ({"networkId": "cell-a", "networkName": "Cell A"}, "cell-a"),
                    ({"networkId": "cell-b"}, "cell-b"),
                    ({"networkName": "Cell B"}, "cell-b"),
                ):
                    with self.subTest(network_columns=network_columns):
                        status, preview, _ = request(address, preview_path, "POST", {"rows": [
                            {**row, **network_columns},
                        ]}, cookie)
                        self.assertEqual(status, 200)
                        self.assertTrue(preview["canApply"])
                        self.assertEqual(preview["rows"][0]["after"]["networkId"], expected_id)

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
                incoming = {"rows": [
                    {"rowNumber": 2, "componentName": "Capper PLC", "interfaceName": "LAN B"},
                    {"rowNumber": 4, "componentName": "Packer PLC", "interfaceName": "LAN E"},
                    {"rowNumber": 5, "componentName": "packer plc", "interfaceName": "LAN F", "componentType": "PLC"},
                ]}

                def preview():
                    status, result, _ = request(address, path + "/inventory/preview", "POST", incoming, cookie)
                    self.assertEqual(status, 200)
                    return result["rows"]

                unique, first, second = preview()
                self.assertEqual(unique["interfaceId"], "lan-b")
                self.assertEqual(first["componentId"], second["componentId"])
                self.assertNotEqual(first["interfaceId"], second["interfaceId"])
                self.assertEqual([row["after"]["componentType"] for row in (first, second)], ["PLC", "PLC"])
                self.assertEqual([row["after"]["componentName"] for row in (first, second)], ["Packer PLC", "Packer PLC"])

                incoming["rows"][1]["componentType"] = "Switch"
                _, first, second = preview()
                self.assertEqual([row["errors"][0]["code"] for row in (first, second)],
                                 ["inconsistentComponentType", "inconsistentComponentType"])

    def test_legacy_name_matches_require_an_explicit_component_then_port_choice(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            with running_api(directory, settings) as address:
                cookie = unlock(address)
                path, plan = inventory_plan(address, cookie)
                plan["components"].append({"id": "plc-c", "name": " CAPPER PLC ", "type": "PLC"})
                plan["interfaces"].append({"id": "lan-c", "componentId": "plc-b", "name": " lan b "})
                seed_legacy_topology(settings, plan)
                draft = {"rows": [{"rowNumber": 2, "componentName": "capper plc",
                                   "interfaceName": " LAN B ", "ipv4": "192.168.1.42"},
                                  {"rowNumber": 3, "interfaceId": "lan-a", "linkPartner": "capper plc",
                                   "partnerPort": " LAN B ", "connectionType": "Wired"}], "answers": {}}

                def preview():
                    status, body, _ = request(address, path + "/inventory/preview", "POST", draft, cookie)
                    self.assertEqual(status, 200)
                    return body

                initial = preview()
                self.assertFalse(initial["canApply"])
                component, = initial["decisions"]
                self.assertEqual({c["id"] for c in component["choices"]}, {"plc-b", "plc-c"})
                self.assertIn("Capper PLC", component["message"])
                self.assertEqual(component["rowNumbers"], [2, 3])
                draft["answers"][component["id"]] = "plc-a"
                self.assertFalse(preview()["canApply"])
                draft["answers"][component["id"]] = "plc-b"
                second = preview()
                self.assertFalse(second["canApply"])
                port, = second["decisions"]
                self.assertEqual(port["rowNumbers"], [2, 3])
                self.assertEqual({c["id"] for c in port["choices"]}, {"lan-b", "lan-c"})
                self.assertIn("Capper PLC", port["message"])
                draft["answers"][port["id"]] = "lan-b"
                resolved = preview()
                self.assertTrue(resolved["canApply"])
                self.assertEqual(resolved["decisions"], [])
                status, body, _ = request(address, path + "/inventory/commit", "POST",
                                          {**draft, "stateToken": resolved["stateToken"]}, cookie)
                self.assertEqual(status, 200)
                link, = body["plan"]["links"]
                self.assertCountEqual([link["source"], link["target"]], [
                    {"componentId": "plc-a", "interfaceId": "lan-a"}, {"componentId": "plc-b", "interfaceId": "lan-b"}])
                self.assertEqual({p["id"]: p["ipv4"] for p in body["plan"]["interfaces"]},
                                 {"lan-a": "192.168.1.10", "lan-b": "192.168.1.42", "lan-c": None})

    def test_repeated_port_references_create_one_port_and_reimport_without_changes(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                path, saved = inventory_plan(address, cookie)
                draft = {"rows": [
                    {"rowNumber": 2, "componentName": "  Switch ", "interfaceName": "P08", "componentType": "Switch"},
                    {"rowNumber": 3, "componentName": "switch", "interfaceName": " p08 ", "componentType": "Switch"},
                ]}
                status, preview, _ = request(address, path + "/inventory/preview", "POST", draft, cookie)
                self.assertEqual(status, 200)
                self.assertTrue(preview["canApply"])
                status, body, _ = request(address, path + "/inventory/commit", "POST",
                                          {**draft, "stateToken": preview["stateToken"]}, cookie)
                self.assertEqual(status, 200)
                switch, = [c for c in body["plan"]["components"] if c["name"] == "Switch"]
                self.assertEqual([p["name"] for p in body["plan"]["interfaces"] if p["componentId"] == switch["id"]], ["P08"])
                status, preview, _ = request(address, path + "/inventory/preview", "POST", draft, cookie)
                self.assertFalse(preview["canApply"])
                self.assertTrue(all(not r["errors"] and not r["hasChanges"] for r in preview["rows"]))

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
