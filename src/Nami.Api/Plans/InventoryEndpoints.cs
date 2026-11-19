using Microsoft.AspNetCore.Http.HttpResults;

namespace Nami.Api.Plans;

internal static class InventoryEndpoints
{
    public static void MapInventory(this WebApplication app)
    {
        var inventory = app.MapGroup("/api/plans/{id}");
        inventory.MapGet("/inventory.csv", Export)
            .WithSummary("Download one CSV inventory row per interface");
        inventory.MapPost("/inventory/preview", Preview)
            .WithSummary("Preview changes from mapped inventory rows")
            .ProducesProblem(StatusCodes.Status401Unauthorized);
    }

    private static async Task<Results<Ok<InventoryPreviewResponse>, ProblemHttpResult>> Preview(
        string id, InventoryPreviewRequest request, PlanStore store, CancellationToken cancellationToken)
    {
        if (!InventoryPreview.IsValid(request))
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Provide mapped inventory rows with unique row numbers.");

        var plan = await store.GetAsync(id, cancellationToken);
        return plan is null
            ? TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Plan not found")
            : TypedResults.Ok(InventoryPreview.Build(plan, request).Response);
    }

    private static async Task<Results<FileContentHttpResult, ProblemHttpResult>> Export(
        string id, PlanStore store, CancellationToken cancellationToken)
    {
        var plan = await store.GetAsync(id, cancellationToken);
        return plan is null
            ? TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Plan not found")
            : TypedResults.File(InventoryCsv.Export(plan), "text/csv; charset=utf-8", "inventory.csv");
    }
}
