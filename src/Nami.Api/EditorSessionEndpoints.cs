using Microsoft.AspNetCore.Http.HttpResults;

internal static class EditorSessionEndpoints
{
    internal const string Path = "/api/editor-session";

    public static void MapEditorSession(this WebApplication app)
    {
        app.MapGet(Path, (HttpContext context, EditorSessions sessions, EditorPassword password, EditorSessionCookie cookie) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var expiresAt = sessions.GetExpiry(context.Request.Cookies[cookie.Name(context.Request)]);
            return TypedResults.Ok(new EditorSessionResponse(expiresAt.HasValue, expiresAt, !password.IsConfigured));
        }).WithMetadata(new EditorSessionEndpoint()).WithSummary("Check the current editor session");

        app.MapPost(Path, Results<Ok<EditorSessionResponse>, ProblemHttpResult> (
            UnlockEditingRequest request, HttpContext context, EditorSessions sessions, EditorPassword password,
            EditorSessionCookie cookie) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (cookie.RequiresHttps(context.Request))
                return HttpsRequired();
            if (!password.IsConfigured)
                return TypedResults.Problem(statusCode: 409, title: "Create the editor password first");
            if (password.Verify(request.Password) is not { } verifiedHash)
                return TypedResults.Problem(statusCode: 401, title: "Incorrect editor password");

            return TypedResults.Ok(StartSession(context, sessions, cookie, verifiedHash));
        }).WithMetadata(new EditorSessionEndpoint()).WithSummary("Unlock editing across plans");

        app.MapPost(Path + "/setup", Results<Created<EditorSessionResponse>, ProblemHttpResult> (
            CreateEditorPasswordRequest request, HttpContext context, EditorSessions sessions, EditorPassword password,
            EditorSessionCookie cookie) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (cookie.RequiresHttps(context.Request))
                return HttpsRequired();
            if (password.IsConfigured)
                return TypedResults.Problem(statusCode: 409, title: "The editor password is already set");
            var supplied = request.Password ?? string.Empty;
            if (ValidateNewPassword(supplied, request.Confirmation) is { } problem)
                return problem;
            if (password.TryCreate(supplied) is not { } createdHash)
                return TypedResults.Problem(statusCode: 409, title: "The editor password is already set");

            return TypedResults.Created(Path, StartSession(context, sessions, cookie, createdHash));
        }).WithMetadata(new EditorSessionEndpoint()).WithSummary("Create the initial editor password and unlock editing");

        app.MapPut(Path + "/password", Results<Ok<EditorSessionResponse>, ProblemHttpResult> (
            ChangeEditorPasswordRequest request, HttpContext context, EditorSessions sessions, EditorPassword password,
            EditorSessionCookie cookie) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var replacement = request.NewPassword ?? string.Empty;
            if (ValidateNewPassword(replacement, request.Confirmation) is { } problem)
                return problem;
            if (password.Verify(request.CurrentPassword) is not { } verifiedHash)
                return TypedResults.Problem(statusCode: 403, title: "Incorrect current password.");
            if (replacement == request.CurrentPassword)
                return TypedResults.Problem(statusCode: 400, title: "Choose a password different from the current password.");
            if (sessions.GetExpiry(context.Request.Cookies[cookie.Name(context.Request)]) is null)
                return TypedResults.Problem(statusCode: 401, title: "Unlock editing to change the editor password.");
            if (password.TryChange(verifiedHash, replacement) is not { } changedHash)
                return TypedResults.Problem(statusCode: 409, title: "The editor password has changed. Unlock editing and try again.");

            return TypedResults.Ok(StartSession(context, sessions, cookie, changedHash));
        }).WithSummary("Change the shared editor password using the current password");

        app.MapDelete(Path, (HttpContext context, EditorSessions sessions, EditorSessionCookie cookie) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var cookieName = cookie.Name(context.Request);
            sessions.Revoke(context.Request.Cookies[cookieName]);
            context.Response.Cookies.Delete(cookieName, cookie.Options(context.Request));
            return TypedResults.NoContent();
        }).WithMetadata(new EditorSessionEndpoint()).WithSummary("Sign out of the editor session");
    }

    private static ProblemHttpResult? ValidateNewPassword(string password, string? confirmation)
    {
        if (!EditorPassword.IsAllowed(password))
            return TypedResults.Problem(statusCode: 400,
                title: $"Enter a password of {EditorPassword.MinLength} to {EditorPassword.MaxLength} characters.");
        if (password != confirmation)
            return TypedResults.Problem(statusCode: 400, title: "Passwords do not match.");
        return null;
    }

    private static ProblemHttpResult HttpsRequired() =>
        TypedResults.Problem(statusCode: 400, title: "Open NAMI using its HTTPS address to unlock editing.");

    private static EditorSessionResponse StartSession(HttpContext context, EditorSessions sessions, EditorSessionCookie cookie,
        string verifiedHash)
    {
        var cookieName = cookie.Name(context.Request);
        var session = sessions.Start(context.Request.Cookies[cookieName], verifiedHash);
        context.Response.Cookies.Append(cookieName, session.Token, cookie.Options(context.Request));
        return new EditorSessionResponse(true, session.ExpiresAt, SetupRequired: false);
    }
}

/// <summary>The shared editor password provided by the visitor.</summary>
internal sealed record UnlockEditingRequest(string? Password);

/// <summary>The shared editor password to set, entered twice.</summary>
internal sealed record CreateEditorPasswordRequest(string? Password, string? Confirmation);

/// <summary>The current editor password and the new password entered twice.</summary>
internal sealed record ChangeEditorPasswordRequest(string? CurrentPassword, string? NewPassword, string? Confirmation);

/// <summary>Whether editing is unlocked, when the session expires, and whether setup is required.</summary>
internal sealed record EditorSessionResponse(bool CanEdit, DateTimeOffset? ExpiresAt, bool SetupRequired);
