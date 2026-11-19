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
        inventory.MapPost("/inventory/commit", Commit)
            .WithSummary("Apply a confirmed inventory or bulk edit preview")
            .ProducesProblem(StatusCodes.Status401Unauthorized);
        inventory.MapGet("/inventory/undo", GetUndo)
            .WithSummary("Check if the latest import can be undone");
        inventory.MapPost("/inventory/undo", Undo)
            .WithSummary("Restore the values changed by the latest import")
            .ProducesProblem(StatusCodes.Status401Unauthorized);
    }

    private static async Task<Results<Ok<InventoryCommitResponse>, Conflict<InventoryPreviewResponse>, ProblemHttpResult>> Commit(
        string id, InventoryCommitRequest request, PlanStore store, CancellationToken cancellationToken)
    {
        var draft = new InventoryPreviewRequest(request.Rows, request.KeepAddressConflicts);
        if (!InventoryPreview.IsValid(draft) || string.IsNullOrWhiteSpace(request.StateToken) ||
            (request.BulkEdit && draft.Rows!.Any(row => !row.Skip && string.IsNullOrWhiteSpace(row.InterfaceId))))
        {
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Confirm a preview for the selected rows.");
        }

        var current = await store.GetAsync(id, cancellationToken);
        if (current is null)
            return TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Plan not found");

        var preview = InventoryPreview.Build(current, draft);
        if (preview.Response.StateToken != request.StateToken || !preview.Response.CanApply)
            return TypedResults.Conflict(preview.Response);

        var undo = request.BulkEdit ? null : InventoryUndoReceipt.Create(current, preview.Proposed);
        var approvals = draft.KeepAddressConflicts ?? [];
        var changed = undo is null
            ? await store.SaveAsync(preview.Proposed, approvals, cancellationToken)
            : await store.SaveInventoryAsync(preview.Proposed, approvals, undo, cancellationToken);
        if (changed)
        {
            var status = undo is null ? null : new InventoryUndoStatus(undo.ImportId, true, null);
            return TypedResults.Ok(new InventoryCommitResponse(
                preview.Proposed with { Revision = current.Revision + 1 }, status));
        }

        var latest = await store.GetAsync(id, cancellationToken);
        return latest is null
            ? TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Plan not found")
            : TypedResults.Conflict(InventoryPreview.Build(latest, draft).Response);
    }

    private static async Task<Results<Ok<InventoryUndoStatus>, NoContent, ProblemHttpResult>> GetUndo(
        string id, PlanStore store, CancellationToken cancellationToken)
    {
        var current = await store.GetAsync(id, cancellationToken);
        if (current is null)
            return TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Plan not found");
        return current.InventoryUndo is { } undo
            ? TypedResults.Ok(undo.Review(current).Status)
            : TypedResults.NoContent();
    }

    private static async Task<Results<Ok<Plan>, ProblemHttpResult>> Undo(
        string id, InventoryUndoRequest request, PlanStore store, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.ImportId))
            return TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Choose an import to undo.");

        var current = await store.GetAsync(id, cancellationToken);
        if (current is null)
            return TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Plan not found");
        if (current.InventoryUndo is not { } undo || undo.ImportId != request.ImportId)
            return TypedResults.Problem(statusCode: StatusCodes.Status409Conflict,
                title: "This import is no longer available to undo.");

        var review = undo.Review(current);
        if (review.Proposed is not { } proposed)
            return TypedResults.Problem(statusCode: StatusCodes.Status409Conflict, title: review.Status.Reason);
        if (!await store.SaveInventoryAsync(proposed, review.Approvals, null, cancellationToken))
            return TypedResults.Problem(statusCode: StatusCodes.Status409Conflict,
                title: "The plan changed while undo was being saved. Review the current plan before trying again.");
        return TypedResults.Ok(proposed with { Revision = current.Revision + 1 });
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

/// <summary>Confirm the selected rows and record state from an inventory preview.</summary>
internal sealed record InventoryCommitRequest(
    IReadOnlyList<InventoryImportRow>? Rows,
    IReadOnlyList<AddressConflictApproval>? KeepAddressConflicts,
    string? StateToken,
    bool BulkEdit = false);

/// <summary>The saved plan and whether this import can be undone.</summary>
internal sealed record InventoryCommitResponse(Plan Plan, InventoryUndoStatus? Undo);
