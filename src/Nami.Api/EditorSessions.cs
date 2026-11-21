using System.Security.Cryptography;

internal sealed class EditorSessions(TimeProvider timeProvider, EditorPassword password)
{
    private static readonly TimeSpan IdleTime = TimeSpan.FromHours(8);
    private readonly Dictionary<string, Session> active = new(StringComparer.Ordinal);
    private readonly Lock gate = new();

    public (string Token, DateTimeOffset ExpiresAt) Start(string? previousToken, string verifiedHash)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        lock (gate)
        {
            var now = timeProvider.GetUtcNow();
            foreach (var expired in active.Where(entry =>
                entry.Value.ExpiresAt <= now || !password.IsCurrent(entry.Value.PasswordHash)).ToArray())
                active.Remove(expired.Key);
            if (previousToken is not null)
                active.Remove(previousToken);

            var expiresAt = now + IdleTime;
            active.Add(token, new Session(expiresAt, verifiedHash));
            return (token, expiresAt);
        }
    }

    public DateTimeOffset? GetExpiry(string? token, bool renew = false)
    {
        if (token is null)
            return null;

        lock (gate)
        {
            if (!active.TryGetValue(token, out var session))
                return null;
            var now = timeProvider.GetUtcNow();
            if (session.ExpiresAt <= now || !password.IsCurrent(session.PasswordHash))
            {
                active.Remove(token);
                return null;
            }

            if (!renew)
                return session.ExpiresAt;

            var expiresAt = now + IdleTime;
            active[token] = session with { ExpiresAt = expiresAt };
            return expiresAt;
        }
    }

    public void Revoke(string? token)
    {
        if (token is null)
            return;

        lock (gate)
            active.Remove(token);
    }

    private readonly record struct Session(DateTimeOffset ExpiresAt, string PasswordHash);
}
