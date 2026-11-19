"""Exercise IPv4 assignment and conflict handling through the plan API."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from editor_sessions import request, settings_for
from plan_api import unlock
from startup import postgres_settings, running_api


def create_address_plan(address, cookie):
    _, plan, headers = request(address, "/api/plans", "POST", {"name": "Cell addressing"}, cookie)
    plan.update(
        networks=[{"id": "cell-a", "name": "Cell A"}, {"id": "cell-b", "name": "Cell B"}],
        components=[{"id": "plc-a", "name": "Filler PLC", "type": "PLC"},
                    {"id": "plc-b", "name": "Capper PLC", "type": "PLC"}],
        interfaces=[{"id": "lan-a", "componentId": "plc-a", "name": "LAN A",
                     "networkId": "cell-a", "ipv4": "192.168.1.10"},
                    {"id": "lan-b", "componentId": "plc-b", "name": "LAN B",
                     "networkId": "cell-b", "ipv4": "192.168.1.10"}],
    )
    return headers["Location"], plan


class AddressValidation(unittest.TestCase):
    def test_optional_subnet_checks_syntax_and_range(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                path, plan = create_address_plan(address, cookie)
                status, plan, _ = request(address, path, "PUT", plan, cookie)
                self.assertEqual(status, 200)  # Isolated networks may reuse the same address.
                for value in ("192.168.1", "192.168.1.256", "192.168.01.10", "2001:db8::1"):
                    with self.subTest(ipv4=value):
                        invalid = deepcopy(plan)
                        invalid["interfaces"][0]["ipv4"] = value
                        status, problem, _ = request(address, path, "PUT", invalid, cookie)
                        self.assertEqual(status, 400)
                        self.assertEqual(problem["addressIssues"][0]["code"], "invalidIpv4")
                invalid = deepcopy(plan)
                invalid["networks"][0]["subnet"] = "192.168.1.0/33"
                status, problem, _ = request(address, path, "PUT", invalid, cookie)
                self.assertEqual(status, 400)
                self.assertEqual(problem["addressIssues"][0]["code"], "invalidSubnet")
                invalid["networks"][0]["subnet"] = "192.168.2.0/24"
                status, problem, _ = request(address, path, "PUT", invalid, cookie)
                self.assertEqual(status, 400)
                self.assertEqual(problem["addressIssues"][0]["code"], "outsideSubnet")
                invalid["networks"][0]["subnet"] = "192.168.1.0/24"
                status, saved, _ = request(address, path, "PUT", invalid, cookie)
                self.assertEqual(status, 200)
                self.assertEqual(saved["networks"][0]["subnet"], "192.168.1.0/24")
                self.assertEqual(saved["addressIssues"], [])
                saved["networks"][0]["subnet"] = "192.168.1.10/32"
                status, single_host, _ = request(address, path, "PUT", saved, cookie)
                self.assertEqual(status, 200)
                single_host["interfaces"][0]["ipv4"] = "192.168.1.11"
                self.assertEqual(request(address, path, "PUT", single_host, cookie)[0], 400)

    def test_keep_requires_the_exact_duplicate_and_reopening_shows_both_interfaces(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            with running_api(directory, settings) as address:
                cookie = unlock(address)
                path, plan = create_address_plan(address, cookie)
                status, saved, _ = request(address, path, "PUT", plan, cookie)
                self.assertEqual(status, 200)
                moved = deepcopy(saved)
                moved["interfaces"][1]["networkId"] = "cell-a"
                status, problem, _ = request(address, path, "PUT", moved, cookie)
                self.assertEqual(status, 409)
                issue, = problem["addressIssues"]
                self.assertEqual(issue["code"], "duplicateIpv4")
                self.assertEqual(issue["ipv4"], "192.168.1.10")
                self.assertEqual(issue["networkId"], "cell-a")
                self.assertEqual(issue["networkName"], "Cell A")
                self.assertEqual(issue["interfaces"], [
                    {"interfaceId": "lan-a", "interfaceName": "LAN A",
                     "componentId": "plc-a", "componentName": "Filler PLC"},
                    {"interfaceId": "lan-b", "interfaceName": "LAN B",
                     "componentId": "plc-b", "componentName": "Capper PLC"},
                ])
                self.assertIn("already assigned", issue["message"])
                self.assertEqual(request(address, path)[:2], (200, saved))

                moved["keepAddressConflicts"] = [
                    {"networkId": "cell-a", "ipv4": "192.168.1.10", "interfaceIds": ["lan-a", "another"]}
                ]
                self.assertEqual(request(address, path, "PUT", moved, cookie)[0], 409)
                moved["keepAddressConflicts"][0]["interfaceIds"] = ["lan-b", "lan-a"]
                status, kept, _ = request(address, path, "PUT", moved, cookie)
                self.assertEqual(status, 200)
                self.assertEqual(kept["addressIssues"], [issue])

            with running_api(directory, settings) as address:
                self.assertEqual(request(address, path)[:2], (200, kept))
                cookie = unlock(address)
                kept["components"][0]["name"] = "Filler PLC renamed"
                status, renamed, _ = request(address, path, "PUT", kept, cookie)
                self.assertEqual(status, 200)
                self.assertEqual(renamed["addressIssues"][0]["interfaces"][0]["componentName"],
                                 "Filler PLC renamed")
                renamed["interfaces"][1]["ipv4"] = "192.168.1.11"
                status, corrected, _ = request(address, path, "PUT", renamed, cookie)
                self.assertEqual(status, 200)
                self.assertEqual(corrected["addressIssues"], [])
                self.assertEqual(request(address, path)[:2], (200, corrected))

    def test_overlapping_assignment_cannot_save_a_duplicate_on_either_provider(self):
        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), TemporaryDirectory() as tmp:
                directory = Path(tmp)
                if provider == "PostgreSQL":
                    with postgres_settings(directory) as postgres:
                        self.exercise_overlapping_assignment(directory, {**settings_for(directory), **postgres})
                else:
                    self.exercise_overlapping_assignment(directory, settings_for(directory))

    def exercise_overlapping_assignment(self, directory, settings):
        with running_api(directory, settings) as address:
            first_cookie = unlock(address)
            second_cookie = unlock(address)
            path, plan = create_address_plan(address, first_cookie)
            plan["interfaces"][0]["ipv4"] = None
            plan["interfaces"][1].update(networkId="cell-a", ipv4=None)
            status, saved, _ = request(address, path, "PUT", plan, first_cookie)
            self.assertEqual(status, 200)
            first, second = deepcopy(saved), deepcopy(saved)
            first["interfaces"][0]["ipv4"] = "192.168.1.25"
            second["interfaces"][1]["ipv4"] = "192.168.1.25"
            with ThreadPoolExecutor(max_workers=2) as editors:
                responses = [editors.submit(request, address, path, "PUT", draft, cookie)
                             for draft, cookie in ((first, first_cookie), (second, second_cookie))]
                self.assertEqual(sorted(response.result()[0] for response in responses), [200, 409])
            status, current, _ = request(address, path)
            self.assertEqual(status, 200)
            self.assertEqual(current["revision"], saved["revision"] + 1)
            self.assertEqual(current["addressIssues"], [])
            self.assertEqual([port["ipv4"] for port in current["interfaces"]].count("192.168.1.25"), 1)
            for port in current["interfaces"]:
                port["ipv4"] = "192.168.1.25"
            status, problem, _ = request(address, path, "PUT", current, second_cookie)
            self.assertEqual(status, 409)
            self.assertEqual(problem["addressIssues"][0]["code"], "duplicateIpv4")


if __name__ == "__main__":
    unittest.main()
