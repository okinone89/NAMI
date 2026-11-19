var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

using (var database = Database.Open(app.Configuration, app.Environment.ContentRootPath))
{
    Schema.Upgrade(database);
}

app.MapGet("/health", () => Results.Ok(new { status = "ready" }));
app.Run();
