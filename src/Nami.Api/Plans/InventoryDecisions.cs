namespace Nami.Api.Plans;

/// <summary>An explicit choice needed to interpret one or more inventory rows.</summary>
internal sealed record InventoryDecision(string Id, string Title, string Message,
    IReadOnlyList<int> RowNumbers, IReadOnlyList<InventoryDecisionChoice> Choices, string? Scope = null);

/// <summary>A currently available answer to an inventory decision.</summary>
internal sealed record InventoryDecisionChoice(string Id, string Label);

internal sealed class InventoryDecisions(IReadOnlyDictionary<string, string>? answers)
{
    private readonly Dictionary<string, (InventoryDecision Decision, List<int> Rows)> pending = [];
    public IReadOnlyList<InventoryDecision> Pending => pending.Values.Select(item => item.Decision).ToArray();

    public string? Choose(string kind, string scope, string name, string title, string message, int rowNumber,
        IEnumerable<InventoryDecisionChoice> options, string? decisionScope = null)
    {
        var choices = options.OrderBy(choice => choice.Id, StringComparer.Ordinal).ToArray();
        // If the candidate set changes, the engineer must review the new choices.
        var id = kind + "-" + InventoryPreview.Hash(new { scope, name = name.Trim().ToUpperInvariant(), choices });
        if (answers?.TryGetValue(id, out var answer) == true && choices.Any(choice => choice.Id == answer))
            return answer;

        if (!pending.TryGetValue(id, out var entry))
        {
            var rows = new List<int>();
            entry = (new(id, title, message, rows, choices, decisionScope), rows);
            pending.Add(id, entry);
        }
        if (entry.Rows.Count == 0 || entry.Rows[^1] != rowNumber)
            entry.Rows.Add(rowNumber);
        return null;
    }
}
