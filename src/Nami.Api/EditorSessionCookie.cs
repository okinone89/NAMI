internal sealed class EditorSessionCookie(IHostEnvironment environment, IConfiguration configuration)
{
    private readonly bool allowInsecureHttp = configuration.GetValue<bool>("EditorSession:AllowInsecureHttp");

    public string Name(HttpRequest request) =>
        environment.IsDevelopment() ? "nami-editor-dev" :
        IsSecure(request) ? "__Host-nami-editor" : "nami-editor-http";

    public CookieOptions Options(HttpRequest request) => new()
    {
        HttpOnly = true,
        Secure = IsSecure(request),
        SameSite = SameSiteMode.Strict,
        Path = "/"
    };

    public bool RequiresHttps(HttpRequest request) =>
        IsSecure(request) &&
        // Browser Origin reflects the public scheme when TLS terminates at a proxy.
        Uri.TryCreate(request.Headers.Origin, UriKind.Absolute, out var origin) &&
        origin.Scheme == Uri.UriSchemeHttp && !origin.IsLoopback;

    private bool IsSecure(HttpRequest request) =>
        !environment.IsDevelopment() && (!allowInsecureHttp || request.IsHttps);
}
