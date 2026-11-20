using System.Data.Common;
using System.Text.Json;
using Microsoft.Extensions.Configuration.EnvironmentVariables;
using Microsoft.Extensions.Configuration.Json;
using Npgsql;

internal static class DatabaseSetup
{
    private const string SettingsFile = "data/database-settings.json";
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static void AddSavedSettings(WebApplicationBuilder builder)
    {
        // Load after appsettings and before the application's environment variables and arguments.
        var sources = builder.Configuration.Sources;
        var environmentIndex = sources.ToList().FindIndex(source =>
            source is EnvironmentVariablesConfigurationSource { Prefix: null or "" });
        sources.Insert(environmentIndex, new JsonConfigurationSource
        {
            Path = SettingsFile,
            FileProvider = builder.Environment.ContentRootFileProvider,
            Optional = true,
            ReloadOnChange = false
        });
    }

    public static int Run(string[] args)
    {
        try
        {
            var builder = WebApplication.CreateBuilder(args);
            var contentRoot = builder.Environment.ContentRootPath;
            var settingsPath = Path.Combine(contentRoot, SettingsFile);

            Console.WriteLine("NAMI database setup\n\n  1. SQLite\n  2. PostgreSQL\n");
            var provider = Read("Database type", "1").Trim();
            var selection = provider switch
            {
                "1" => ReadSqlite(contentRoot, settingsPath, builder.Configuration["Database:File"] ?? "data/nami.db"),
                "2" => ReadPostgres(),
                _ => throw new ArgumentException("Choose 1 for SQLite or 2 for PostgreSQL.")
            };

            using var proposed = new ConfigurationManager();
            proposed.AddInMemoryCollection(selection.Settings);
            using var overrides = new ConfigurationManager();
            overrides.AddEnvironmentVariables().AddCommandLine(args);
            var overriddenKeys = selection.Settings.Where(setting =>
                overrides[setting.Key] is { } value && value != setting.Value).Select(setting => setting.Key).ToArray();
            if (overriddenKeys.Length > 0)
                Console.WriteLine($"Deployment settings will take priority at startup: {string.Join(", ", overriddenKeys)}.");

            Console.Write($"\nSet up {selection.Target}? [Y/n]: ");
            var confirmation = (Console.ReadLine() ?? throw new OperationCanceledException()).Trim();
            if (confirmation.Length > 0 && !confirmation.Equals("y", StringComparison.OrdinalIgnoreCase) &&
                !confirmation.Equals("yes", StringComparison.OrdinalIgnoreCase))
                throw new OperationCanceledException();

            using (var database = Database.Open(proposed, contentRoot))
                Schema.Upgrade(database, selection.Schema);

            Save(settingsPath, selection.Settings);
            Console.WriteLine($"Database ready. Saved settings to {settingsPath}.");
            Console.WriteLine("Start or restart NAMI to use the saved selection.");
            return 0;
        }
        catch (OperationCanceledException)
        {
            Console.WriteLine("Database setup cancelled.");
            return 0;
        }
        catch (Exception error) when (error is DbException or IOException or UnauthorizedAccessException
            or InvalidOperationException or ArgumentException)
        {
            Console.Error.WriteLine($"Database setup failed. {error.Message}");
            return 1;
        }
    }

    private static Selection ReadSqlite(string contentRoot, string settingsPath, string defaultFile)
    {
        var path = Path.GetFullPath(Read("SQLite file", defaultFile), contentRoot);
        if (path.Equals(settingsPath, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Choose a SQLite file other than the NAMI database settings file.");

        return new Selection(path, new Dictionary<string, string?>
        {
            ["Database:Provider"] = "SQLite",
            ["Database:File"] = path
        });
    }

    private static Selection ReadPostgres()
    {
        var host = Read("Host", "localhost");
        if (!int.TryParse(Read("Port", "5432"), out var port) || port is < 1 or > 65535)
            throw new ArgumentException("Enter a PostgreSQL port between 1 and 65535.");
        var name = Read("Database name");
        var username = Read("Username");
        var schema = Read("Schema", "nami");
        Console.WriteLine("NAMI uses the PostgreSQL credentials configured for this process, such as a password file.");

        using var identifiers = new NpgsqlCommandBuilder();
        var connection = new NpgsqlConnectionStringBuilder
        {
            Host = host,
            Port = port,
            Database = name,
            Username = username,
            SearchPath = identifiers.QuoteIdentifier(schema)
        };

        return new Selection($"schema \"{schema}\" in {name} on {host} (port {port})",
            new Dictionary<string, string?>
            {
                ["Database:Provider"] = "PostgreSQL",
                ["ConnectionStrings:Nami"] = connection.ConnectionString
            }, schema);
    }

    private static string Read(string prompt, string? defaultValue = null)
    {
        Console.Write(defaultValue is null ? $"{prompt}: " : $"{prompt} [{defaultValue}]: ");
        var input = Console.ReadLine() ?? throw new OperationCanceledException();
        if (!string.IsNullOrWhiteSpace(input))
            return input;

        return defaultValue ?? throw new ArgumentException($"{prompt} is required.");
    }

    private static void Save(string path, Dictionary<string, string?> settings)
    {
        // A SQLite path can refer to the settings file through a symbolic link.
        if (File.Exists(path))
        {
            using var existing = File.OpenRead(path);
            ReadOnlySpan<byte> sqliteSignature = "SQLite format 3\0"u8;
            Span<byte> header = stackalloc byte[sqliteSignature.Length];
            if (existing.ReadAtLeast(header, header.Length, false) == header.Length &&
                header.SequenceEqual(sqliteSignature))
                throw new IOException("The NAMI settings path contains a SQLite database. Move it before saving setup settings.");
        }

        var directory = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(directory);
        var temporary = Path.Combine(directory, $"{Guid.NewGuid():N}.tmp");
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(settings, JsonOptions));
            File.Move(temporary, path, overwrite: true);
        }
        finally
        {
            File.Delete(temporary);
        }
    }

    private sealed record Selection(string Target, Dictionary<string, string?> Settings, string? Schema = null);
}
