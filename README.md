# NAMI

NAMI is a self-hosted web app for planning industrial networks. Draw the connections between PLCs, operator panels, drives, servers, and virtual machines, then switch to a table to review the IPv4 address and protocol profile of each interface. Both views use the same plan.

![Network diagram of a cartoning line. The PLC connects the machine LAN to line services, where an edge server hosts a historian VM.](docs/screenshots/cartoning-line-diagram.png)

[Installation](#installation) · [Your first plan](#your-first-plan) · [Features](#features) · [Development](#development) · [Running a shared instance](#running-a-shared-instance)

## Installation

For a local installation from source, use Git, the .NET 10 **SDK**, Node.js 24 with npm, and a POSIX shell such as the one on macOS or Linux. SQLite is the default database. [Download .NET 10](https://dotnet.microsoft.com/download/dotnet/10.0) · [Download Node.js](https://nodejs.org/en/download)

```sh
git clone https://github.com/okinone89/NAMI.git
cd NAMI
./run --dev
```

The launcher installs frontend dependencies as needed, builds the workspace, and starts the app and API together. Open [NAMI on localhost](http://127.0.0.1:5080). A fresh database shows **No plans yet**. Choose **Unlock editing** and enter `nami-local-editor`, the default passphrase for local development.

Plans are saved in `src/Nami.Api/data/nami.db` and are available the next time you run the launcher. Press Ctrl+C to stop it. If port 5080 is busy, run `./run --dev --urls http://127.0.0.1:5082` and open port 5082 instead.

## Your first plan

1. Choose **New plan**, name it `Cartoning line`, and select **Create plan**.
2. Choose **Add network**, enter `Machine LAN` and the subnet `192.0.2.0/24`, then select **Save network**.
3. Choose **Add component**, name it `Cartoner PLC`, and set its type to `PLC`. Use **Add interface** to add `X1`, assign it to `Machine LAN`, enter `192.0.2.10`, and select **Save component**. Repeat for an operator panel with address `192.0.2.20`.
4. In **Diagram**, choose **Add link**, select the source and target components and their interfaces, choose **Wired**, and select **Save link**. Drag the components into position.
5. Switch to **Table** and filter for `192.0.2.10` to find the PLC interface. To share the drawing and address list together, choose **Export PDF**, select **Diagram and table** and **Whole plan**, then **Download PDF**.

## Features

**Topology diagrams.** Place devices from the component library, group VMs with their host, and distinguish wired, wireless, and virtual links. Select a network to focus the diagram, or search for an address to find the component that owns it.

**Interface inventory.** Sort and filter ports by component, network, IPv4 address, or protocol. Record PROFINET station names and roles, EtherNet/IP device classes, and Modbus TCP settings. In the example below, the two rows for the Cartoner PLC show which port serves each network.

![Interface table for the cartoning line. PLC port X1 uses PROFINET on the machine LAN and X2 uses Modbus TCP on line services.](docs/screenshots/cartoning-line-interfaces.png)

**IPv4 planning.** Check addresses against their subnet and flag duplicates within a named network. Two isolated machines can use the same subnet. Configure allocation pools and exclusions, then preview available addresses with **Auto-assign IPv4**.

**Inventory and plan exchange.** Export the interface inventory as CSV, or import a CSV or pasted spreadsheet and review changes before applying them. Use **Export PDF** for a readable handoff. Editors can also use **Export plan** and **Import plan** to transfer a JSON package between installations. Importing creates a new plan with its components, layout, and links.

## Development

The ASP.NET Core API and persistence code live in [src/Nami.Api](src/Nami.Api). The React and TypeScript workspace lives in [frontend](frontend), with Vite serving the development UI. The [glossary](GLOSSARY.md) defines the terms used in both.

### Run with hot reload

From the repository root, start the API in one terminal. Development mode enables the local editor passphrase.

```sh
ASPNETCORE_ENVIRONMENT=Development dotnet watch --project src/Nami.Api run --no-launch-profile -- --urls http://127.0.0.1:5080
```

In a second terminal, start Vite and open the URL it prints (normally `http://localhost:5173`). It forwards `/api` and `/health` to the API on port 5080. Set `NAMI_API_ORIGIN` when starting Vite if your API uses another address.

```sh
cd frontend
npm ci
npm run dev
```

### Build and test

From `frontend/`, run the static checks and browser tests. The build typechecks the app and writes the production bundle to `dist/`.

```sh
npm run lint
npm run build
npx playwright install chromium --only-shell
npm test
```

Playwright starts the application with a disposable SQLite database on port 5174 and exercises desktop and phone layouts. Set `NAMI_TEST_WEB_PORT` to use a different port. The [frontend CI workflow](.github/workflows/frontend.yml) runs the build and browser suite on pushes and pull requests.

For the API integration suite, use Python 3 on macOS or Linux and put the PostgreSQL server utilities (`initdb`, `pg_ctl`, and `psql`) on your PATH. Run as a regular user from the repository root. The tests create their own SQLite files and temporary PostgreSQL clusters.

```sh
dotnet build src/Nami.Api
dotnet build tests/PlanPersistence
dotnet build tests/EditorSessionHost
python3 -B -m unittest discover -s tests -p '*.py'
```

## Running a shared instance

Run `./run` to start in Production mode. Serve the workspace and `/api` from the same HTTPS origin on the site LAN or VPN. Anyone who can reach the site can browse its plans. To enable editing, set `Editor__Passphrase` in the service environment through your secret store before startup. Leaving it unset gives visitors read-only access.

An unlocked editor can change any plan. **Sign out** ends the session, as do eight hours without plan API activity. Checking session status alone does not extend it. Run one API process per installation because sessions are held in memory. To rotate the passphrase, change the setting and restart the process. Editors must then unlock again.

### Database and recovery

NAMI creates or upgrades its tables in a transaction at startup. A successful readiness check returns HTTP 200 and `{"status":"ready"}` at `/health`.

| Provider | Service environment | Storage |
| --- | --- | --- |
| SQLite (default) | `Database__Provider=SQLite` and optionally `Database__File=/var/lib/nami/nami.db` | Relative paths resolve against the API content root. Choose a persistent directory writable by the service account. |
| PostgreSQL | `Database__Provider=PostgreSQL` and `ConnectionStrings__Nami='Host=localhost;Database=nami;Username=nami'` | Provision the database and grant the login permission to connect and create or alter tables. Supply authentication through a protected password file or the service secret store. |

Back up before upgrading. For SQLite, use the SQLite shell’s online backup command, for example `sqlite3 /var/lib/nami/nami.db ".backup '/backups/nami.db'"`. Stop NAMI before restoring the snapshot to a fresh file at the configured path. For PostgreSQL, use a managed snapshot or `pg_dump -Fc` and restore with `pg_restore` into an empty database. Restart NAMI and verify both readiness and the expected plans.

Changing providers points NAMI at a different database. To move an individual plan, export its package from the source installation and import it into the destination.

<details>
<summary>First-release verification and cross-provider browser tests</summary>

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
| HTTP integration suite | 37 passed, including schema setup and restart, exact eight-hour expiry and passphrase rotation on persisted plans, stale allocation and import, conditional undo, concurrent SQLite saves during a read, and all four transfer directions. |
| Chromium with SQLite | 88 passed, with 12 skips for viewport and input combinations assigned to the other project. |
| Chromium with PostgreSQL | 88 passed, with the same 12 viewport and input skips. |
| Cross-provider transfer in Chromium | 4 passed, covering both provider directions on desktop and phone. |

</details>
