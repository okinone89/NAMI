"""Exercise transfer at the plan package HTTP endpoints."""
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from editor_sessions import PASSPHRASE, request, settings_for
from plan_api import unlock
from startup import postgres_settings, running_api


class PlanPackages(unittest.TestCase):
    def test_only_editors_can_download_a_self_contained_package(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                status, plan, headers = request(
                    address, "/api/plans", "POST", {"name": "Packaging cell"}, cookie
                )
                self.assertEqual(status, 201)
                path = headers["Location"]

                self.assertEqual(request(address, path)[0], 200)
                self.assertEqual(request(address, f"{path}/package")[0], 401)
                self.assertEqual(request(address, "/api/plans/missing/package", cookie=cookie)[0], 404)
                status, package, headers = request(address, f"{path}/package", cookie=cookie)
                self.assertEqual(status, 200)
                self.assertIn("attachment", headers["Content-Disposition"])
                self.assertIn("no-store", headers["Cache-Control"])
                self.assertEqual(package, {"version": 1, "plan": {
                    "name": "Packaging cell", "networks": [], "components": [],
                    "interfaces": [], "links": []
                }})
                for secret in (PASSPHRASE, cookie, plan["id"], str(directory)):
                    self.assertNotIn(secret, str(package))

    def test_import_creates_an_independent_plan_with_a_duplicate_name(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                status, original, headers = request(
                    address, "/api/plans", "POST", {"name": "Packaging cell"}, cookie
                )
                self.assertEqual(status, 201)
                original_path = headers["Location"]
                status, package, _ = request(address, f"{original_path}/package", cookie=cookie)
                self.assertEqual(status, 200)

                self.assertEqual(request(address, "/api/plans/import", "POST", package)[0], 401)
                status, copy, headers = request(address, "/api/plans/import", "POST", package, cookie)
                self.assertEqual(status, 201)
                self.assertEqual(headers["Location"], f"/api/plans/{copy['id']}")
                self.assertNotEqual(copy["id"], original["id"])
                self.assertEqual(request(address, headers["Location"])[:2], (200, copy))
                self.assertEqual(request(address, original_path)[:2], (200, original))
                self.assertEqual({plan["id"]: plan["name"] for plan in request(address, "/api/plans")[1]},
                                 {copy["id"]: original["name"], original["id"]: original["name"]})

    def test_invalid_packages_leave_no_partial_plan_on_either_provider(self):
        plan = {"name": "Packaging cell", "networks": [], "components": [],
                "interfaces": [], "links": []}
        package = {"version": 1, "plan": plan}
        invalid_packages = {
            "unsupported version": {**package, "version": 2},
            "graph omitted": {**package, "plan": {"name": plan["name"]}},
            "graph incomplete": {**package, "plan": {**plan, "links": None}},
            "unknown package fields": {**package, "otherPlanData": []},
            "dangling component reference": {**package, "plan": {**plan, "interfaces": [
                {"id": "lan", "componentId": "missing", "name": "LAN"},
            ]}},
            "invalid IPv4": {**package, "plan": {**plan,
                "components": [{"id": "plc", "name": "PLC", "type": "plc"}],
                "interfaces": [{"id": "lan", "componentId": "plc", "name": "LAN", "ipv4": "192.0.2.999"}],
            }},
            "missing link medium": {**package, "plan": {**plan,
                "components": [{"id": "plc", "name": "PLC", "type": "plc"},
                               {"id": "hmi", "name": "HMI", "type": "hmi"}],
                "links": [{"id": "cable", "source": {"componentId": "plc"}, "target": {"componentId": "hmi"}}],
            }},
        }

        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), ExitStack() as setup:
                directory = Path(setup.enter_context(TemporaryDirectory()))
                settings = settings_for(directory)
                if provider == "PostgreSQL":
                    settings.update(setup.enter_context(postgres_settings(directory)))
                address = setup.enter_context(running_api(directory, settings))
                cookie = unlock(address)
                status, original, headers = request(address, "/api/plans", "POST", {"name": "Destination"}, cookie)
                self.assertEqual(status, 201)
                original_path = headers["Location"]
                before = request(address, "/api/plans")
                for case, invalid in invalid_packages.items():
                    with self.subTest(case=case):
                        status, problem, _ = request(address, "/api/plans/import", "POST", invalid, cookie)
                        self.assertEqual(status, 400)
                        self.assertTrue(problem["title"])
                        self.assertEqual(request(address, "/api/plans")[:2], before[:2])
                        self.assertEqual(request(address, original_path)[:2], (200, original))

    def test_complete_plan_round_trips_in_all_four_provider_directions(self):
        providers = ("SQLite", "PostgreSQL")
        for source_provider in providers:
            for destination_provider in providers:
                with self.subTest(source=source_provider, destination=destination_provider), ExitStack() as setup:
                    source, source_settings = prepare_installation(setup, source_provider)
                    destination, destination_settings = prepare_installation(setup, destination_provider)
                    self.exercise_provider_direction(source, source_settings, destination, destination_settings)

    def exercise_provider_direction(self, source, source_settings, destination, destination_settings):
        # Establish a source graph with every transferable section and a previously accepted duplicate.
        with running_api(source, source_settings) as address:
            cookie = unlock(address)
            status, original, headers = request(address, "/api/plans", "POST", {"name": "Packaging cell"}, cookie)
            self.assertEqual(status, 201)
            original_path = headers["Location"]
            original.update(TRANSFER_GRAPH)
            original["keepAddressConflicts"] = [
                {"networkId": "cell", "ipv4": "192.0.2.20", "interfaceIds": ["uplink", "vm-lan"]},
            ]
            status, original, _ = request(address, original_path, "PUT", original, cookie)
            self.assertEqual(status, 200, original)
            self.assertEqual(original["addressIssues"][0]["code"], "duplicateIpv4")
            status, package, _ = request(address, f"{original_path}/package", cookie=cookie)
            self.assertEqual(status, 200)
            self.assertEqual(package["plan"], {key: original[key] for key in ("name", *TRANSFER_GRAPH)})

            with running_api(destination, destination_settings) as dest_address:
                destination_cookie = unlock(dest_address)
                status, existing, headers = request(
                    dest_address, "/api/plans", "POST", {"name": original["name"]}, destination_cookie
                )
                self.assertEqual(status, 201)
                existing_path = headers["Location"]
                status, copied, headers = request(dest_address, "/api/plans/import", "POST",
                                                  package, destination_cookie)
                self.assertEqual(status, 201, copied)
                copied_path = headers["Location"]
                self.assertNotIn(copied["id"], {original["id"], existing["id"]})
                self.assertEqual(copied, {**original, "id": copied["id"], "revision": 0})

            with running_api(destination, destination_settings) as reopened:
                self.assertEqual(request(reopened, copied_path)[:2], (200, copied))
                self.assertEqual(request(reopened, existing_path)[:2], (200, existing))
                self.assertEqual({plan["id"] for plan in request(reopened, "/api/plans")[1]},
                                 {copied["id"], existing["id"]})
                status, renamed, _ = request(reopened, copied_path, "PUT",
                                             {**copied, "name": "Packaging pilot"}, unlock(reopened))
                self.assertEqual(status, 200, renamed)
                self.assertEqual(renamed["name"], "Packaging pilot")
                self.assertEqual(request(reopened, existing_path)[:2], (200, existing))
            self.assertEqual(request(address, original_path)[:2], (200, original))


def prepare_installation(setup, provider):
    directory = Path(setup.enter_context(TemporaryDirectory()))
    settings = settings_for(directory)
    if provider == "PostgreSQL":
        settings.update(setup.enter_context(postgres_settings(directory)))
    return directory, settings


TRANSFER_GRAPH = {
    "networks": [
        {"id": "cell", "name": "Cell LAN", "subnet": "192.0.2.0/24", "position": {"x": 12, "y": 32},
         "allocationPool": {"start": "192.0.2.20", "end": "192.0.2.40"},
         "excludedIpv4Ranges": [{"start": "192.0.2.21"}, {"start": "192.0.2.22", "end": "192.0.2.29"}]},
    ],
    "components": [
        {"id": "host", "name": "Server", "type": "server", "position": {"x": 36, "y": 54},
         "appearance": {"kind": "builtIn", "symbol": "server"}},
        {"id": "vm", "name": "Runtime", "type": "vm", "hostId": "host", "position": {"x": 48, "y": 160},
         "appearance": {"kind": "custom", "imageData": "data:image/png;base64,"
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="}},
        {"id": "panel", "name": "Operator Panel", "type": "hmi", "position": {"x": 315, "y": 112.5},
         "appearance": {"kind": "shape", "shape": "diamond", "label": "Zone A"}},
    ],
    "interfaces": [
        {"id": "uplink", "componentId": "host", "name": "Uplink", "networkId": "cell", "ipv4": "192.0.2.20"},
        {"id": "vm-lan", "componentId": "vm", "name": "LAN", "networkId": "cell", "ipv4": "192.0.2.20",
         "protocolProfiles": {
             "etherNetIp": {"deviceClass": "scanner"},
             "profinet": {"stationName": "cell-runtime-1", "roles": ["controller", "supervisor"]},
             "modbusTcp": {"role": "server", "serverPort": 502,
                           "downstreamDevices": [{"name": "meter", "unitId": 7}, {"name": "bridge", "unitId": 9}]},
         }},
    ],
    "links": [
        {"id": "host-vm", "source": {"componentId": "host", "interfaceId": "uplink"},
         "target": {"componentId": "vm", "interfaceId": "vm-lan"}, "medium": "virtual", "protocol": "Modbus TCP"},
        {"id": "vm-panel", "source": {"componentId": "vm", "interfaceId": "vm-lan"},
         "target": {"componentId": "panel"}, "medium": "wireless", "protocol": "PROFINET"},
    ],
}
