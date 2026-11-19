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

## Integration tests

On macOS or Linux, install Python 3 and put the PostgreSQL server utilities (`initdb`, `pg_ctl`, `psql`) on PATH. Run as a regular user. The suite starts the API on loopback and creates its own SQLite file and disposable PostgreSQL cluster.

```sh
dotnet build src/Nami.Api
python3 tests/startup.py
```

## React workspace

Use Node.js 24 and npm. From the repository root, run

```sh
cd frontend
npm ci
npm run dev
```

Open the local URL printed by Vite (normally http://localhost:5173). The diagram and interface table share the empty plan in `frontend/public/fixtures/empty-plan.json`. Both views work with the API stopped. To run them alongside the local API, start the API in another terminal using the command above. Vite forwards `/health` to the API on port 5080. Plan data comes from the fixture until the API exposes plan reads.

The workspace uses shadcn preset `b2CRHdRTM`. Its generated configuration and theme are in `frontend/components.json` and `frontend/src/index.css`. From `frontend`, run `npm run build` to typecheck and produce the Vite production bundle in `dist/`. CI runs that build and the desktop and phone browser tests. To run the tests locally, use `npx playwright install chromium --only-shell` followed by `npm test`.
