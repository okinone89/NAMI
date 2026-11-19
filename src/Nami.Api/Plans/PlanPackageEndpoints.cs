using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Nami.Api.Plans;

internal static class PlanPackageEndpoints
{
    private const int CurrentVersion = 1;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        RespectRequiredConstructorParameters = true,
        AllowDuplicateProperties = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        NumberHandling = JsonNumberHandling.Strict,
        Converters = { new JsonStringEnumConverter<LinkMedium>(JsonNamingPolicy.CamelCase, allowIntegerValues: false) }
    };

    public static void MapPlanPackages(this WebApplication app)
    {
        var plans = app.MapGroup("/api/plans");
        plans.MapGet("/{id}/package", Export)
            .WithMetadata(new RequireEditorSession())
            .WithSummary("Download a self-contained plan package")
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status404NotFound);
        plans.MapPost("/import", Import)
            .WithSummary("Import a plan package as an independent copy")
            .Accepts<PlanPackage>("application/json")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status415UnsupportedMediaType);
    }

    private static async Task<Results<FileContentHttpResult, ProblemHttpResult>> Export(
        string id, PlanStore store, HttpResponse response, CancellationToken cancellationToken)
    {
        var plan = await store.GetAsync(id, cancellationToken);
        if (plan is null)
            return TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Plan not found");

        var package = new PlanPackage(CurrentVersion, new PackagePlan(plan));
        response.Headers.CacheControl = "no-store";
        return TypedResults.File(JsonSerializer.SerializeToUtf8Bytes(package, JsonOptions),
            "application/json", $"nami-{plan.Id}.nami.json");
    }

    private static async Task<Results<Created<Plan>, ProblemHttpResult>> Import(
        HttpRequest request, PlanStore store, CancellationToken cancellationToken)
    {
        if (!request.HasJsonContentType())
            return TypedResults.Problem(statusCode: StatusCodes.Status415UnsupportedMediaType,
                title: "Upload the NAMI plan package as JSON");

        PlanPackage? package;
        try
        {
            package = await JsonSerializer.DeserializeAsync<PlanPackage>(request.Body, JsonOptions, cancellationToken);
        }
        catch (JsonException)
        {
            return InvalidPackage();
        }

        if (package?.Plan is not { } contents)
            return InvalidPackage();
        if (package.Version != CurrentVersion)
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "This plan package version is unsupported");

        // All other IDs have plan scope, so keeping them preserves the internal relationships.
        var copy = contents.ApplyTo(new Plan(Guid.NewGuid().ToString(), contents.Name, Revision: 0));
        try
        {
            await store.InsertAsync(copy, cancellationToken);
        }
        catch (AddressValidationException error)
        {
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest, title: error.Message,
                extensions: new Dictionary<string, object?> { ["addressIssues"] = error.Issues });
        }
        catch (ArgumentException)
        {
            return InvalidPackage();
        }

        return TypedResults.Created($"/api/plans/{copy.Id}", copy);
    }

    private static ProblemHttpResult InvalidPackage() =>
        TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest,
            title: "Choose a complete and valid NAMI plan package");
}

/// <summary>A portable plan and its package format version.</summary>
internal sealed record PlanPackage(int Version, PackagePlan Plan);

/// <summary>The plan graph with its embedded assets and plan-scoped IDs.</summary>
internal sealed record PackagePlan : PlanTopology
{
    public required string Name { get; init; }

    public PackagePlan() { }

    [SetsRequiredMembers]
    internal PackagePlan(Plan plan) : base(plan) => Name = plan.Name;
}
