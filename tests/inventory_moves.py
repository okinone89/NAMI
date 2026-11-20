"""Review, commit and undo cabling changes through the inventory HTTP API."""
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from editor_sessions import request, settings_for
from inventory_import import inventory_plan
from plan_api import unlock
from startup import postgres_settings, running_api


def port(name):
    return {"componentId": "plc-b", "interfaceId": name}


def declares(port_name, number=2, **fields):
    return {"rowNumber": number, "interfaceId": "lan-a", "linkPartner": "Capper PLC",
            "partnerPort": port_name, **fields}


class InventoryMoves(unittest.TestCase):
    def start(self, partners, provider="SQLite"):
        stack = ExitStack()
        self.addCleanup(stack.close)
        directory = Path(stack.enter_context(TemporaryDirectory()))
        settings = settings_for(directory)
        if provider == "PostgreSQL":
            settings.update(stack.enter_context(postgres_settings(directory)))
        self.address = stack.enter_context(running_api(directory, settings))
        self.cookie = unlock(self.address)
        self.path, plan = inventory_plan(self.address, self.cookie)
        plan["interfaces"].extend({"componentId": "plc-b", "id": name, "name": name} for name in ["P07", "P08", "P09"])
        plan["links"] = [{"id": name, "source": port(name),
                          "target": {"componentId": "plc-a", "interfaceId": "lan-a"},
                          "medium": "fiberOptic", "protocol": "EtherCAT"} for name in partners]
        return self.put(plan)

    def put(self, plan):
        status, result, _ = request(self.address, self.path, "PUT", plan, self.cookie)
        self.assertEqual(status, 200, result)
        return result

    def post(self, action, data):
        return request(self.address, self.path + "/inventory/" + action, "POST", data, self.cookie)[:2]

    def preview(self, draft):
        status, result = self.post("preview", draft)
        self.assertEqual(status, 200, result)
        return result

    def apply(self, draft):
        preview = self.preview(draft)
        self.assertTrue(preview["canApply"], preview)
        self.assertEqual(preview["decisions"], [])
        status, saved = self.post("commit", {**draft, "stateToken": preview["stateToken"]})
        self.assertEqual(status, 200, saved)
        return saved

    def test_reciprocal_claim_needs_one_move_or_keep_both_answer(self):
        original = self.start(["P08"])
        draft = {"rows": [declares("P09", connectionType="Wired"),
                          {"rowNumber": 7, "interfaceId": "P08", "linkPartner": 'Filler, "Line A"',
                           "partnerPort": "LAN A"}]}
        preview = self.preview(draft)
        self.assertFalse(preview["canApply"])
        self.assertEqual(self.post("commit", {**draft, "stateToken": preview["stateToken"]})[0], 409)
        decision, = preview["decisions"]
        self.assertEqual(decision["rowNumbers"], [2, 7])
        move, = [c for c in decision["choices"] if "Move" in c["label"]]
        keep, = [c for c in decision["choices"] if "Keep both" in c["label"]]
        kept = self.apply({**draft, "answers": {decision["id"]: keep["id"]}})
        self.assertEqual(len(kept["plan"]["links"]), 2)
        self.assertIn(original["links"][0], kept["plan"]["links"])
        self.assertEqual(self.post("undo", {"importId": kept["undo"]["importId"]})[0], 200)
        moved = self.apply({**draft, "answers": {decision["id"]: move["id"]}})
        self.assertEqual(moved["plan"]["links"], [{**original["links"][0], "source": port("P09"), "medium": "wired"}])

    def test_selected_multi_peer_rows_protect_retained_links_and_offer_specific_moves(self):
        original = self.start(["P07", "P08"])
        draft = {"rows": [declares("P09", connectionType="Virtual")]}
        ambiguous = self.preview(draft)
        decision, = ambiguous["decisions"]
        self.assertTrue(all(any(name in choice["label"] for choice in decision["choices"])
                            for name in ["P07", "P08", "Add"]))
        chosen = self.apply({**draft, "answers": {decision["id"]: "move:P07"}})
        first, second = original["links"]
        self.assertEqual(chosen["plan"]["links"], [{**first, "source": port("P09"), "medium": "virtual"}, second])
        self.assertEqual(self.post("undo", {"importId": chosen["undo"]["importId"]})[0], 200)
        retained = self.apply({"rows": [declares("P07"), declares("P09", 3)]})
        self.assertEqual(retained["plan"]["links"], [first, {**second, "source": port("P09")}])
        added = self.apply({"rows": [declares("P07"), declares("P09", 3), declares("P08", 4, connectionType="Wired")]})
        self.assertEqual(len(added["plan"]["links"]), 3)
        self.assertTrue(all(link in added["plan"]["links"] for link in retained["plan"]["links"]))

    def test_two_new_targets_cannot_silently_claim_the_same_installed_link(self):
        original = self.start(["P08"])
        draft = {"rows": [declares("P07", connectionType="Virtual"), declares("P09", 3, connectionType="Wired")]}
        waiting = self.preview(draft)
        self.assertFalse(waiting["canApply"], waiting)
        first = waiting["decisions"][0]
        self.assertEqual(first, self.preview({"rows": draft["rows"][::-1]})["decisions"][0])
        selected = self.apply({**draft, "answers": {first["id"]: "move:P08"}})
        self.assertEqual(len(selected["plan"]["links"]), 2)
        moved, = [link for link in selected["plan"]["links"] if link["id"] == original["links"][0]["id"]]
        self.assertEqual(moved["source"], port("P07"))

    def test_explicit_removal_is_exact_stale_checked_and_reversible_on_both_providers(self):
        for provider in ["SQLite", "PostgreSQL"]:
            with self.subTest(provider=provider):
                original = self.start(["P07", "P08", "P09"], provider)
                draft = {"rows": [{"rowNumber": 2, "interfaceId": "lan-a"}]}
                self.assertFalse(self.preview(draft)["canApply"])
                draft["rows"][0]["removeLinkIds"] = ["P08"]
                stale = self.preview(draft)
                self.assertTrue(stale["canApply"], stale)
                original["links"][1]["protocol"] = "Fieldbus"
                latest = self.put(original)
                self.assertEqual(self.post("commit", {**draft, "stateToken": stale["stateToken"]})[0], 409)
                removed = self.apply(draft)
                self.assertEqual(removed["plan"]["links"], [latest["links"][0], latest["links"][2]])
                undo = {"importId": removed["undo"]["importId"]}
                status, restored = self.post("undo", undo)
                self.assertEqual(status, 200, restored)
                self.assertEqual(restored["links"], latest["links"])
                removed = self.apply(draft)
                edited = removed["plan"]
                edited["interfaces"] = [p for p in edited["interfaces"] if p["id"] != "P08"]
                self.put(edited)
                self.assertEqual(self.post("undo", {"importId": removed["undo"]["importId"]})[0], 409)

    def test_confirmed_rename_and_wiring_move_keep_the_original_records(self):
        original = self.start(["P08"])
        draft = {"rows": [{"rowNumber": 2, "componentName": "New controller", "interfaceName": "LAN A",
                           "networkName": "Cell A", "ipv4": "192.168.1.10",
                           "linkPartner": "Capper PLC", "partnerPort": "P09"}]}
        pending = self.preview(draft)
        self.assertEqual(pending["links"], [])
        rename, = pending["decisions"]
        choice, = [c for c in rename["choices"] if c["label"].startswith("Rename existing component")]
        draft["answers"] = {rename["id"]: choice["id"]}
        preview = self.preview(draft)
        self.assertEqual(preview["links"][0]["summary"],
                         "Move New controller / LAN A from Capper PLC / P08 to Capper PLC / P09")
        saved = self.apply(draft)
        self.assertEqual(saved["plan"]["components"][0], {**original["components"][0], "name": "New controller"})
        self.assertEqual(saved["plan"]["links"], [{**original["links"][0], "source": port("P09")}])
        status, undone = self.post("undo", {"importId": saved["undo"]["importId"]})
        self.assertEqual(status, 200, undone)
        self.assertEqual(undone, {**original, "revision": original["revision"] + 2})

    def test_removal_distinguishes_parallel_links_between_the_same_ports(self):
        plan = self.start(["P08"])
        plan["links"].append({**plan["links"][0], "id": "spare", "protocol": "Modbus"})
        original = self.put(plan)
        row = {"rowNumber": 2, "interfaceId": "lan-a"}
        choices = self.preview({"rows": [row]})["rows"][0]["connections"]
        self.assertEqual(len({choice["label"] for choice in choices}), 2)
        removed = self.apply({"rows": [{**row, "removeLinkIds": ["spare"]}]})
        self.assertEqual(removed["plan"]["links"], [original["links"][0]])

    def test_new_partner_since_preview_reopens_move_choice_without_writing_any_row(self):
        original = self.start(["P08"])
        draft = {"rows": [declares("P09", ipv4="192.168.1.19")]}
        ready = self.preview(draft)
        self.assertTrue(ready["canApply"])
        original["links"].append({**original["links"][0], "id": "new-cable", "source": port("P07")})
        latest = self.put(original)
        status, refreshed = self.post("commit", {**draft, "stateToken": ready["stateToken"]})
        self.assertEqual(status, 409)
        self.assertFalse(refreshed["canApply"])
        decision, = refreshed["decisions"]
        self.assertCountEqual([choice["id"] for choice in decision["choices"]], ["move:P08", "move:new-cable", "add"])
        self.assertEqual(request(self.address, self.path)[:2], (200, latest))

    def test_replacement_retains_the_link_and_its_metadata(self):
        original = self.start(["P08"])
        saved = self.apply({"rows": [declares("P09")]})
        self.assertEqual(saved["plan"]["links"], [{**original["links"][0], "source": port("P09")}])
        status, undone = self.post("undo", {"importId": saved["undo"]["importId"]})
        self.assertEqual(status, 200, undone)
        self.assertEqual(undone["links"], original["links"])


if __name__ == "__main__":
    unittest.main()
