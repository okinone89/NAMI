namespace Nami.Api.Plans;

internal static partial class InventoryPreview
{
    private static string? ResolveNetwork(Candidate candidate, PlanIndex index, InventoryDecisions decisions,
        string? existingId)
    {
        var row = candidate.Input;
        if (row.Clear?.Contains("network") == true)
            return null;
        var name = NonBlank(row.NetworkName);
        if (NonBlank(row.NetworkId) is { } requestedId)
        {
            if (!index.StoredNetworks.TryGetValue(requestedId, out var network))
                candidate.Fail("unknownNetworkId", "The network ID is not in this plan.");
            else if (name is not null && !Names.Equals(network.Name, name))
                candidate.Fail("inconsistentIds", "Network ID and Network identify different networks. Correct or ignore one of those columns.");
            else
                return requestedId;
            return null;
        }
        if (name is null)
            return existingId;

        var matches = index.NetworksByName[name].ToArray();
        if (matches.Length == 0)
            return index.NewNetwork(name).Id;
        if (matches.Length == 1)
            return matches[0].Id;

        var message = $"Choose which network named '{matches[0].Name.Trim()}' in plan '{index.Plan.Name}' these rows describe.";
        var id = decisions.Choose("network", index.Plan.Id, name, "Choose a network", message, row.RowNumber,
            matches.Select(network => new InventoryDecisionChoice(network.Id,
                $"{network.Name.Trim()} ({network.Subnet ?? "no subnet"}, {network.Id})")));
        if (id is null)
            candidate.Fail("ambiguousNetwork", message);
        return id;
    }

    private static Dictionary<string, PlanNetwork> BuildNetworks(Candidate[] candidates, PlanIndex index, InventoryDecisions decisions)
    {
        var networks = new Dictionary<string, PlanNetwork>(index.StoredNetworks);
        var newNetworks = index.NewNetworks.Values.ToDictionary(network => network.Id);
        foreach (var row in candidates.Where(row => !row.Input.Skip && row.Errors.Count == 0 &&
                     row.NetworkId is null && NonBlank(row.Input.NetworkSubnet) is not null))
            row.Fail("missingNetwork", "Name the network for this subnet.");

        foreach (var group in candidates.Where(row => row.Errors.Count == 0 && row.NetworkId is not null)
                     .GroupBy(row => row.NetworkId!))
        {
            var network = networks.GetValueOrDefault(group.Key) ?? newNetworks[group.Key];
            var supplied = group.Where(row => NonBlank(row.Input.NetworkSubnet) is not null)
                .OrderBy(row => row.Input.RowNumber).ToArray();
            var subnets = supplied.Select(row => NonBlank(row.Input.NetworkSubnet)).Distinct().ToArray();
            if (subnets.Length > 1)
            {
                var values = string.Join("; ", supplied.Select(row => $"row {row.Input.RowNumber}: {row.Input.NetworkSubnet!.Trim()}"));
                RequireCorrection(decisions, supplied, "conflictingSubnets", network.Id, "Review network subnet",
                    $"Rows for network '{network.Name}' specify different subnets ({values}).");
            }
            networks[network.Id] = subnets.Length == 1 ? network with { Subnet = subnets[0] } : network;
        }
        return networks;
    }

    private static HashSet<AddressIssue> ReportSubnetIssues(Candidate[] candidates, IReadOnlyList<AddressIssue> blockers,
        Dictionary<string, PlanNetwork> networks, InventoryDecisions decisions)
    {
        var reported = new HashSet<AddressIssue>();
        var subnetRows = candidates.Where(row => row.Errors.Count == 0 && NonBlank(row.Input.NetworkSubnet) is not null &&
            row.NetworkId is not null).ToLookup(row => row.NetworkId);
        foreach (var group in blockers.Where(issue => issue.NetworkId is not null && issue.Code is
                     AddressIssueCode.InvalidSubnet or AddressIssueCode.OutsideSubnet or AddressIssueCode.InvalidAllocationSettings)
                     .GroupBy(issue => issue.NetworkId!))
        {
            var supplied = subnetRows[group.Key].ToArray();
            if (supplied.Length == 0)
                continue;
            var affected = group.SelectMany(issue => issue.Interfaces).Select(port => port.InterfaceId).ToHashSet();
            var rows = supplied.Concat(candidates.Where(row => row.TargetInterfaceId is { } id && affected.Contains(id)))
                .Distinct().OrderBy(row => row.Input.RowNumber).ToArray();
            var network = networks[group.Key];
            var problems = string.Join("\n", group.Select(issue => issue.Message).Order(StringComparer.Ordinal));
            RequireCorrection(decisions, rows, "subnetAssignments", network.Id, "Review network subnet",
                $"Check the proposed subnet {network.Subnet} for {network.Name}.\n{problems}");
            reported.UnionWith(group);
        }
        return reported;
    }

    private static void RequireCorrection(InventoryDecisions decisions, IEnumerable<Candidate> rows,
        string code, string scope, string title, string message)
    {
        foreach (var row in rows)
        {
            decisions.Choose(code, scope, message, title, message, row.Input.RowNumber, []);
            row.Fail(code, message);
        }
    }

    private static InventoryValues Values(Component component, PlanInterface? port, Dictionary<string, PlanNetwork> networks)
    {
        var network = port?.NetworkId is { } id ? networks.GetValueOrDefault(id) : null;
        return new(component.Name, component.Type, port?.Name ?? "", port?.NetworkId, network?.Name, port?.Ipv4, network?.Subnet);
    }

    private static InventoryValues? NetworkValues(Candidate row, PlanNetwork? network) =>
        row.NetworkOnly && network is not null ? new("", "", "", network.Id, network.Name, null, network.Subnet) : null;
}
