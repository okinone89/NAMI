"""Exercise self-contained component appearances through the plan API."""
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from editor_sessions import request, settings_for
from plan_api import unlock
from startup import postgres_settings, running_api


PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/"
    "ScLbtAAAAABJRU5ErkJggg=="
)


class ComponentAppearance(unittest.TestCase):
    def test_plan_reopens_with_self_contained_appearances(self):
        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), TemporaryDirectory() as tmp:
                directory = Path(tmp)
                config = postgres_settings(directory) if provider == "PostgreSQL" else nullcontext({})
                with config as provider_settings:
                    self.exercise_persistence(directory, {**settings_for(directory), **provider_settings})

    def exercise_persistence(self, directory, settings):
        appearances = [
            {"kind": "builtIn", "symbol": "plc"},
            {"kind": "custom", "imageData": PNG},
            {"kind": "shape", "shape": "ellipse", "label": "Test bench"},
        ]
        with running_api(directory, settings) as address:
            cookie = unlock(address)
            status, plan, headers = request(address, "/api/plans", "POST", {"name": "Controls"}, cookie)
            self.assertEqual(status, 201)
            path = headers["Location"]
            plan["components"] = [
                {"id": "controller", "name": "Controller", "type": "PLC", "appearance": appearances[0]},
                {"id": "panel", "name": "Operator panel", "type": "HMI", "appearance": appearances[1]},
                {"id": "bench", "name": "Bench computer", "type": "Computer", "appearance": appearances[2]},
                {"id": "switch", "name": "Cell switch", "type": "Switch"},
            ]
            self.assertEqual(request(address, path, "PUT", plan, cookie)[0], 200)

        with running_api(directory, settings) as address:
            status, reopened, _ = request(address, path)
            self.assertEqual(status, 200)
            self.assertEqual(
                [(component["id"], component.get("appearance")) for component in reopened["components"]],
                [("controller", appearances[0]), ("panel", appearances[1]), ("bench", appearances[2]), ("switch", None)],
            )

    def test_rejects_non_embedded_or_mislabeled_icon_data(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                cookie = unlock(address)
                status, plan, headers = request(address, "/api/plans", "POST", {"name": "Controls"}, cookie)
                self.assertEqual(status, 201)
                path = headers["Location"]
                for data in ("https://example.test/icon.png", PNG.replace("image/png", "image/jpeg")):
                    with self.subTest(image_data=data.split(",", 1)[0]):
                        edited = {**plan, "components": [{
                            "id": "panel", "name": "Operator panel", "type": "HMI",
                            "appearance": {"kind": "custom", "imageData": data},
                        }]}
                        self.assertEqual(request(address, path, "PUT", edited, cookie)[0], 400)
                        self.assertEqual(request(address, path)[:2], (200, plan))


if __name__ == "__main__":
    unittest.main()
