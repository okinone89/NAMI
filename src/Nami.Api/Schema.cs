using System.Data.Common;
using Npgsql;

internal static class Schema
{
    // ASCII "NAMI". All releases must acquire the same PostgreSQL migration lock.
    private const int MigrationLockKey = 0x4E414D49;

    // Entries are applied in order. Append new migrations to preserve deployed versions.
    private static readonly string[] Migrations =
    [
        "CREATE TABLE plans (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL)",
        "CREATE INDEX plans_name_idx ON plans (name)",
        """
        ALTER TABLE plans ADD COLUMN revision BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE plans ADD COLUMN topology TEXT;
        """,
        "ALTER TABLE plans ADD COLUMN inventory_undo TEXT",
        "CREATE TABLE editor_password (id INTEGER PRIMARY KEY CHECK (id = 1), password_hash TEXT NOT NULL)"
    ];

    public static void Upgrade(DbConnection database, string? postgresSchema = null)
    {
        // SQLite begins an immediate write transaction. Serialize PostgreSQL startups too.
        using var transaction = database.BeginTransaction();
        using var command = database.CreateCommand();
        command.Transaction = transaction;
        if (database is NpgsqlConnection)
        {
            command.CommandText = $"SELECT pg_catalog.pg_advisory_xact_lock({MigrationLockKey})";
            command.ExecuteNonQuery();
            if (postgresSchema is not null)
                EnsurePostgresSchema(command, postgresSchema);
        }

        command.CommandText = "CREATE TABLE IF NOT EXISTS nami_migrations (version INTEGER PRIMARY KEY)";
        command.ExecuteNonQuery();
        command.CommandText = "SELECT COALESCE(MAX(version), 0) FROM nami_migrations";
        var applied = Convert.ToInt32(command.ExecuteScalar());
        if (applied > Migrations.Length)
            throw new InvalidOperationException("This database requires a newer version of NAMI.");

        for (var i = applied; i < Migrations.Length; i++)
        {
            command.CommandText = Migrations[i];
            command.ExecuteNonQuery();
            command.CommandText = $"INSERT INTO nami_migrations (version) VALUES ({i + 1})";
            command.ExecuteNonQuery();
        }
        transaction.Commit();
    }

    private static void EnsurePostgresSchema(DbCommand command, string schema)
    {
        command.CommandText = "SELECT EXISTS (SELECT FROM pg_catalog.pg_namespace WHERE nspname::text = @schema)";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "schema";
        parameter.Value = schema;
        command.Parameters.Add(parameter);
        var exists = (bool)command.ExecuteScalar()!;
        command.Parameters.Clear();

        if (!exists)
        {
            using var identifiers = new NpgsqlCommandBuilder();
            command.CommandText = $"CREATE SCHEMA IF NOT EXISTS {identifiers.QuoteIdentifier(schema)}";
            command.ExecuteNonQuery();
        }

        command.CommandText = "SELECT pg_catalog.current_schema()";
        if (command.ExecuteScalar() as string != schema)
            throw new InvalidOperationException("PostgreSQL could not select that schema. Check its name length and your schema permissions.");
    }
}
