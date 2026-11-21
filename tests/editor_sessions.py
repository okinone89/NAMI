"""HTTP integration tests for the shared editor session."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sqlite3
import subprocess
from tempfile import TemporaryDirectory
from threading import Barrier
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from startup import API, API_DLL, postgres_settings, running_api

TEST_HOST = Path(__file__).resolve().parent / "EditorSessionHost/bin/Debug/net10.0/EditorSessionHost.dll"
SESSION = "/api/editor-session"
SETUP = SESSION + "/setup"
CHANGE_PASSWORD = SESSION + "/password"
PASSWORD = "test-only workshop phrase"
READ_ONLY = {"canEdit": False, "expiresAt": None, "setupRequired": False}
SETUP_REQUIRED = {**READ_ONLY, "setupRequired": True}
FILLER = "/api/test-plans/filler"


def settings_for(directory):
    return {"Database__Provider": "SQLite", "Database__File": str(directory / "nami.db"),
            "ASPNETCORE_ENVIRONMENT": "Production"}


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


def create_password(address, password=PASSWORD):
    return request(address, SETUP, "POST", {"password": password, "confirmation": password})


def change_password(address, current, replacement, cookie=None):
    return request(address, CHANGE_PASSWORD, "PUT", {
        "currentPassword": current, "newPassword": replacement, "confirmation": replacement,
    }, cookie)


class EditorSessions(unittest.TestCase):
    def test_first_run_validates_the_password_and_signs_in_its_creator(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            with running_api(directory, settings, TEST_HOST) as address:
                self.assertEqual(request(address, SESSION)[:2], (200, SETUP_REQUIRED))
                self.assertEqual(request(address, SESSION, "POST", {"password": PASSWORD})[0], 409)
                accepted = "📦" * 14 + "x"
                for password, confirmation in (("📦" * 14, "📦" * 14), ("x" * 257, "x" * 257),
                                               (" " * 15, " " * 15), (accepted, PASSWORD)):
                    with self.subTest(length=len(password), matches=password == confirmation):
                        status, _, headers = request(address, SETUP, "POST", {
                            "password": password, "confirmation": confirmation,
                        })
                        self.assertEqual(status, 400)
                        self.assertIsNone(headers.get("Set-Cookie"))
                        self.assertEqual(request(address, SESSION)[:2], (200, SETUP_REQUIRED))

                self.assertEqual(request(address, SETUP, "POST", {"password": accepted, "confirmation": accepted},
                                         headers={"Origin": "http://other-machine.test"})[0], 403)
                self.assertEqual(request(address, SESSION)[:2], (200, SETUP_REQUIRED))
                status, session, headers = create_password(address, accepted)
                self.assertEqual(status, 201)
                self.assertEqual(headers["Location"], SESSION)
                self.assertTrue(session["canEdit"])
                self.assertFalse(session["setupRequired"])
                cookie = headers["Set-Cookie"].split(";", 1)[0]
                self.assertEqual(request(address, FILLER, "PUT", {"name": "Filler A"}, cookie)[0], 204)
                self.assertEqual(request(address, FILLER)[:2], (200, {"name": "Filler A"}))
                with sqlite3.connect(settings["Database__File"]) as database:
                    stored, = database.execute("SELECT password_hash FROM editor_password").fetchone()
                    self.assertTrue(stored)
                    self.assertNotEqual(stored, accepted)

    def test_simultaneous_password_setup_has_one_winner(self):
        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), TemporaryDirectory() as tmp:
                directory = Path(tmp)
                database = postgres_settings(directory) if provider == "PostgreSQL" else nullcontext({})
                with database as overrides, running_api(directory, {**settings_for(directory), **overrides}) as address:
                    passwords = (PASSWORD, "another workshop password")
                    start = Barrier(2)

                    def submit(password):
                        start.wait(timeout=5)
                        return create_password(address, password)

                    with ThreadPoolExecutor(2) as visitors:
                        results = list(visitors.map(submit, passwords))
                    self.assertCountEqual([result[0] for result in results], [201, 409])
                    for password, (status, _, headers) in zip(passwords, results):
                        won = status == 201
                        self.assertEqual(bool(headers.get("Set-Cookie")), won)
                        self.assertEqual(request(address, SESSION, "POST", {"password": password})[0],
                                         200 if won else 401)

    def test_only_the_shared_password_grants_an_editor_session(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            with running_api(directory, settings) as address:
                self.assertEqual(create_password(address)[0], 201)
                status, _, headers = request(address, SESSION, "POST", {"password": "wrong workshop password"})
                self.assertEqual(status, 401)
                self.assertIsNone(headers.get("Set-Cookie"))

                status, session, headers = request(address, SESSION, "POST", {"password": PASSWORD})
                self.assertEqual(status, 200)
                self.assertTrue(session["canEdit"])
                self.assertIsNotNone(session["expiresAt"])
                cookie, *attributes = headers.get("Set-Cookie").split(";")
                self.assertTrue({"secure", "httponly", "samesite=strict"}.issubset(
                    attr.strip().lower() for attr in attributes
                ))
                self.assertEqual(request(address, SESSION, cookie=cookie)[:2], (200, session))

    def test_production_requires_https_for_browser_sign_in_by_default(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                browser = {"Origin": "http://nami.test", "Sec-Fetch-Site": "same-origin"}
                password = {"password": PASSWORD}
                setup = {**password, "confirmation": PASSWORD}
                status, problem, headers = request(address, SETUP, "POST", setup, headers=browser)
                self.assertEqual(status, 400)
                self.assertIn("HTTPS", problem["title"])
                self.assertIsNone(headers.get("Set-Cookie"))
                self.assertEqual(request(address, SESSION)[:2], (200, SETUP_REQUIRED))

                https_proxy = {**browser, "Origin": "https://nami.test"}
                status, _, headers = request(address, SETUP, "POST", setup, headers=https_proxy)
                self.assertEqual(status, 201)
                self.assertTrue(headers["Set-Cookie"].startswith("__Host-nami-editor="))
                self.assertIn("; secure", headers["Set-Cookie"].lower())

                status, problem, headers = request(address, SESSION, "POST", password, headers=browser)
                self.assertEqual(status, 400)
                self.assertIn("HTTPS", problem["title"])
                self.assertIsNone(headers.get("Set-Cookie"))

    def test_production_http_session_can_edit_when_explicitly_enabled(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = {**settings_for(directory), "EditorSession__AllowInsecureHttp": "true"}
            browser = {"Origin": "http://nami.test", "Sec-Fetch-Site": "same-origin"}
            with running_api(directory, settings) as address:
                status, _, headers = request(address, SETUP, "POST", {
                    "password": PASSWORD, "confirmation": PASSWORD,
                }, headers=browser)
                self.assertEqual(status, 201)
                cookie, *options = headers["Set-Cookie"].split("; ")
                attributes = {option.lower() for option in options}
                self.assertTrue(cookie.startswith("nami-editor-http="))
                self.assertNotIn("secure", attributes)
                self.assertIn("httponly", attributes)
                self.assertIn("samesite=strict", attributes)
                self.assertEqual(request(address, "/api/plans", "POST", {"name": "Filler"},
                                         cookie, browser)[0], 201)

                status, _, headers = change_password(address, PASSWORD, "replacement workshop phrase", cookie)
                self.assertEqual(status, 200)
                self.assertEqual(request(address, SESSION, cookie=cookie)[:2], (200, READ_ONLY))
                replacement_cookie = headers["Set-Cookie"].split(";", 1)[0]
                self.assertTrue(request(address, SESSION, cookie=replacement_cookie)[1]["canEdit"])

                status, _, headers = request(address, SESSION, "DELETE", cookie=replacement_cookie, headers=browser)
                self.assertEqual(status, 204)
                self.assertTrue(headers["Set-Cookie"].startswith("nami-editor-http="))
                self.assertIn("expires=", headers["Set-Cookie"])
                self.assertEqual(request(address, SESSION, cookie=replacement_cookie)[:2], (200, READ_ONLY))

                status, session, headers = request(address, SESSION, "POST", {
                    "password": "replacement workshop phrase",
                }, headers=browser)
                self.assertEqual(status, 200)
                self.assertTrue(session["canEdit"])
                self.assertTrue(headers["Set-Cookie"].startswith("nami-editor-http="))

    def test_changing_password_requires_current_password_and_replaces_it_on_restart(self):
        replacement = "updated workshop password"
        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), TemporaryDirectory() as tmp:
                directory = Path(tmp)
                database = postgres_settings(directory) if provider == "PostgreSQL" else nullcontext({})
                with database as overrides:
                    settings = {**settings_for(directory), **overrides}
                    with running_api(directory, settings) as address:
                        _, _, first = create_password(address)
                        prior_cookie = first["Set-Cookie"].split(";", 1)[0]
                        _, _, second = request(address, SESSION, "POST", {"password": PASSWORD})
                        other_cookie = second["Set-Cookie"].split(";", 1)[0]
                        status, plan, created = request(address, "/api/plans", "POST", {"name": "Cartoning"}, prior_cookie)
                        self.assertEqual(status, 201)

                        self.assertEqual(change_password(address, PASSWORD, replacement)[0], 401)
                        for current, new, confirmation, expected in (
                            (None, replacement, replacement, 403),
                            ("incorrect editor password", replacement, replacement, 403),
                            (PASSWORD, replacement, "different workshop password", 400),
                            (PASSWORD, "short", "short", 400),
                            (PASSWORD, PASSWORD, PASSWORD, 400),
                        ):
                            with self.subTest(status=expected, confirmation_matches=new == confirmation):
                                status, _, headers = request(address, CHANGE_PASSWORD, "PUT", {
                                    "currentPassword": current, "newPassword": new, "confirmation": confirmation,
                                }, prior_cookie)
                                self.assertEqual(status, expected)
                                self.assertIsNone(headers.get("Set-Cookie"))
                        self.assertEqual(request(address, CHANGE_PASSWORD, "PUT", {
                            "currentPassword": PASSWORD, "newPassword": replacement, "confirmation": replacement,
                        }, prior_cookie, {"Origin": "http://other-machine.test"})[0], 403)
                        self.assertEqual(request(address, SESSION, "POST", {"password": replacement})[0], 401)
                        self.assertTrue(request(address, SESSION, cookie=other_cookie)[1]["canEdit"])

                        status, session, headers = change_password(address, PASSWORD, replacement, prior_cookie)
                        self.assertEqual(status, 200)
                        refreshed_cookie = headers["Set-Cookie"].split(";", 1)[0]
                        self.assertNotEqual(refreshed_cookie, prior_cookie)
                        self.assertEqual(request(address, SESSION, cookie=refreshed_cookie)[:2], (200, session))
                        self.assertTrue(session["canEdit"])
                        self.assertFalse(session["setupRequired"])
                        for cookie in (prior_cookie, other_cookie):
                            self.assertEqual(request(address, SESSION, cookie=cookie)[:2], (200, READ_ONLY))
                            self.assertEqual(change_password(address, replacement, PASSWORD, cookie)[0], 401)
                        self.assertEqual(request(address, SESSION, "POST", {"password": PASSWORD})[0], 401)
                        self.assertEqual(request(address, SESSION, "POST", {"password": replacement})[0], 200)

                    with running_api(directory, settings) as address:
                        self.assertEqual(request(address, SESSION)[:2], (200, READ_ONLY))
                        self.assertEqual(request(address, SESSION, "POST", {"password": PASSWORD})[0], 401)
                        self.assertEqual(request(address, SESSION, "POST", {"password": replacement})[0], 200)
                        self.assertEqual(request(address, created["Location"])[:2], (200, plan))

    def test_simultaneous_password_changes_cannot_reuse_the_same_current_password(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            with running_api(directory, settings_for(directory)) as address:
                _, _, first = create_password(address)
                _, _, second = request(address, SESSION, "POST", {"password": PASSWORD})
                cookies = [headers["Set-Cookie"].split(";", 1)[0] for headers in (first, second)]
                passwords = ("first workshop replacement", "second workshop replacement")
                start = Barrier(2)

                def submit(password, cookie):
                    start.wait(timeout=5)
                    return change_password(address, PASSWORD, password, cookie)

                with ThreadPoolExecutor(2) as editors:
                    results = list(editors.map(submit, passwords, cookies))
                self.assertEqual(sum(status == 200 for status, _, _ in results), 1)
                for password, (status, _, headers) in zip(passwords, results):
                    self.assertIn(status, (200, 401, 403, 409))
                    self.assertEqual(bool(headers.get("Set-Cookie")), status == 200)
                    self.assertEqual(request(address, SESSION, "POST", {"password": password})[0],
                                     200 if status == 200 else 401)

    def test_writes_require_a_shared_editor_session(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = settings_for(directory)
            with running_api(directory, settings, TEST_HOST) as address:
                _, _, headers = create_password(address)
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
                _, _, headers = create_password(address)
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
                _, _, headers = create_password(address)
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
                _, session, headers = create_password(address)
                cookie = headers["Set-Cookie"].split(";", 1)[0]
                epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
                self.assertEqual(datetime.fromisoformat(session["expiresAt"]), epoch + timedelta(hours=8))

                status, plan, created = request(address, "/api/plans", "POST", {"name": "Filler"}, cookie)
                self.assertEqual(status, 201)
                path = created["Location"]

                hour = 3600
                self.assertEqual(request(address, f"/test/clock/{7 * hour}")[0], 204)
                self.assertEqual(request(address, path, cookie=cookie)[:2], (200, plan))
                self.assertEqual(request(address, f"/test/clock/{15 * hour - 1}")[0], 204)
                _, session, _ = request(address, SESSION, cookie=cookie)
                self.assertTrue(session["canEdit"])
                self.assertEqual(datetime.fromisoformat(session["expiresAt"]), epoch + timedelta(hours=15))

                self.assertEqual(request(address, f"/test/clock/{15 * hour}")[0], 204)
                changed = {**plan, "name": "Changed"}
                self.assertEqual(request(address, path, "PUT", changed, cookie)[0], 401)
                self.assertEqual(request(address, SESSION, cookie=cookie)[:2], (200, READ_ONLY))
                self.assertEqual(request(address, path, cookie=cookie)[:2], (200, plan))

    def test_reset_reopens_setup_and_preserves_saved_plans(self):
        for provider in ("SQLite", "PostgreSQL"):
            with self.subTest(provider=provider), TemporaryDirectory() as tmp:
                directory = Path(tmp)
                database = postgres_settings(directory) if provider == "PostgreSQL" else nullcontext({})
                with database as overrides:
                    self.exercise_reset(directory, {**settings_for(directory), **overrides})

    def exercise_reset(self, directory, settings):
        with running_api(directory, settings) as address:
            _, _, headers = create_password(address)
            prior_cookie = headers["Set-Cookie"].split(";", 1)[0]
            status, plan, created = request(address, "/api/plans", "POST", {"name": "Filler"}, prior_cookie)
            self.assertEqual(status, 201)
            path = created["Location"]
            self.assertTrue(request(address, SESSION, cookie=prior_cookie)[1]["canEdit"])

        with running_api(directory, settings) as address:
            self.assertEqual(request(address, SESSION, cookie=prior_cookie)[:2], (200, READ_ONLY))
            self.assertEqual(request(address, SESSION, "POST", {"password": PASSWORD})[0], 200)

        reset = subprocess.run(["dotnet", str(API_DLL), "--reset-editor-password"], cwd=API,
                               env={**os.environ, **settings}, capture_output=True, text=True, timeout=30)
        self.assertEqual(reset.returncode, 0, reset.stderr)
        self.assertIn("Editor password cleared.", reset.stdout)

        replacement = "replacement workshop phrase"
        with running_api(directory, settings) as address:
            self.assertEqual(request(address, SESSION, cookie=prior_cookie)[:2], (200, SETUP_REQUIRED))
            self.assertEqual(request(address, SESSION, "POST", {"password": PASSWORD})[0], 409)
            self.assertEqual(request(address, path)[:2], (200, plan))
            _, _, headers = create_password(address, replacement)
            self.assertEqual(request(address, SESSION, "POST", {"password": PASSWORD})[0], 401)
            self.assertEqual(request(address, SESSION, cookie=prior_cookie)[:2], (200, READ_ONLY))
            changed = {**plan, "name": "Changed"}
            self.assertEqual(request(address, path, "PUT", changed, prior_cookie)[0], 401)
            self.assertEqual(request(address, path)[:2], (200, plan))
            cookie = headers["Set-Cookie"].split(";", 1)[0]
            status, saved, _ = request(address, path, "PUT", changed, cookie)
            self.assertEqual(status, 200)
            self.assertEqual(saved["name"], changed["name"])
            self.assertEqual(request(address, path)[:2], (200, saved))


if __name__ == "__main__":
    unittest.main()
