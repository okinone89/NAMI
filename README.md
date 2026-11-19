# NAMI API

Install the .NET 10 SDK. From the repository root, run

```sh
dotnet build src/Nami.Api
dotnet run --no-build --project src/Nami.Api -- --urls http://127.0.0.1:5080
```

Open `http://127.0.0.1:5080/health`. A successful startup returns HTTP 200 and `{"status":"ready"}`. NAMI creates and upgrades its tables in a transaction before accepting requests.

## Database configuration and recovery

The checked-in example in `src/Nami.Api/appsettings.json` selects SQLite. The default file is `src/Nami.Api/data/nami.db` when launched as shown above. Relative file paths resolve against the application's content root. The service account needs write access to the containing directory. For a deployed instance, use a persistent directory outside the application release and set

```sh
export Database__Provider=SQLite
export Database__File=/var/lib/nami/nami.db
```

For PostgreSQL, provision a database and a login with permission to connect and create or alter NAMI's tables in its schema. Configure the service environment before startup, for example

```sh
export Database__Provider=PostgreSQL
export ConnectionStrings__Nami='Host=localhost;Database=nami;Username=nami'
```

Supply authentication through a protected PostgreSQL password file or inject the full connection string from the deployment's secret store. Keep credentials out of tracked settings. The named PostgreSQL database holds all application data. Switching providers selects another database and does not transfer data.

Back up before upgrades. For SQLite, use the SQLite shell's online backup command, for example `sqlite3 /var/lib/nami/nami.db ".backup '/backups/nami.db'"`. Stop NAMI and restore the snapshot to a fresh file at the configured path. For PostgreSQL, use the server's managed snapshots or `pg_dump -Fc` and restore with `pg_restore` into an empty database. Start NAMI against the restored database and check readiness and expected records.

## Shared editor access

Serve the frontend and `/api` from the same HTTPS origin on the internal server. Anyone on the site LAN or VPN who can reach NAMI can browse plans. To enable editing, the deployment administrator sets `Editor__Passphrase` in the API service's environment through its secret store, then starts the service. Choose a long, randomly generated passphrase and share it with editors through a protected channel. With the setting unset, the deployment serves read-only browsing.

Select **Unlock editing** and enter the shared passphrase to edit any plan. **Sign out** ends the session and keeps the current plan open. Eight hours without plan API activity also ends the session. Checking the session status alone does not restart the idle timer.

To recover a lost passphrase or rotate it, stop the API instance, replace `Editor__Passphrase` in the service configuration, and restart it. The API holds editor sessions in that process, so the restart revokes all previous sessions. Editors unlock again with the replacement passphrase. Deploy one API process per NAMI installation.

For local HTTP development on loopback, use a separate passphrase and enable the development cookie by launching the API with `ASPNETCORE_ENVIRONMENT=Development`. Set `Editor__Passphrase` in the local API environment before launch.

## Integration tests

On macOS or Linux, install Python 3 and put the PostgreSQL server utilities (`initdb`, `pg_ctl`, `psql`) on PATH. Run as a regular user. The suite starts the API on loopback and creates its own SQLite file and disposable PostgreSQL cluster.

```sh
dotnet build tests/PlanPersistence
python3 tests/startup.py
python3 tests/plan_api.py
```

To run the editor session HTTP tests with a controllable clock, build and run the separate loopback test host through the Python suite:

```sh
dotnet build tests/EditorSessionHost
python3 tests/editor_sessions.py
```

## React workspace

Use Node.js 24 and npm. From the repository root, run

```sh
cd frontend
npm ci
npm run dev
```

Start the API in another terminal using the command above, then open the local URL printed by Vite (normally http://localhost:5173). Vite forwards `/api` and `/health` to the API on port 5080. Choose a plan with **Open plan**. After unlocking editing, use **New plan**, **Add network**, or **Add component** to build the inventory. Select a component in either view to open its details and interfaces.

The workspace uses shadcn preset `b2CRHdRTM`. Its generated configuration and theme are in `frontend/components.json` and `frontend/src/index.css`. From `frontend`, run `npm run build` to typecheck and produce the Vite production bundle in `dist/`. CI runs that build and the desktop and phone browser tests. To run the tests locally, install the .NET 10 SDK and run `npx playwright install chromium --only-shell` followed by `npm test`. Playwright starts Vite and an API with a disposable SQLite database. Set `NAMI_TEST_WEB_PORT` and `NAMI_TEST_API_PORT` to override the default ports 5174 and 5081.

## First-release verification

From a clean checkout with the tools above, build the API and both integration test hosts, then install and build the React app.

```sh
dotnet build src/Nami.Api
dotnet build tests/PlanPersistence
dotnet build tests/EditorSessionHost
python3 -B -m unittest discover -s tests -p '*.py'

(cd frontend && npm ci && npm run build && npx playwright install chromium --only-shell)
```

Run the browser suite once for each provider. Start each API with the database settings above, using a fresh SQLite file or empty PostgreSQL database. In a terminal at the repository root, run

```sh
ASPNETCORE_ENVIRONMENT=Development Editor__Passphrase='playwright-only editor passphrase' \
  dotnet run --no-build --project src/Nami.Api -- --urls http://127.0.0.1:5081
```

Check that `/health` returns `{"status":"ready"}`, then run the browser suite from another terminal. Playwright starts Vite and proxies requests to the API you started.

```sh
(cd frontend && NAMI_TEST_USE_EXTERNAL_API=1 npm test)
```

To verify transfer between providers in Chromium, keep the source API on port 5081. Start a second API on port 5080 with the other provider, its own empty database and the same local test passphrase. In separate terminals, start the destination React app and run the transfer test.

```sh
(cd frontend && NAMI_API_ORIGIN=http://127.0.0.1:5080 npm run dev -- --host 127.0.0.1 --port 5173 --strictPort)
(cd frontend && NAMI_TEST_USE_EXTERNAL_API=1 NAMI_TEST_TRANSFER_DESTINATION=http://127.0.0.1:5173 \
  npm test -- plan-packages.spec.ts)
```

Repeat with fresh databases and the providers reversed. The browser downloads a package from the source, uploads the file through the destination, and reopens the copied plan to check the custom icon, layout, labeled shape, link, and interface data. Keep the test passphrase and disposable databases local.

The first-release run on macOS with .NET SDK 10.0.402, Node.js 24.22.0, and PostgreSQL 18.6 passed these checks.

| Check | Result |
| --- | --- |
| HTTP integration suite | 35 passed, including schema setup and restart, exact eight-hour expiry and passphrase rotation on persisted plans, stale allocation and import, conditional undo, and all four transfer directions. |
| Chromium with SQLite | 78 passed, with 12 skips for viewport and input combinations assigned to the other project. |
| Chromium with PostgreSQL | 78 passed, with the same 12 viewport and input skips. |
| Cross-provider transfer in Chromium | 4 passed, covering both provider directions on desktop and phone. |
