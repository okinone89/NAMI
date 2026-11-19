using Microsoft.AspNetCore.Http.HttpResults;

namespace Nami.Api.Plans;

internal static class PlanEndpoints
{
    public static void MapPlans(this WebApplication app)
    {
        var plans = app.MapGroup("/api/plans");
        plans.MapGet("", async (PlanStore store, CancellationToken cancellationToken) =>
            TypedResults.Ok(await store.ListAsync(cancellationToken)))
            .WithSummary("List plans");
        plans.MapGet("/{id}", GetPlan)
            .WithSummary("Read a plan and its topology");
        plans.MapPost("", CreatePlan)
            .WithSummary("Create a plan")
            .ProducesProblem(StatusCodes.Status401Unauthorized);
        plans.MapPut("/{id}", SavePlan)
            .WithSummary("Save a plan snapshot at the current revision")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }

    private static async Task<Results<Ok<Plan>, ProblemHttpResult>> GetPlan(
        string id, PlanStore store, CancellationToken cancellationToken)
    {
        var plan = await store.GetAsync(id, cancellationToken);
        return plan is null
            ? TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Plan not found")
            : TypedResults.Ok(plan);
    }

    private static async Task<Results<Created<Plan>, ProblemHttpResult>> CreatePlan(
        CreatePlanRequest request, PlanStore store, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Enter a plan name");

        var plan = await store.CreateAsync(request.Name.Trim(), cancellationToken);
        return TypedResults.Created($"/api/plans/{plan.Id}", plan);
    }

    private static async Task<Results<Ok<Plan>, ProblemHttpResult>> SavePlan(
        string id, SavePlanRequest request, PlanStore store, CancellationToken cancellationToken)
    {
        if (id != request.Id || request.Revision < 0)
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid plan identity or revision");

        var plan = new Plan(id, request.Name, request.Revision)
        {
            Networks = request.Networks,
            Components = request.Components,
            Interfaces = request.Interfaces,
            Links = request.Links
        };
        try
        {
            if (await store.SaveAsync(plan, request.KeepAddressConflicts ?? [], cancellationToken))
                return TypedResults.Ok(plan with { Revision = plan.Revision + 1 });
        }
        catch (AddressValidationException error)
        {
            var duplicatesOnly = error.Issues.All(issue => issue.Code == AddressIssueCode.DuplicateIpv4);
            return TypedResults.Problem(
                statusCode: duplicatesOnly ? StatusCodes.Status409Conflict : StatusCodes.Status400BadRequest,
                title: duplicatesOnly ? "Resolve the IPv4 address conflicts or keep them flagged." : error.Message,
                extensions: new Dictionary<string, object?> { ["addressIssues"] = error.Issues });
        }
        catch (ArgumentException)
        {
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Check plan names, IDs, topology references, and protocol profiles");
        }

        return await store.GetAsync(id, cancellationToken) is null
            ? TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Plan not found")
            : TypedResults.Problem(statusCode: StatusCodes.Status409Conflict,
                title: "The plan changed. Reload it before saving again.");
    }
}

/// <summary>The name of a new plan.</summary>
internal sealed record CreatePlanRequest(string? Name);

/// <summary>A full plan snapshot at the revision opened by the editor.</summary>
internal sealed record SavePlanRequest
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required long Revision { get; init; }
    public required IReadOnlyList<PlanNetwork> Networks { get; init; }
    public required IReadOnlyList<Component> Components { get; init; }
    public required IReadOnlyList<PlanInterface> Interfaces { get; init; }
    public required IReadOnlyList<PlanLink> Links { get; init; }
    public IReadOnlyList<AddressConflictApproval>? KeepAddressConflicts { get; init; }
}
