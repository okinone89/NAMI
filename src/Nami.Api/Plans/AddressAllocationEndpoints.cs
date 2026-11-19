using Microsoft.AspNetCore.Http.HttpResults;

namespace Nami.Api.Plans;

internal static class AddressAllocationEndpoints
{
    public static void MapAddressAllocation(this WebApplication app)
    {
        var allocation = app.MapGroup("/api/plans/{id}/address-allocation");
        allocation.MapPost("/preview", Preview)
            .WithSummary("Preview IPv4 assignments from saved network pools")
            .ProducesProblem(StatusCodes.Status401Unauthorized);
        allocation.MapPost("/commit", Commit)
            .WithSummary("Commit the confirmed IPv4 assignments together")
            .ProducesProblem(StatusCodes.Status401Unauthorized);
    }

    private static async Task<Results<Ok<Plan>, Conflict<AddressAllocationPreview>, ProblemHttpResult>> Commit(
        string id, CommitAddressAllocationRequest request, PlanStore store, CancellationToken cancellationToken)
    {
        if (!IsValidSelection(request.InterfaceIds) || request.Assignments is null || request.Revision < 0)
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Confirm a preview for the selected interfaces.");

        var plan = await store.GetAsync(id, cancellationToken);
        if (plan is null)
            return TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Plan not found");

        var preview = AddressAllocation.Preview(plan, request.InterfaceIds!);
        if (preview.Revision != request.Revision || !preview.CanApply ||
            !preview.Assignments.SequenceEqual(request.Assignments))
            return TypedResults.Conflict(preview);

        var changes = preview.Assignments.Where(assignment => assignment.Status == AddressAllocation.Proposed)
            .ToDictionary(assignment => assignment.InterfaceId, assignment => assignment.Ipv4);
        var proposed = plan with
        {
            Interfaces = plan.Interfaces.Select(port => changes.TryGetValue(port.Id, out var ipv4)
                ? port with { Ipv4 = ipv4 }
                : port).ToArray()
        };
        try
        {
            var saved = await store.SaveSnapshotAsync(proposed, [], cancellationToken);
            if (saved is not null)
                return TypedResults.Ok(saved);
        }
        catch (AddressValidationException error)
        {
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest, title: error.Message,
                extensions: new Dictionary<string, object?> { ["addressIssues"] = error.Issues });
        }

        var current = await store.GetAsync(id, cancellationToken);
        return current is null
            ? TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Plan not found")
            : TypedResults.Conflict(AddressAllocation.Preview(current, request.InterfaceIds!));
    }

    private static async Task<Results<Ok<AddressAllocationPreview>, ProblemHttpResult>> Preview(
        string id, PreviewAddressAllocationRequest request, PlanStore store, CancellationToken cancellationToken)
    {
        if (!IsValidSelection(request.InterfaceIds))
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Select one or more unique interface IDs.");

        var plan = await store.GetAsync(id, cancellationToken);
        return plan is null
            ? TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Plan not found")
            : TypedResults.Ok(AddressAllocation.Preview(plan, request.InterfaceIds!));
    }

    private static bool IsValidSelection(IReadOnlyList<string>? ids) =>
        ids is { Count: > 0 } && ids.All(id => !string.IsNullOrWhiteSpace(id)) &&
        ids.Distinct(StringComparer.Ordinal).Count() == ids.Count;
}

/// <summary>The stable IDs of interfaces selected for IPv4 allocation.</summary>
internal sealed record PreviewAddressAllocationRequest(IReadOnlyList<string>? InterfaceIds);

/// <summary>A confirmation of the proposed assignments for all selected interfaces.</summary>
internal sealed record CommitAddressAllocationRequest(
    IReadOnlyList<string>? InterfaceIds, long Revision, IReadOnlyList<AddressAllocationAssignment>? Assignments);
