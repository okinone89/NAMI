namespace Nami.Api.Plans;

internal static partial class InventoryPreview
{
    private static void ResolveRenames(Candidate[] candidates, PlanIndex index, InventoryDecisions decisions)
    {
        var addresses = index.Plan.Interfaces.Where(port => port.NetworkId is not null && Ipv4Address.TryParse(port.Ipv4, out _))
            .ToLookup(port => (port.NetworkId, port.Ipv4));
        var positions = candidates.Select((row, position) => (row.Input.RowNumber, position))
            .ToDictionary(item => item.RowNumber, item => item.position);

        foreach (var group in candidates.Where(row => row.AddsComponent && row.Errors.Count == 0)
                     .GroupBy(row => row.Component!.Id))
        {
            var rows = group.ToArray();
            var name = rows[0].Component!.Name;
            var evidence = Evidence(rows, addresses);
            var owners = evidence.Select(item => item.Port.ComponentId).Distinct().ToArray();
            if (owners.Length == 0)
                continue;
            var affected = owners.SelectMany(id => index.InterfacesByComponent[id]).ToArray();
            var id = ChooseRename("component", index.Plan.Id, name, rows, evidence, affected, index, decisions,
                owners.Select(id => (id, index.Components[id].Name)));
            if (id is null)
                continue;
            var renamed = index.Components[id] with { Name = name };
            foreach (var row in rows)
                candidates[positions[row.Input.RowNumber]] = Match(row.Input, index, decisions, renamed);
        }

        foreach (var group in candidates.Where(row => !row.AddsComponent && row.Before is null &&
                         row.After is not null && row.Errors.Count == 0).GroupBy(row => row.TargetInterfaceId))
        {
            var rows = group.ToArray();
            var component = rows[0].Component!;
            var name = rows[0].After!.Name;
            var evidence = Evidence(rows, addresses).Where(item => item.Port.ComponentId == component.Id).ToArray();
            var ports = evidence.Select(item => item.Port).DistinctBy(port => port.Id).ToArray();
            if (ports.Length == 0)
                continue;
            var id = ChooseRename("port", component.Id, name, rows, evidence, ports, index, decisions,
                ports.Select(port => (port.Id, port.Name)));
            if (id is null)
                continue;
            foreach (var row in rows)
            {
                var matched = Match(row.Input, index, decisions, component, index.Interfaces[id]);
                matched.After = matched.After! with { Name = name };
                candidates[positions[row.Input.RowNumber]] = matched;
            }
        }

        foreach (var group in candidates.Where(row => row.Component is not null && !row.AddsComponent && row.Errors.Count == 0)
                     .GroupBy(row => row.Component!.Id))
            CheckRenameTargets(group, "component", index.Components[group.Key].Name, row => row.Component!.Name);
        foreach (var group in candidates.Where(row => row.Before is not null && row.After is not null && row.Errors.Count == 0)
                     .GroupBy(row => row.TargetInterfaceId!))
        {
            var name = CheckRenameTargets(group, "port", index.Interfaces[group.Key].Name, row => row.After!.Name);
            if (name is not null)
                foreach (var row in group)
                    row.After = row.After! with { Name = name };
        }
    }

    private static string? CheckRenameTargets(IEnumerable<Candidate> rows, string kind, string original, Func<Candidate, string> name)
    {
        var names = rows.Select(name).Where(value => !Names.Equals(value, original)).Distinct(Names).ToArray();
        if (names.Length < 2)
            return names.SingleOrDefault();
        var message = $"Rows rename the same {kind} '{original}' to different names ({string.Join(", ", names)}). Correct or skip a row.";
        foreach (var row in rows)
            row.Fail("conflictingRenames", message);
        return null;
    }

    private sealed record RenameEvidence(Candidate Row, PlanInterface Port);

    private static RenameEvidence[] Evidence(Candidate[] rows,
        ILookup<(string? NetworkId, string? Ipv4), PlanInterface> addresses) =>
        rows.Where(row => row.After?.NetworkId is not null && NonBlank(row.Input.Ipv4) is not null &&
                row.Input.Clear?.Contains("ipv4") != true)
            .SelectMany(row => addresses[(row.After!.NetworkId, row.After.Ipv4)].Select(port => new RenameEvidence(row, port)))
            .ToArray();

    private static string? ChooseRename(string kind, string scope, string name, Candidate[] rows, RenameEvidence[] evidence,
        PlanInterface[] affected, PlanIndex index, InventoryDecisions decisions, IEnumerable<(string Id, string Name)> targets)
    {
        var choices = targets.OrderBy(item => item.Id, StringComparer.Ordinal).ToArray();
        var candidateIds = choices.Select(item => item.Id).ToHashSet();
        bool Touches(LinkEndpoint end) => kind == "component" ? candidateIds.Contains(end.ComponentId) :
            end.InterfaceId is { } portId && candidateIds.Contains(portId);
        string Endpoint(LinkEndpoint end) => index.Components[end.ComponentId].Name +
            (end.InterfaceId is { } portId ? " / " + index.Interfaces[portId].Name : "");
        var links = index.Plan.Links.Where(link => Touches(link.Source) || Touches(link.Target))
            .OrderBy(link => link.Id, StringComparer.Ordinal).ToArray();
        var ports = affected.OrderBy(port => port.Id, StringComparer.Ordinal).ToArray();
        var matches = evidence.Select(item =>
            $"Row {item.Row.Input.RowNumber}: {index.StoredNetworks[item.Port.NetworkId!].Name}, {item.Port.Ipv4} matches {index.Components[item.Port.ComponentId].Name} / {item.Port.Name}.").Distinct();
        var linkNames = links.Select(link => $"{Endpoint(link.Source)} ↔ {Endpoint(link.Target)}");
        var message = $"Does '{name}' rename an existing {kind}?\n" + string.Join("\n", matches) +
            "\nAffected ports: " + string.Join(", ", ports.Select(port => $"{index.Components[port.ComponentId].Name} / {port.Name}")) +
            "\nAffected links: " + (links.Length == 0 ? "none" : string.Join(", ", linkNames));
        var options = choices.Select(item => new InventoryDecisionChoice("rename:" + item.Id,
            choices.Length == 1 ? $"Rename existing {kind}" : $"Rename existing {kind} '{item.Name}' ({item.Id})"))
            .Append(new("separate", "Create separate")).ToArray();
        var proof = Hash(new
        {
            scope, name, message, ports, links,
            rows = rows.Select(row => new { row.Input.RowNumber, row.Input.ComponentName, row.Input.InterfaceName,
                network = row.After?.NetworkId, ipv4 = row.After?.Ipv4 })
        });
        string? answer = null;
        foreach (var row in rows)
        {
            answer = decisions.Choose("rename-" + kind, proof, name, $"Confirm {kind} rename", message,
                row.Input.RowNumber, options);
            if (answer is null)
                row.Fail("possibleRename", message);
        }
        return answer?.StartsWith("rename:", StringComparison.Ordinal) == true ? answer["rename:".Length..] : null;
    }
}
