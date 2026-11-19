"""Exercise IPv4 allocation through the plan API."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from editor_sessions import request, settings_for
from plan_api import unlock
from startup import postgres_settings, running_api


def create_allocation_plan(address, cookie):
    _, plan, headers = request(address, "/api/plans", "POST", {"name": "Cell addressing"}, cookie)
    path = headers["Location"]
    plan.update(
        networks=[{"id": "cell", "name": "Cell LAN", "subnet": "192.168.1.0/24"},
                  {"id": "isolated", "name": "Isolated LAN", "subnet": "192.168.1.0/24"}],
        components=[{"id": "station", "name": "Filler", "type": "PLC"}],
        interfaces=[
            {"id": port_id, "componentId": "station", "name": port_id,
             "networkId": network_id, "ipv4": ipv4}
            for port_id, network_id, ipv4 in (
                ("plc", "cell", "192.168.1.20"),
                ("hmi", "cell", None),
                ("drive", "cell", None),
                ("spare", "cell", None),
                ("isolated-plc", "isolated", "192.168.1.30"),
            )
        ],
    )
    status, saved, _ = request(address, path, "PUT", plan, cookie)
    if status != 200:
        raise AssertionError(f"Plan setup failed with HTTP {status}: {saved}")
    return path, saved


class AddressAllocation(unittest.TestCase):
    def test_suggests_lowest_free_address_from_saved_pool_without_assigning_it(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            with running_api(directory, settings) as address:
                cookie = unlock(address)
                path, saved = create_allocation_plan(address, cookie)
                allocation = f"{path}/address-allocation"
                selection = {"interfaceIds": ["hmi"]}
                status, preview, _ = request(address, f"{allocation}/preview", "POST", selection, cookie)
                self.assertEqual(status, 200)
                self.assertEqual(preview["assignments"][0]["ipv4"], "192.168.1.1")
                self.assertEqual(request(address, path)[:2], (200, saved))

                saved["networks"][0].update(
                    allocationPool={"start": "192.168.1.20", "end": "192.168.1.40"},
                    excludedIpv4Ranges=[{"start": "192.168.1.21"},
                                        {"start": "192.168.1.22", "end": "192.168.1.29"}],
                )
                status, configured, _ = request(address, path, "PUT", saved, cookie)
                self.assertEqual(status, 200)

            with running_api(directory, settings) as address:
                self.assertEqual(request(address, path)[:2], (200, configured))
                cookie = unlock(address)
                status, preview, _ = request(address, f"{allocation}/preview", "POST", selection, cookie)
                self.assertEqual(status, 200)
                self.assertTrue(preview["canApply"])
                self.assertEqual(preview["assignments"], [
                    {"interfaceId": "hmi", "networkId": "cell", "ipv4": "192.168.1.30",
                     "status": "proposed"},
                ])
                self.assertEqual(request(address, path)[:2], (200, configured))

    def test_overlapping_batches_refresh_and_write_none_of_the_losing_batch_on_both_providers(self):
        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), TemporaryDirectory() as tmp:
                directory = Path(tmp)
                settings = settings_for(directory)
                if provider == "PostgreSQL":
                    with postgres_settings(directory) as postgres:
                        self.exercise_overlapping_batches(directory, {**settings, **postgres})
                else:
                    self.exercise_overlapping_batches(directory, settings)

    def exercise_overlapping_batches(self, directory, settings):
        with running_api(directory, settings) as address:
            first_cookie = unlock(address)
            second_cookie = unlock(address)
            path, plan = create_allocation_plan(address, first_cookie)
            allocation = f"{path}/address-allocation"
            selections = [
                (first_cookie, ["hmi", "drive", "plc"], ["192.168.1.1", "192.168.1.2", "192.168.1.20"]),
                (second_cookie, ["spare"], ["192.168.1.1"]),
            ]
            drafts = []
            for cookie, ids, expected in selections:
                status, preview, _ = request(address, f"{allocation}/preview", "POST",
                                             {"interfaceIds": ids}, cookie)
                self.assertEqual(status, 200)
                self.assertEqual([assignment["ipv4"] for assignment in preview["assignments"]], expected)
                drafts.append((cookie, {"interfaceIds": ids, **preview}))

            self.assertEqual(request(address, f"{allocation}/commit", "POST", drafts[0][1])[0], 401)
            self.assertEqual(request(address, path)[:2], (200, plan))
            with ThreadPoolExecutor(max_workers=2) as editors:
                responses = [editors.submit(request, address, f"{allocation}/commit", "POST", draft, cookie)
                             for cookie, draft in drafts]
                results = [response.result() for response in responses]
            statuses = [result[0] for result in results]
            self.assertEqual(sorted(statuses), [200, 409])
            winner, loser = statuses.index(200), statuses.index(409)
            saved, refreshed = results[winner][1], results[loser][1]
            expected_after_race = {
                "plc": "192.168.1.20", "isolated-plc": "192.168.1.30",
                "hmi": "192.168.1.1" if winner == 0 else None,
                "drive": "192.168.1.2" if winner == 0 else None,
                "spare": "192.168.1.1" if winner == 1 else None,
            }
            self.assertEqual(saved["revision"], plan["revision"] + 1)
            self.assertEqual({port["id"]: port["ipv4"] for port in saved["interfaces"]}, expected_after_race)
            self.assertEqual(request(address, path)[:2], (200, saved))
            self.assertEqual(refreshed["revision"], saved["revision"])
            self.assertTrue(refreshed["canApply"])
            expected_refresh = ["192.168.1.3"] if loser == 1 else ["192.168.1.2", "192.168.1.3", "192.168.1.20"]
            self.assertEqual([assignment["ipv4"] for assignment in refreshed["assignments"]], expected_refresh)

            cookie, draft = drafts[loser]
            status, confirmed, _ = request(address, f"{allocation}/commit", "POST",
                                           {**draft, **refreshed}, cookie)
            self.assertEqual(status, 200)
            self.assertEqual(confirmed["revision"], saved["revision"] + 1)
            for assignment in refreshed["assignments"]:
                expected_after_race[assignment["interfaceId"]] = assignment["ipv4"]
            self.assertEqual({port["id"]: port["ipv4"] for port in confirmed["interfaces"]}, expected_after_race)
            self.assertEqual(request(address, path)[:2], (200, confirmed))

    def test_exhausted_pool_and_incomplete_confirmation_write_no_assignments(self):
        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), TemporaryDirectory() as tmp:
                directory = Path(tmp)
                settings = settings_for(directory)
                if provider == "PostgreSQL":
                    with postgres_settings(directory) as postgres:
                        self.exercise_exhausted_pool(directory, {**settings, **postgres})
                else:
                    self.exercise_exhausted_pool(directory, settings)

    def exercise_exhausted_pool(self, directory, settings):
        with running_api(directory, settings) as address:
            cookie = unlock(address)
            path, saved = create_allocation_plan(address, cookie)
            saved["networks"][0]["allocationPool"] = {"start": "192.168.1.30", "end": "192.168.1.31"}
            status, configured, _ = request(address, path, "PUT", saved, cookie)
            self.assertEqual(status, 200)
            allocation = f"{path}/address-allocation"

            selection = {"interfaceIds": ["hmi", "drive", "spare"]}
            status, preview, _ = request(address, f"{allocation}/preview", "POST", selection, cookie)
            self.assertEqual(status, 200)
            self.assertFalse(preview["canApply"])
            self.assertEqual([(item["status"], item["ipv4"]) for item in preview["assignments"]], [
                ("proposed", "192.168.1.30"), ("proposed", "192.168.1.31"), ("exhausted", None),
            ])
            self.assertEqual(request(address, f"{allocation}/commit", "POST",
                                     {**selection, **preview}, cookie)[:2], (409, preview))
            self.assertEqual(request(address, path)[:2], (200, configured))

            selection["interfaceIds"].remove("spare")
            status, preview, _ = request(address, f"{allocation}/preview", "POST", selection, cookie)
            self.assertEqual(status, 200)
            self.assertTrue(preview["canApply"])
            incomplete = {**selection, **preview, "assignments": preview["assignments"][:1]}
            self.assertEqual(request(address, f"{allocation}/commit", "POST",
                                     incomplete, cookie)[:2], (409, preview))
            self.assertEqual(request(address, path)[:2], (200, configured))

    def test_rejects_unusable_pool_settings_and_suggestions_without_a_subnet(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                path, saved = create_allocation_plan(address, cookie)
                for fields in (
                    {"allocationPool": {"start": "192.168.1.0", "end": "192.168.1.30"}},
                    {"allocationPool": {"start": "192.168.1.31", "end": "192.168.1.30"}},
                    {"excludedIpv4Ranges": [{"start": "192.168.1.29", "end": "192.168.2.1"}]},
                    {"subnet": None, "excludedIpv4Ranges": [{"start": "192.168.1.21"}]},
                ):
                    invalid = {**saved, "networks": [{**saved["networks"][0], **fields}, saved["networks"][1]]}
                    status, problem, _ = request(address, path, "PUT", invalid, cookie)
                    self.assertEqual(status, 400)
                    self.assertEqual(problem["addressIssues"][0]["code"], "invalidAllocationSettings")
                    self.assertEqual(request(address, path)[:2], (200, saved))

                saved["networks"][0]["subnet"] = None
                self.assertEqual(request(address, path, "PUT", saved, cookie)[0], 200)
                status, preview, _ = request(address, f"{path}/address-allocation/preview", "POST",
                                             {"interfaceIds": ["hmi"]}, cookie)
                self.assertEqual(status, 200)
                self.assertFalse(preview["canApply"])
                self.assertEqual(preview["assignments"][0]["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
