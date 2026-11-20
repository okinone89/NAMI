"""Release check for name-based inventory exchange across distinct plans."""
from contextlib import nullcontext
import csv
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from urllib.request import urlopen

from editor_sessions import request, settings_for
from plan_api import unlock
from startup import postgres_settings, running_api


FIELDS = {
    "Component": "componentName", "Interface": "interfaceName", "Component type": "componentType",
    "Network": "networkName", "Network subnet": "networkSubnet", "IPv4": "ipv4",
    "Link partner": "linkPartner", "Partner port": "partnerPort",
    "Connection type": "connectionType", "Link protocol": "linkProtocol",
}


def export(address, path):
    with urlopen(address + path + "/inventory.csv", timeout=5) as response:
        csv_text = response.read().decode("utf-8-sig")
    return list(csv.DictReader(StringIO(csv_text)))


def draft(rows):
    return {"rows": [
        {"rowNumber": number, **{FIELDS[key]: value for key, value in row.items() if value}}
        for number, row in enumerate(rows, 2)
    ]}


class InventoryRoundTrip(unittest.TestCase):
    def test_exchange_connected_inventory_repeat_and_undo(self):
        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), TemporaryDirectory() as tmp:
                directory = Path(tmp)
                database = postgres_settings(directory) if provider == "PostgreSQL" else nullcontext({})
                with database as settings, running_api(directory, {**settings_for(directory), **settings}) as address:
                    self.exchange(address)

    def exchange(self, address):
        cookie = unlock(address)

        def create(name):
            status, plan, headers = request(address, "/api/plans", "POST", {"name": name}, cookie)
            self.assertEqual(status, 201)
            return headers["Location"], plan

        origin, source = create("Machine line")
        destination, empty = create("Independent copy")
        source.update(networks=[
            {"id": "line", "name": "Line", "subnet": "10.8.0.0/24"},
            {"id": "bench", "name": "Bench", "subnet": "10.8.0.0/24"},
            {"id": "spare", "name": "Spare"},
        ], components=[
            {"id": "s", "name": 'Switch, "one"', "type": "Switch"},
            {"id": "p", "name": "PLC", "type": "PLC"},
            {"id": "b", "name": "Bench PLC", "type": "PLC"},
            {"id": "c", "name": "Cabinet", "type": "Other"},
        ], interfaces=[
            {"id": "s1", "componentId": "s", "name": "P1"},
            {"id": "p1", "componentId": "p", "name": "LAN", "networkId": "line", "ipv4": "10.8.0.5"},
            {"id": "b1", "componentId": "b", "name": "LAN", "networkId": "bench", "ipv4": "10.8.0.5"},
        ], links=[
            {"id": "a", "source": {"componentId": "p", "interfaceId": "p1"},
             "target": {"componentId": "s", "interfaceId": "s1"}, "medium": "fiberOptic", "protocol": "OPC UA"},
            {"id": "b", "source": {"componentId": "c"}, "target": {"componentId": "s", "interfaceId": "s1"},
             "medium": "wired"},
        ])
        self.assertEqual(request(address, origin, "PUT", source, cookie)[0], 200)
        rows = export(address, origin)
        inventory = destination + "/inventory"
        first = draft(reversed(rows))
        status, preview, _ = request(address, inventory + "/preview", "POST", first, cookie)
        self.assertEqual(status, 200)
        self.assertTrue(preview["canApply"], preview)
        status, result, _ = request(address, inventory + "/commit", "POST",
                                    {**first, "stateToken": preview["stateToken"]}, cookie)
        self.assertEqual(status, 200, result)
        saved = result["plan"]
        self.assertEqual([len(saved[k]) for k in ("networks", "components", "interfaces", "links")], [3, 4, 3, 2])
        self.assertCountEqual(export(address, destination), rows)
        status, repeated, _ = request(address, inventory + "/preview", "POST", draft(rows), cookie)
        self.assertEqual(status, 200)
        self.assertFalse(any(row["hasChanges"] for row in repeated["rows"]), repeated)
        self.assertFalse(repeated.get("decisions"), repeated)
        self.assertEqual(request(address, destination)[1], saved)
        undo = result["undo"]["importId"]
        self.assertEqual(request(address, inventory + "/undo")[1]["importId"], undo)
        status, restored, _ = request(address, inventory + "/undo", "POST", {"importId": undo}, cookie)
        self.assertEqual(status, 200, restored)
        for collection in ("networks", "components", "interfaces", "links"):
            self.assertEqual(restored[collection], empty[collection])
