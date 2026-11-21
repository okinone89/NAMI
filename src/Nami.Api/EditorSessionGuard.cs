internal sealed class EditorSessionGuard(RequestDelegate next, EditorSessionCookie cookie)
{
    public async Task InvokeAsync(HttpContext context, EditorSessions sessions)
    {
        var endpoint = context.GetEndpoint();
        if (endpoint is null || HttpMethods.IsOptions(context.Request.Method))
        {
            await next(context);
            return;
        }

        bool sessionEndpoint = endpoint.Metadata.GetMetadata<EditorSessionEndpoint>() is not null;
        bool isRead = HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method);
        if (!isRead && !IsSameOrigin(context.Request))
        {
            await Results.Problem(statusCode: 403, title: "Cross-origin changes are not permitted")
                .ExecuteAsync(context);
            return;
        }

        bool requiresEditor = !isRead || endpoint.Metadata.GetMetadata<RequireEditorSession>() is not null;
        if (!sessionEndpoint && (requiresEditor || context.Request.Path.StartsWithSegments("/api")))
        {
            var token = context.Request.Cookies[cookie.Name(context.Request)];
            var expiresAt = sessions.GetExpiry(token, renew: true);
            if (requiresEditor && !expiresAt.HasValue)
            {
                await Results.Problem(statusCode: 401, title: isRead ? "Unlock editing to export a plan" : "Unlock editing to make changes")
                    .ExecuteAsync(context);
                return;
            }
        }

        await next(context);
    }

    private static bool IsSameOrigin(HttpRequest request)
    {
        // Fetch Metadata reflects the public origin even when TLS terminates at a proxy.
        if (request.Headers.TryGetValue("Sec-Fetch-Site", out var site))
            return site.Count == 1 && site[0] is "same-origin" or "none";

        return !request.Headers.TryGetValue("Origin", out var origin) ||
            (origin.Count == 1 && Uri.TryCreate(origin[0], UriKind.Absolute, out var source) &&
            Uri.TryCreate($"{request.Scheme}://{request.Host}", UriKind.Absolute, out var destination) &&
            Uri.Compare(source, destination, UriComponents.SchemeAndServer,
                UriFormat.SafeUnescaped, StringComparison.OrdinalIgnoreCase) == 0);
    }
}

// Session lifecycle operations are the only unsafe endpoints accessible without an active session.
internal sealed class EditorSessionEndpoint;

internal sealed class RequireEditorSession;
