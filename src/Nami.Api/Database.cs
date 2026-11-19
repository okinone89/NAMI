using System.Data.Common;
using Microsoft.Data.Sqlite;
using Npgsql;

internal static class Database
{
    public static DbConnection Open(IConfiguration configuration, string contentRoot)
    {
        DbConnection database;
        switch (configuration["Database:Provider"]?.ToLowerInvariant())
        {
            case "sqlite":
                var file = configuration["Database:File"];
                if (string.IsNullOrWhiteSpace(file))
                    throw new InvalidOperationException("Set Database:File to a SQLite file path.");

                var path = Path.GetFullPath(file, contentRoot);
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                database = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path }.ToString());
                break;
            case "postgresql":
                var connectionString = configuration.GetConnectionString("Nami");
                if (string.IsNullOrWhiteSpace(connectionString))
                    throw new InvalidOperationException("Set ConnectionStrings:Nami for PostgreSQL.");

                database = new NpgsqlConnection(connectionString);
                break;
            default:
                throw new InvalidOperationException("Set Database:Provider to SQLite or PostgreSQL.");
        }

        database.Open();
        return database;
    }
}
