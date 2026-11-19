using System.Security.Cryptography;
using System.Text;

internal sealed class EditorSessions(IConfiguration configuration, TimeProvider timeProvider)
{
    private static readonly TimeSpan IdleTime = TimeSpan.FromHours(8);
    private readonly byte[]? passphraseDigest = GetDigest(configuration["Editor:Passphrase"]);
    private readonly Dictionary<string, DateTimeOffset> expiries = new(StringComparer.Ordinal);
    private readonly Lock gate = new();

    public bool IsConfigured => passphraseDigest is not null;

    public bool MatchesPassphrase(string? passphrase) =>
        passphraseDigest is { } expected && GetDigest(passphrase) is { } supplied &&
        CryptographicOperations.FixedTimeEquals(expected, supplied);

    public (string Token, DateTimeOffset ExpiresAt) Start(string? previousToken)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        lock (gate)
        {
            var now = timeProvider.GetUtcNow();
            foreach (var expired in expiries.Where(session => session.Value <= now).ToArray())
                expiries.Remove(expired.Key);
            if (previousToken is not null)
                expiries.Remove(previousToken);

            var expiresAt = now + IdleTime;
            expiries.Add(token, expiresAt);
            return (token, expiresAt);
        }
    }

    public DateTimeOffset? GetExpiry(string? token, bool renew = false)
    {
        if (token is null)
            return null;

        lock (gate)
        {
            if (!expiries.TryGetValue(token, out var expiresAt))
                return null;
            var now = timeProvider.GetUtcNow();
            if (expiresAt <= now)
            {
                expiries.Remove(token);
                return null;
            }

            if (renew)
                expiries[token] = expiresAt = now + IdleTime;
            return expiresAt;
        }
    }

    public void Revoke(string? token)
    {
        if (token is null)
            return;

        lock (gate)
            expiries.Remove(token);
    }

    private static byte[]? GetDigest(string? passphrase) =>
        string.IsNullOrWhiteSpace(passphrase) ? null : SHA256.HashData(Encoding.UTF8.GetBytes(passphrase));
}
