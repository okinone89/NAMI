using System.Collections.Concurrent;

var clock = new TestTimeProvider();
var app = NamiApplication.Build(args, clock);
var plans = new ConcurrentDictionary<string, string>(new Dictionary<string, string>
{
    ["filler"] = "Filler",
    ["assembly"] = "Assembly"
});

// Representative plan endpoints run through the same HTTP pipeline as the API.
app.MapGet("/api/test-plans/{id}", (string id) => TypedResults.Ok(new PlanName(plans[id])));
app.MapPut("/api/test-plans/{id}", (string id, PlanName plan) =>
{
    plans[id] = plan.Name;
    return TypedResults.NoContent();
});
app.MapGet("/test/clock/{seconds:long}", (long seconds) =>
{
    clock.SetElapsedSeconds(seconds);
    return TypedResults.NoContent();
});
app.Run();

internal sealed record PlanName(string Name);

internal sealed class TestTimeProvider : TimeProvider
{
    private long elapsedSeconds;

    public override DateTimeOffset GetUtcNow() =>
        DateTimeOffset.UnixEpoch.AddSeconds(Interlocked.Read(ref elapsedSeconds));

    public void SetElapsedSeconds(long seconds) => Interlocked.Exchange(ref elapsedSeconds, seconds);
}
