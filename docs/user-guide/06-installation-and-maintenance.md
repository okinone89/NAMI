# 6. Run and maintain an installation

## Start NAMI in production

From the repository root, run `./run` on macOS or Linux, or `.\run.ps1` in Windows PowerShell. The default listener is `http://127.0.0.1:5080`. Set `ASPNETCORE_URLS` or pass another address, for example `./run --dev --urls http://127.0.0.1:5082` or `.\run.ps1 -Dev -Urls http://127.0.0.1:5082`. Omit the development switch for production.

For a shared instance, serve the workspace and its `/api` routes on the same HTTPS origin on the site LAN or VPN. Production editing uses a secure session cookie, so open the HTTPS URL when editing. After password setup, anyone who can reach the site can browse all plans. An unlocked editor can change any plan.

Run one API process per installation because it holds editor sessions in memory. The eight-hour idle timer is tied to plan API activity. A restart ends active editor sessions.

## Set or reset the editor password

When the active database has no editor password, the first visitor to finish **Create editor password** sets the shared password and enters Edit mode. Enter the password twice and use 15 to 256 characters. NAMI stores a salted hash in the database, so ordinary restarts keep the password. Other visitors can select **View mode**, enter the shared password, and choose **Unlock editing**.

On a shared installation, complete password setup before giving other visitors access.

### Change the editor password

In **Edit mode**, select **Workspace → Change editor password**. Enter the current password and type the new password twice, then select **Change password**. You stay in Edit mode. Other editors will need to unlock editing again with the new password.

### Reset a forgotten password

To reset a forgotten editor password, stop NAMI and run the appropriate command from the repository root.

| Platform | Command |
| --- | --- |
| macOS or Linux | `./run --reset-editor-password` |
| Windows PowerShell | `.\run.ps1 -ResetEditorPassword` |

Use the same database settings as the service. If you start the API with database command-line arguments, pass the same arguments after `--reset-editor-password` when running the API directly. Then restart NAMI and open it in a browser to create the replacement. Plans stay in the database. Existing editor sessions end when NAMI stops.

## Choose a database interactively

Run `./run --setup` on macOS or Linux or `.\run.ps1 -Setup` on Windows. Choose a database type, review the target, and confirm to apply migrations. The setup command exits after configuring the database. Start or restart NAMI to use it.

- **SQLite.** Enter an existing NAMI database file or a path for a new one. Press Enter for the configured default, normally `data/nami.db`. Relative paths resolve against `src/Nami.Api`, and NAMI creates missing parent directories. Use a persistent location writable by the account running NAMI.
- **PostgreSQL.** Supply the host, port, name of an existing database, username, and schema. The defaults are `localhost`, port `5432`, and schema `nami`. The login needs to connect, use the schema, and create or alter NAMI’s tables. If setup needs to create the schema, the login also needs `CREATE` on the database. Supply credentials to setup and the running service through a protected PostgreSQL password file, for example with `PGPASSFILE`, or your deployment’s credential configuration.

After migrations succeed, setup saves the target in `src/Nami.Api/data/database-settings.json`. PostgreSQL settings omit the password. Environment variables and database arguments override the saved selection.

## Configure a service without prompts

| Database | Service settings |
| --- | --- |
| SQLite | `Database__Provider=SQLite` and optionally `Database__File=/var/lib/nami/nami.db`. The built-in default is relative to the API content root. |
| PostgreSQL | `Database__Provider=PostgreSQL` and `ConnectionStrings__Nami`. Point the connection string at the provisioned database and use `Search Path=nami` for an existing dedicated schema. Grant the service account access and migration permissions there. |

For example, use `Host=localhost;Database=nami;Username=nami;Search Path=nami` with credentials from a password file or service secret store. Provision the schema first when skipping setup.

NAMI applies pending database migrations in a transaction at startup. Check `/health` at the configured address. A ready instance returns HTTP 200 and `{"status":"ready"}`.

```sh
curl http://127.0.0.1:5080/health
```

In Windows PowerShell, use `Invoke-RestMethod http://127.0.0.1:5080/health`.

## Back up and restore

Back up before upgrading or changing database settings.

- **SQLite.** Use the SQLite shell’s online backup command. For example, `sqlite3 /var/lib/nami/nami.db ".backup '/backups/nami.db'"` creates a consistent copy while the service is running. To restore, stop NAMI, preserve the original database, and point NAMI at a fresh file restored from the backup.
- **PostgreSQL.** Use a managed database snapshot or a custom-format dump from `pg_dump -Fc`. Restore using the provider’s snapshot workflow or use `pg_restore` into an empty database, then point NAMI at the restored database and schema.
- **Verify.** Restart NAMI and check `/health`. Open the expected plans and verify a representative diagram, interface table, and links. For an individual plan, use [JSON plan packages](05-import-export-and-sharing.md#transfer-a-complete-plan). Restoring a backup also restores the editor password that was active when you took it. Changing the database target opens the data already stored there. Transfer plans separately when moving between targets.

## Troubleshoot common symptoms

| Symptom | Check |
| --- | --- |
| Browser cannot connect | Confirm the launcher finished building and check the terminal for startup errors. Match the browser URL to the configured address and port. |
| Editing is unavailable | If you see **Create editor password**, complete setup. If you forgot the password, stop NAMI and use the reset command. |
| Expected plans are missing | Check **Workspace → Open plan** and the active database target. For an otherwise empty table or drawing, clear search and network filters. |
| SQLite fails on startup | Verify the configured file, parent directory, and service-account permissions. |
| PostgreSQL fails on startup | Verify the database host, port, name, credentials, schema, and migration permissions. Check which environment or command-line settings override interactive setup. |
| An editor is asked to unlock again | A service restart, a password change or reset, or eight hours without plan API activity can end an editor session. Select **View mode** and enter the current password. |
