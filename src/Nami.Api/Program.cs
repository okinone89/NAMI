using System.Text.Json;
using System.Text.Json.Serialization;
using Nami.Api.Plans;

var app = NamiApplication.Build(args);
app.Run();

internal static class NamiApplication
{
    public static WebApplication Build(string[] args, TimeProvider? timeProvider = null)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Services.AddSingleton(timeProvider ?? TimeProvider.System);
        builder.Services.AddSingleton<EditorSessions>();
        builder.Services.AddSingleton(new PlanStore(builder.Configuration, builder.Environment.ContentRootPath));
        builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.Converters.Add(
            new JsonStringEnumConverter<LinkMedium>(JsonNamingPolicy.CamelCase, allowIntegerValues: false)));
        var app = builder.Build();

        using (var database = Database.Open(app.Configuration, app.Environment.ContentRootPath))
        {
            Schema.Upgrade(database);
        }

        app.UseRouting();
        app.UseMiddleware<EditorSessionGuard>();
        app.MapGet("/health", () => Results.Ok(new { status = "ready" }));
        app.MapEditorSession();
        app.MapPlans();
        app.MapAddressAllocation();
        app.MapInventory();
        return app;
    }
}
