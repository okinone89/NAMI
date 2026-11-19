var app = NamiApplication.Build(args);
app.Run();

internal static class NamiApplication
{
    public static WebApplication Build(string[] args, TimeProvider? timeProvider = null)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Services.AddSingleton(timeProvider ?? TimeProvider.System);
        builder.Services.AddSingleton<EditorSessions>();
        var app = builder.Build();

        using (var database = Database.Open(app.Configuration, app.Environment.ContentRootPath))
        {
            Schema.Upgrade(database);
        }

        app.UseRouting();
        app.UseMiddleware<EditorSessionGuard>();
        app.MapGet("/health", () => Results.Ok(new { status = "ready" }));
        app.MapEditorSession();
        return app;
    }
}
