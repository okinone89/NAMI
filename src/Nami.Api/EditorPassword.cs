using System.Data.Common;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

internal sealed class EditorPassword(IConfiguration configuration, string contentRoot, string? initialHash)
{
    public const int MinLength = 15;
    public const int MaxLength = 256;

    private readonly PasswordHasher<EditorPassword> hasher = new(
        Options.Create(new PasswordHasherOptions { IterationCount = 220_000 }));
    // The offline reset takes effect at the next service startup.
    private string? hash = initialHash;

    public bool IsConfigured => GetHash() is not null;

    public static bool IsAllowed(string? password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length > MaxLength * 2)
            return false;

        var length = 0;
        foreach (var _ in password.EnumerateRunes())
            length++;
        return length is >= MinLength and <= MaxLength;
    }

    public string? Verify(string? password) =>
        password is not null && IsAllowed(password) && GetHash() is { } stored &&
        hasher.VerifyHashedPassword(this, stored, password) != PasswordVerificationResult.Failed
            ? stored : null;

    public bool IsCurrent(string verifiedHash) => Volatile.Read(ref hash) == verifiedHash;

    public string? TryCreate(string password)
    {
        var candidate = hasher.HashPassword(this, password);
        using var database = Database.Open(configuration, contentRoot);
        using var command = database.CreateCommand();
        command.CommandText = """
            INSERT INTO editor_password (id, password_hash) VALUES (1, @hash)
            ON CONFLICT (id) DO NOTHING
            """;
        AddParameter(command, "hash", candidate);
        if (command.ExecuteNonQuery() == 0)
            return null;

        Interlocked.CompareExchange(ref hash, candidate, null);
        return candidate;
    }

    public string? TryChange(string verifiedHash, string password)
    {
        var candidate = hasher.HashPassword(this, password);
        using var database = Database.Open(configuration, contentRoot);
        using var command = database.CreateCommand();
        command.CommandText = "UPDATE editor_password SET password_hash = @hash WHERE id = 1 AND password_hash = @verified";
        AddParameter(command, "hash", candidate);
        AddParameter(command, "verified", verifiedHash);
        if (command.ExecuteNonQuery() == 0)
            return null;

        Volatile.Write(ref hash, candidate);
        return candidate;
    }

    private static void AddParameter(DbCommand command, string name, string value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    private string? GetHash()
    {
        if (Volatile.Read(ref hash) is { } current)
            return current;

        using var database = Database.Open(configuration, contentRoot);
        var stored = ReadHash(database);
        if (stored is not null)
            Interlocked.CompareExchange(ref hash, stored, null);
        return Volatile.Read(ref hash);
    }

    internal static string? ReadHash(DbConnection database)
    {
        using var command = database.CreateCommand();
        command.CommandText = "SELECT password_hash FROM editor_password WHERE id = 1";
        return (string?)command.ExecuteScalar();
    }

    internal static int Reset(string[] args)
    {
        try
        {
            var builder = NamiApplication.CreateBuilder(args);
            using var database = Database.Open(builder.Configuration, builder.Environment.ContentRootPath);
            Schema.Upgrade(database);
            using var command = database.CreateCommand();
            command.CommandText = "DELETE FROM editor_password WHERE id = 1";
            var removed = command.ExecuteNonQuery() == 1;
            Console.WriteLine(removed ? "Editor password cleared." : "The editor password is already unset.");
            Console.WriteLine("Start NAMI and open it in a browser to create the editor password.");
            return 0;
        }
        catch (Exception error) when (error is DbException or IOException or UnauthorizedAccessException
            or InvalidOperationException or ArgumentException)
        {
            Console.Error.WriteLine($"Editor password reset failed. {error.Message}");
            return 1;
        }
    }
}
