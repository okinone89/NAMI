using System.Text.Json;
using System.Text.Json.Serialization;
using Nami.Api.Plans;

if (args is ["--setup", ..])
    return DatabaseSetup.Run(args[1..]);
if (args is ["--reset-editor-password", ..])
    return EditorPassword.Reset(args[1..]);

NamiApplication.Build(args).Run();
return 0;

internal static class NamiApplication
{
    public static WebApplication Build(string[] args, TimeProvider? timeProvider = null)
    {
        var builder = CreateBuilder(args);
        using (var database = Database.Open(builder.Configuration, builder.Environment.ContentRootPath))
        {
            Schema.Upgrade(database);
            builder.Services.AddSingleton(new EditorPassword(builder.Configuration,
                builder.Environment.ContentRootPath, EditorPassword.ReadHash(database)));
        }

        builder.Services.AddSingleton(timeProvider ?? TimeProvider.System);
        builder.Services.AddSingleton<EditorSessions>();
        builder.Services.AddSingleton(new PlanStore(builder.Configuration, builder.Environment.ContentRootPath));
        builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.Converters.Add(
            new JsonStringEnumConverter<LinkMedium>(JsonNamingPolicy.CamelCase, allowIntegerValues: false)));
        var app = builder.Build();

        app.UseDefaultFiles();
        app.UseStaticFiles();
        app.UseRouting();
        app.UseMiddleware<EditorSessionGuard>();
        app.MapGet("/health", () => Results.Ok(new { status = "ready" }));
        app.MapEditorSession();
        app.MapPlans();
        app.MapPlanPackages();
        app.MapAddressAllocation();
        app.MapInventory();
        return app;
    }

    internal static WebApplicationBuilder CreateBuilder(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        DatabaseSetup.AddSavedSettings(builder);
        return builder;
    }
}
