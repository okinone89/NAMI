using Microsoft.AspNetCore.Http.HttpResults;

internal static class EditorSessionEndpoints
{
    internal const string Path = "/api/editor-session";

    public static void MapEditorSession(this WebApplication app)
    {
        app.MapGet(Path, (HttpContext context, EditorSessions sessions) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var expiresAt = sessions.GetExpiry(context.Request.Cookies[CookieName(app.Environment)]);
            return TypedResults.Ok(new EditorSessionResponse(expiresAt.HasValue, expiresAt));
        }).WithMetadata(new EditorSessionEndpoint()).WithSummary("Check the current editor session");

        app.MapPost(Path, Results<Ok<EditorSessionResponse>, ProblemHttpResult> (
            UnlockEditingRequest request, HttpContext context, EditorSessions sessions) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (!sessions.IsConfigured)
                return TypedResults.Problem(statusCode: 503, title: "Editing is not configured");
            if (!sessions.MatchesPassphrase(request.Passphrase))
                return TypedResults.Problem(statusCode: 401, title: "Incorrect editor passphrase");

            var cookieName = CookieName(app.Environment);
            var session = sessions.Start(context.Request.Cookies[cookieName]);
            context.Response.Cookies.Append(cookieName, session.Token, CookieOptions(app.Environment));
            return TypedResults.Ok(new EditorSessionResponse(true, session.ExpiresAt));
        }).WithMetadata(new EditorSessionEndpoint()).WithSummary("Unlock editing across plans");

        app.MapDelete(Path, (HttpContext context, EditorSessions sessions) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var cookieName = CookieName(app.Environment);
            sessions.Revoke(context.Request.Cookies[cookieName]);
            context.Response.Cookies.Delete(cookieName, CookieOptions(app.Environment));
            return TypedResults.NoContent();
        }).WithMetadata(new EditorSessionEndpoint()).WithSummary("Sign out of the editor session");
    }

    internal static string CookieName(IHostEnvironment environment) =>
        environment.IsDevelopment() ? "nami-editor-dev" : "__Host-nami-editor";

    private static CookieOptions CookieOptions(IHostEnvironment environment) => new()
    {
        HttpOnly = true,
        Secure = !environment.IsDevelopment(),
        SameSite = SameSiteMode.Strict,
        Path = "/"
    };
}

/// <summary>The shared editor passphrase provided by the visitor.</summary>
internal sealed record UnlockEditingRequest(string? Passphrase);

/// <summary>Whether editing is unlocked and when an idle session expires.</summary>
internal sealed record EditorSessionResponse(bool CanEdit, DateTimeOffset? ExpiresAt);
