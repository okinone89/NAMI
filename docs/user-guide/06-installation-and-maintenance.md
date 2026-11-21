# 6. Run and maintain an installation

## Start NAMI in production

From the repository root, run `./run` on macOS or Linux, or `.\run.ps1` in Windows PowerShell. Production defaults to `https://localhost:5080`. With the default listener, NAMI uses the .NET SDK to create or trust the local HTTPS certificate if needed. Approve the trust prompt if it appears. If your browser still reports a certificate warning, follow the [ASP.NET Core certificate trust instructions](https://learn.microsoft.com/en-us/aspnet/core/security/enforcing-ssl?view=aspnetcore-10.0#trust-the-aspnet-core-https-development-certificate). With `--dev` or `-Dev`, the launcher defaults to `http://127.0.0.1:5080`.

Run one API process per installation because it holds editor sessions in memory. The eight-hour idle timer is tied to plan API activity. A restart ends active editor sessions.

## Publish NAMI with nginx

This example puts nginx and NAMI on the same Linux server and makes the workspace reachable at `https://nami.example.com` from your LAN or VPN. nginx serves HTTPS on port 443 and forwards requests to NAMI over loopback.

### 1. Prepare DNS and a certificate

Choose a DNS name that client devices can resolve to the server's LAN or VPN address. Replace `nami.example.com` throughout this example with that name. Obtain a TLS certificate for it from a certificate authority the client devices trust. Install nginx and put the PEM certificate chain and private key where its service can read them. Restrict access to the private key.

### 2. Start NAMI on the server

From the repository root, run the following command without the development switch. Keep NAMI bound to loopback in this configuration. The forwarded headers setting lets NAMI see the original HTTPS scheme.

```sh
ASPNETCORE_FORWARDEDHEADERS_ENABLED=true \
  ./run --urls http://127.0.0.1:5080
```

### 3. Configure nginx

Save the block in a file loaded by nginx, such as `/etc/nginx/conf.d/nami.conf`. Replace the certificate paths. The `location /` block serves the workspace and all `/api` routes on one HTTPS origin.

```nginx
server {
    listen 443 ssl;
    server_name nami.example.com;
    ssl_certificate /etc/nginx/tls/nami-fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/nami.key;

    location / {
        proxy_pass http://127.0.0.1:5080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

### 4. Reload nginx and verify from a client

Check the configuration, then reload nginx.

```sh
sudo nginx -t
sudo nginx -s reload
```

Allow TCP port 443 from the intended LAN or VPN in the server firewall. Keep port 5080 bound to loopback. From a client device, run `curl https://nami.example.com/health` and confirm it returns `{"status":"ready"}` without a certificate error. Open `https://nami.example.com` in a browser and complete editor password setup before sharing the URL. Anyone who can reach the site can browse plans after setup.

See the [nginx HTTPS configuration guide](https://nginx.org/en/docs/http/configuring_https_servers.html) and [nginx reverse proxy documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

## Serve HTTPS directly with Kestrel

NAMI can also serve HTTPS itself. Use the same DNS and client trust requirements as above. Give the account running NAMI read access to a password-protected `.pfx` file for the DNS name and supply its password through the service's secret configuration. The commands below assume the password is already available as `NAMI_CERT_PASSWORD`.

On macOS or Linux, run from the repository root.

```sh
export Kestrel__Certificates__Default__Path=/etc/nami/nami.pfx
export Kestrel__Certificates__Default__Password="$NAMI_CERT_PASSWORD"
./run --urls https://0.0.0.0:5443
```

In Windows PowerShell, run from the repository root.

```powershell
$env:Kestrel__Certificates__Default__Path = 'C:\nami\certs\nami.pfx'
$env:Kestrel__Certificates__Default__Password = $env:NAMI_CERT_PASSWORD
.\run.ps1 -Urls 'https://0.0.0.0:5443'
```

The example listens on all IPv4 interfaces. To restrict the listener to one interface, replace `0.0.0.0` with the server's LAN or VPN address. Allow TCP port 5443 from the intended network in the firewall. From a client device, check `https://nami.example.com:5443/health` and open `https://nami.example.com:5443` in a browser. Clients use the DNS name on the certificate. [Kestrel endpoint configuration](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/endpoints?view=aspnetcore-10.0)

## Choose a different listener

Set `ASPNETCORE_URLS` or pass `./run --urls <url>` or `.\run.ps1 -Urls <url>` to choose a listener. For an HTTP-only installation, set an HTTP listener and set `EditorSession__AllowInsecureHttp=true` in the API service environment before restarting NAMI. Use this only on a trusted, isolated network. HTTP exposes the editor password and session cookie to anyone who can monitor the connection.

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
curl https://localhost:5080/health
```

In Windows PowerShell, use `Invoke-RestMethod https://localhost:5080/health`.

## Back up and restore

Back up before upgrading or changing database settings.

- **SQLite.** Use the SQLite shell’s online backup command. For example, `sqlite3 /var/lib/nami/nami.db ".backup '/backups/nami.db'"` creates a consistent copy while the service is running. To restore, stop NAMI, preserve the original database, and point NAMI at a fresh file restored from the backup.
- **PostgreSQL.** Use a managed database snapshot or a custom-format dump from `pg_dump -Fc`. Restore using the provider’s snapshot workflow or use `pg_restore` into an empty database, then point NAMI at the restored database and schema.
- **Verify.** Restart NAMI and check `/health`. Open the expected plans and verify a representative diagram, interface table, and links. For an individual plan, use [JSON plan packages](05-import-export-and-sharing.md#transfer-a-complete-plan). Restoring a backup also restores the editor password that was active when you took it. Changing the database target opens the data already stored there. Transfer plans separately when moving between targets.

## Troubleshoot common symptoms

| Symptom | Check |
| --- | --- |
| Browser cannot connect | Confirm the launcher finished building and check the terminal for startup errors. Match the browser URL to the configured address and port. |
| Certificate warning on a shared instance | Check that the DNS name in the browser matches the certificate and that the client trusts the issuer. |
| nginx returns 502 | On the server, check that `http://127.0.0.1:5080/health` responds and matches the nginx `proxy_pass` address. |
| Editing is unavailable | If you see **Create editor password**, complete setup. If you forgot the password, stop NAMI and use the reset command. |
| Expected plans are missing | Check **Workspace → Open plan** and the active database target. For an otherwise empty table or drawing, clear search and network filters. |
| SQLite fails on startup | Verify the configured file, parent directory, and service-account permissions. |
| PostgreSQL fails on startup | Verify the database host, port, name, credentials, schema, and migration permissions. Check which environment or command-line settings override interactive setup. |
| An editor is asked to unlock again | A service restart, a password change or reset, or eight hours without plan API activity can end an editor session. Select **View mode** and enter the current password. |
