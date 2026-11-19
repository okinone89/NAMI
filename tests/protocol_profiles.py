"""Exercise interface protocol profiles through the plan API on both providers."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from editor_sessions import request, settings_for
from plan_api import unlock
from startup import postgres_settings, running_api


class ProtocolProfiles(unittest.TestCase):
    def test_optional_profiles_round_trip_on_sqlite(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            self.exercise_profiles(directory, settings_for(directory))

    def test_optional_profiles_round_trip_on_postgresql(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with postgres_settings(directory) as postgres:
                self.exercise_profiles(directory, {**settings_for(directory), **postgres})

    def exercise_profiles(self, directory, settings):
        gateway = {"id": "gateway-lan", "componentId": "gateway", "name": "LAN",
                   "networkId": "plant", "ipv4": "192.0.2.10"}
        generic = {"id": "terminal-lan", "componentId": "terminal", "name": "LAN",
                   "networkId": "plant", "ipv4": "192.0.2.11"}
        link = {"id": "gateway-link", "source": {"componentId": "gateway", "interfaceId": "gateway-lan"},
                "target": {"componentId": "terminal", "interfaceId": "terminal-lan"},
                "medium": "wireless", "protocol": "Modbus TCP"}
        profiles = {
            "etherNetIp": {},
            "profinet": {"stationName": "skid-a", "roles": ["controller", "device", "supervisor"]},
            "modbusTcp": {"role": "server", "serverPort": 1502, "downstreamDevices": [
                {"name": "Meter A", "unitId": 1}, {"name": "Meter B", "unitId": 2},
                {"name": "Spare meter"},
            ]},
        }
        with running_api(directory, settings) as address:
            cookie = unlock(address)
            status, plan, headers = request(address, "/api/plans", "POST", {"name": "Meter skid"}, cookie)
            self.assertEqual(status, 201)
            path = headers["Location"]
            plan.update(
                networks=[{"id": "plant", "name": "Plant"}],
                components=[{"id": "gateway", "name": "Main gateway", "type": "Gateway"},
                            {"id": "terminal", "name": "Terminal", "type": "Computer"}],
                interfaces=[gateway, generic],
                links=[link],
            )
            status, saved, _ = request(address, path, "PUT", plan, cookie)
            self.assertEqual(status, 200)
            self.assertEqual(saved["interfaces"], [gateway, generic])

        with running_api(directory, settings) as address:
            status, current, _ = request(address, path)
            self.assertEqual(status, 200)
            self.assertEqual(current["interfaces"], [gateway, generic])
            cookie = unlock(address)
            current["interfaces"][0]["protocolProfiles"] = profiles
            status, saved, _ = request(address, path, "PUT", current, cookie)
            self.assertEqual(status, 200)
            self.assertEqual(saved["interfaces"], [{**gateway, "protocolProfiles": profiles}, generic])

        with running_api(directory, settings) as address:
            self.assertEqual(request(address, path)[:2], (200, saved))
            cookie = unlock(address)
            updated_profiles = {**profiles, "etherNetIp": {"deviceClass": "adapter"}}
            saved["interfaces"][0]["protocolProfiles"] = updated_profiles
            status, updated, _ = request(address, path, "PUT", saved, cookie)
            self.assertEqual(status, 200)
            self.assertEqual(updated["interfaces"], [{**gateway, "protocolProfiles": updated_profiles}, generic])

        with running_api(directory, settings) as address:
            status, reopened, _ = request(address, path)
            self.assertEqual(status, 200)
            self.assertEqual(reopened["interfaces"], updated["interfaces"])
            self.assertEqual(reopened["links"], [link])
            self.assertEqual(reopened["components"][0]["name"], "Main gateway")


if __name__ == "__main__":
    unittest.main()
