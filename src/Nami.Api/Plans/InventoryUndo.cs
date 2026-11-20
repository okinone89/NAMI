namespace Nami.Api.Plans;

/// <summary>Whether the most recent import can still be undone and why.</summary>
internal sealed record InventoryUndoStatus(string ImportId, bool CanUndo, string? Reason);

/// <summary>The import the editor intends to undo.</summary>
internal sealed record InventoryUndoRequest(string? ImportId);

internal sealed record InventoryUndoReceipt(
    string ImportId,
    IReadOnlyList<InventoryRecordUndo<PlanInterface>> Interfaces,
    IReadOnlyDictionary<string, string> AddedComponents,
    IReadOnlyList<AddressConflictApproval> PreviousConflicts,
    IReadOnlyList<InventoryRecordUndo<PlanLink>>? Links = null)
{
    public static InventoryUndoReceipt Create(Plan before, Plan after)
    {
        var existingComponents = before.Components.Select(component => component.Id).ToHashSet();
        var addedComponents = after.Components.Where(component => !existingComponents.Contains(component.Id))
            .ToDictionary(component => component.Id, InventoryPreview.Hash);
        var interfaces = InventoryRecordUndo<PlanInterface>.Capture(before.Interfaces, after.Interfaces, port => port.Id);
        var links = InventoryRecordUndo<PlanLink>.Capture(before.Links, after.Links, link => link.Id);
        var affected = interfaces.Select(port => port.Id).ToHashSet();
        var previousConflicts = ConflictApprovals(before)
            .Where(conflict => conflict.InterfaceIds.Any(affected.Contains)).ToArray();
        return new(Guid.NewGuid().ToString(), interfaces, addedComponents, previousConflicts, links);
    }

    public InventoryUndoReview Review(Plan current)
    {
        var linkChanges = Links ?? [];
        var components = current.Components.ToDictionary(component => component.Id);
        if (InventoryRecordUndo<PlanInterface>.IsStale(Interfaces, current.Interfaces, port => port.Id) ||
            AddedComponents.Any(change => !components.TryGetValue(change.Key, out var component) ||
                InventoryPreview.Hash(component) != change.Value))
        {
            return Unavailable("An affected interface or component changed after import.");
        }

        if (InventoryRecordUndo<PlanLink>.IsStale(linkChanges, current.Links, link => link.Id))
            return Unavailable("An affected link changed after import.");
        var restoredLinks = InventoryRecordUndo<PlanLink>.Restore(linkChanges, current.Links, link => link.Id);

        var ports = current.Interfaces.ToDictionary(port => port.Id);
        bool CanRestore(LinkEndpoint end) => components.ContainsKey(end.ComponentId) &&
            (end.InterfaceId is null || (ports.TryGetValue(end.InterfaceId, out var port) && port.ComponentId == end.ComponentId));
        if (linkChanges.Any(change => change.Before is { } link && (!CanRestore(link.Source) || !CanRestore(link.Target))))
            return Unavailable("An endpoint used before this import has been removed.");

        var removedPorts = Interfaces.Where(change => change.Before is null).Select(change => change.Id).ToHashSet();
        bool ReferencesAddition(LinkEndpoint end) => AddedComponents.ContainsKey(end.ComponentId) ||
            (end.InterfaceId is { } portId && removedPorts.Contains(portId));
        if (restoredLinks.Any(link => ReferencesAddition(link.Source) || ReferencesAddition(link.Target)) ||
            current.Components.Any(component => component.HostId is { } host && AddedComponents.ContainsKey(host)) ||
            current.Interfaces.Any(port => AddedComponents.ContainsKey(port.ComponentId) && !removedPorts.Contains(port.Id)))
        {
            return Unavailable("A later change references an imported interface or component.");
        }

        var restore = Interfaces.Where(change => change.Before is not null)
            .ToDictionary(change => change.Id, change => change.Before!);
        var networks = current.Networks.Select(network => network.Id).ToHashSet();
        if (restore.Values.Any(port => port.NetworkId is { } networkId && !networks.Contains(networkId)))
            return Unavailable("A network used before this import has been removed.");

        var proposed = current with
        {
            Links = restoredLinks,
            Components = current.Components.Where(component => !AddedComponents.ContainsKey(component.Id)).ToArray(),
            Interfaces = current.Interfaces.Where(port => !removedPorts.Contains(port.Id))
                .Select(port => restore.GetValueOrDefault(port.Id, port)).ToArray()
        };
        var approvals = ConflictApprovals(proposed).Where(conflict =>
            PreviousConflicts.Any(previous => previous.NetworkId == conflict.NetworkId &&
                previous.Ipv4 == conflict.Ipv4 &&
                !conflict.InterfaceIds.Except(previous.InterfaceIds).Any())).ToArray();
        if (AddressValidation.BlockingIssues(current, proposed, approvals).Count > 0)
            return Unavailable("Restoring the previous values would conflict with current IPv4 settings.");

        return new(new(ImportId, true, null), proposed, approvals);
    }

    private InventoryUndoReview Unavailable(string reason) => new(new(ImportId, false, reason), null, []);

    private static IEnumerable<AddressConflictApproval> ConflictApprovals(Plan plan) =>
        AddressValidation.Inspect(plan).Where(issue => issue.Code == AddressIssueCode.DuplicateIpv4)
            .Select(issue => new AddressConflictApproval(issue.NetworkId!, issue.Ipv4!,
                issue.Interfaces.Select(port => port.InterfaceId).ToArray()));
}

internal sealed record InventoryRecordUndo<T>(string Id, string? AfterHash, T? Before, int? BeforeIndex = null) where T : class
{
    public static InventoryRecordUndo<T>[] Capture(IReadOnlyList<T> before, IReadOnlyList<T> after, Func<T, string> id)
    {
        var previous = before.ToDictionary(id);
        var remaining = after.Select(id).ToHashSet();
        return after.Where(item => !Equals(item, previous.GetValueOrDefault(id(item))))
            .Select(item => new InventoryRecordUndo<T>(id(item), InventoryPreview.Hash(item), previous.GetValueOrDefault(id(item))))
            .Concat(before.Select((record, index) => new InventoryRecordUndo<T>(id(record), null, record, index))
                .Where(change => !remaining.Contains(change.Id))).ToArray();
    }

    public static bool IsStale(IReadOnlyList<InventoryRecordUndo<T>> changes, IReadOnlyList<T> current, Func<T, string> id)
    {
        var records = current.ToDictionary(id);
        return changes.Any(change => records.TryGetValue(change.Id, out var record)
            ? change.AfterHash != InventoryPreview.Hash(record) : change.AfterHash is not null);
    }

    public static T[] Restore(IReadOnlyList<InventoryRecordUndo<T>> changes, IReadOnlyList<T> current, Func<T, string> id)
    {
        var affected = changes.ToDictionary(change => change.Id);
        var restored = current.Select(item => affected.TryGetValue(id(item), out var change) ? change.Before : item)
            .OfType<T>().ToList();
        foreach (var deletion in changes.Where(change => change.AfterHash is null).OrderBy(change => change.BeforeIndex))
            restored.Insert(Math.Min(deletion.BeforeIndex ?? restored.Count, restored.Count), deletion.Before!);
        return restored.ToArray();
    }
}

internal sealed record InventoryUndoReview(
    InventoryUndoStatus Status, Plan? Proposed, IReadOnlyList<AddressConflictApproval> Approvals);
