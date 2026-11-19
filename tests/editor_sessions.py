"""HTTP integration tests for the shared editor session."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from startup import running_api

TEST_HOST = Path(__file__).resolve().parent / "EditorSessionHost/bin/Debug/net10.0/EditorSessionHost.dll"
SESSION = "/api/editor-session"
PASSPHRASE = "test-only workshop phrase"
READ_ONLY = {"canEdit": False, "expiresAt": None}
FILLER = "/api/test-plans/filler"


def settings_for(directory, passphrase=PASSPHRASE):
    return {"Database__Provider": "SQLite", "Database__File": str(directory / "nami.db"),
            "Editor__Passphrase": passphrase, "ASPNETCORE_ENVIRONMENT": "Production"}


def request(address, path, method="GET", data=None, cookie=None, headers=None):
    headers = dict(headers or {})
    if cookie:
        headers["Cookie"] = cookie
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode()
    try:
        response = urlopen(Request(address + path, data=body, headers=headers, method=method), timeout=5)
    except HTTPError as error:
        response = error
    with response:
        body = response.read()
        return response.status, json.loads(body) if body else None, response.headers


class EditorSessions(unittest.TestCase):
    def test_anonymous_visitors_can_browse_when_editing_is_unconfigured(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory, ""), TEST_HOST) as address:
                status, body, _ = request(address, SESSION)
                self.assertEqual((status, body), (200, READ_ONLY))
                self.assertEqual(request(address, FILLER)[:2], (200, {"name": "Filler"}))
                self.assertEqual(request(address, SESSION, "POST", {"passphrase": PASSPHRASE})[0], 503)
    def test_only_the_shared_passphrase_grants_an_editor_session(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            with running_api(directory, settings) as address:
                status, _, headers = request(address, SESSION, "POST", {"passphrase": "wrong phrase"})
                self.assertEqual(status, 401)
                self.assertIsNone(headers.get("Set-Cookie"))

                status, session, headers = request(address, SESSION, "POST", {"passphrase": PASSPHRASE})
                self.assertEqual(status, 200)
                self.assertTrue(session["canEdit"])
                self.assertIsNotNone(session["expiresAt"])
                cookie, *attributes = headers.get("Set-Cookie").split(";")
                self.assertTrue({"secure", "httponly", "samesite=strict"}.issubset(
                    attr.strip().lower() for attr in attributes
                ))
                self.assertEqual(request(address, SESSION, cookie=cookie)[:2], (200, session))

    def test_writes_require_a_shared_editor_session(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            with running_api(directory, settings, TEST_HOST) as address:
                _, _, headers = request(address, SESSION, "POST", {"passphrase": PASSPHRASE})
                cookie = headers["Set-Cookie"].split(";", 1)[0]
                for plan in ("Filler", "Assembly"):
                    with self.subTest(plan=plan):
                        path = "/api/test-plans/" + plan.lower()
                        changed = {"name": plan + " Line"}
                        self.assertEqual(request(address, path)[:2], (200, {"name": plan}))
                        self.assertEqual(request(address, path, "PUT", changed)[0], 401)
                        self.assertEqual(request(address, path)[:2], (200, {"name": plan}))
                        self.assertEqual(request(address, path, "PUT", changed, cookie=cookie)[0], 204)
                        self.assertEqual(request(address, path)[:2], (200, changed))

    def test_sign_out_revokes_the_session_without_closing_the_plan(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            path = FILLER
            with running_api(directory, settings, TEST_HOST) as address:
                _, _, headers = request(address, SESSION, "POST", {"passphrase": PASSPHRASE})
                cookie = headers["Set-Cookie"].split(";", 1)[0]
                self.assertEqual(request(address, path, "PUT", {"name": "Filler A"}, cookie)[0], 204)
                status, _, headers = request(address, SESSION, "DELETE", cookie=cookie)
                self.assertEqual(status, 204)
                self.assertIn("expires=", headers["Set-Cookie"])
                self.assertEqual(request(address, SESSION, cookie=cookie)[:2], (200, READ_ONLY))
                self.assertEqual(request(address, path, "PUT", {"name": "Filler B"}, cookie)[0], 401)
                self.assertEqual(request(address, path, cookie=cookie)[:2], (200, {"name": "Filler A"}))

    def test_cross_origin_browser_requests_cannot_mutate_plans(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            with running_api(directory, settings, TEST_HOST) as address:
                _, _, headers = request(address, SESSION, "POST", {"passphrase": PASSPHRASE})
                cookie = headers["Set-Cookie"].split(";", 1)[0]
                path = FILLER
                self.assertEqual(request(address, path, "PUT", {"name": "Changed"}, cookie,
                                         {"Sec-Fetch-Site": "same-site"})[0], 403)
                self.assertEqual(request(address, path, "PUT", {"name": "Changed"}, cookie,
                                         {"Origin": "http://other-machine.test"})[0], 403)
                self.assertEqual(request(address, path)[:2], (200, {"name": "Filler"}))
                self.assertEqual(request(address, path, "PUT", {"name": "Changed"}, cookie,
                                         {"Origin": address})[0], 204)

    def test_plan_activity_renews_the_exact_eight_hour_idle_deadline(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory), TEST_HOST) as address:
                _, session, headers = request(address, SESSION, "POST", {"passphrase": PASSPHRASE})
                cookie = headers["Set-Cookie"].split(";", 1)[0]
                epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
                self.assertEqual(datetime.fromisoformat(session["expiresAt"]), epoch + timedelta(hours=8))

                hour = 3600
                self.assertEqual(request(address, f"/test/clock/{7 * hour}")[0], 204)
                self.assertEqual(request(address, FILLER, cookie=cookie)[:2], (200, {"name": "Filler"}))
                self.assertEqual(request(address, f"/test/clock/{15 * hour - 1}")[0], 204)
                _, session, _ = request(address, SESSION, cookie=cookie)
                self.assertTrue(session["canEdit"])
                self.assertEqual(datetime.fromisoformat(session["expiresAt"]), epoch + timedelta(hours=15))

                self.assertEqual(request(address, f"/test/clock/{15 * hour}")[0], 204)
                self.assertEqual(request(address, FILLER, "PUT", {"name": "Changed"}, cookie)[0], 401)
                self.assertEqual(request(address, SESSION, cookie=cookie)[:2], (200, READ_ONLY))
                self.assertEqual(request(address, FILLER, cookie=cookie)[:2], (200, {"name": "Filler"}))
    def test_rotating_the_passphrase_rejects_previous_credentials_and_sessions(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory), TEST_HOST) as address:
                _, _, headers = request(address, SESSION, "POST", {"passphrase": PASSPHRASE})
                prior_cookie = headers["Set-Cookie"].split(";", 1)[0]
                self.assertTrue(request(address, SESSION, cookie=prior_cookie)[1]["canEdit"])

            replacement = "replacement workshop phrase"
            with running_api(directory, settings_for(directory, replacement), TEST_HOST) as address:
                self.assertEqual(request(address, SESSION, "POST", {"passphrase": PASSPHRASE})[0], 401)
                self.assertEqual(request(address, FILLER, "PUT", {"name": "Changed"}, prior_cookie)[0], 401)
                self.assertEqual(request(address, FILLER)[:2], (200, {"name": "Filler"}))
                _, _, headers = request(address, SESSION, "POST", {"passphrase": replacement})
                cookie = headers["Set-Cookie"].split(";", 1)[0]
                self.assertEqual(request(address, FILLER, "PUT", {"name": "Changed"}, cookie)[0], 204)


if __name__ == "__main__":
    unittest.main()
