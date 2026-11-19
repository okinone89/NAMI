namespace Nami.Api.Plans;

public static class AddressIssueCode
{
    public const string InvalidSubnet = "invalidSubnet";
    public const string InvalidIpv4 = "invalidIpv4";
    public const string OutsideSubnet = "outsideSubnet";
    public const string DuplicateIpv4 = "duplicateIpv4";
}

/// <summary>An interface involved in an IPv4 problem, with stable identities and display names.</summary>
public sealed record AddressInterface(string InterfaceId, string InterfaceName, string ComponentId, string ComponentName);

/// <summary>A problem found in the plan's IPv4 assignments or network subnets.</summary>
public sealed record AddressIssue(
    string Code,
    string Message,
    string? NetworkId,
    string? NetworkName,
    string? Ipv4,
    IReadOnlyList<AddressInterface> Interfaces);

/// <summary>Explicit confirmation of the interfaces sharing one address on one network.</summary>
public sealed record AddressConflictApproval(string NetworkId, string Ipv4, IReadOnlyList<string> InterfaceIds);

public static class AddressValidation
{
    public static IReadOnlyList<AddressIssue> Inspect(Plan plan)
    {
        var issues = new List<AddressIssue>();
        var components = plan.Components.ToDictionary(component => component.Id);
        var networks = plan.Networks.ToDictionary(network => network.Id);
        var subnets = new Dictionary<string, Ipv4Subnet>();
        var assignments = new Dictionary<(string NetworkId, string Ipv4), List<AddressInterface>>();

        foreach (var network in plan.Networks)
        {
            if (network.Subnet is null)
                continue;
            if (Ipv4Subnet.TryParse(network.Subnet, out var subnet))
                subnets.Add(network.Id, subnet);
            else
                issues.Add(new(AddressIssueCode.InvalidSubnet,
                    $"Enter a valid IPv4 subnet in CIDR notation for {network.Name} (for example, 192.168.1.0/24).",
                    network.Id, network.Name, null, []));
        }

        foreach (var port in plan.Interfaces)
        {
            if (port.Ipv4 is null)
                continue;
            var network = port.NetworkId is { } networkId ? networks.GetValueOrDefault(networkId) : null;
            var location = new AddressInterface(port.Id, port.Name, port.ComponentId, components[port.ComponentId].Name);
            var label = $"{location.ComponentName} / {location.InterfaceName}";
            if (!Ipv4Address.TryParse(port.Ipv4, out var address))
            {
                issues.Add(new(AddressIssueCode.InvalidIpv4, $"Enter a valid IPv4 address for {label}.",
                    port.NetworkId, network?.Name, port.Ipv4, [location]));
                continue;
            }
            if (network is null)
                continue;
            if (subnets.TryGetValue(network.Id, out var subnet) && !subnet.Contains(address))
                issues.Add(new(AddressIssueCode.OutsideSubnet,
                    $"{port.Ipv4} on {label} is outside {network.Name}'s subnet ({network.Subnet}).",
                    network.Id, network.Name, port.Ipv4, [location]));

            var key = (network.Id, port.Ipv4);
            if (!assignments.TryGetValue(key, out var assigned))
                assignments[key] = assigned = [];
            assigned.Add(location);
        }

        foreach (var ((networkId, ipv4), ports) in assignments)
        {
            if (ports.Count < 2)
                continue;
            var name = networks[networkId].Name;
            issues.Add(new(AddressIssueCode.DuplicateIpv4, $"{ipv4} is already assigned to multiple interfaces on {name}.",
                networkId, name, ipv4, ports.OrderBy(port => port.InterfaceId, StringComparer.Ordinal).ToArray()));
        }
        return issues;
    }

    public static IReadOnlyList<AddressIssue> BlockingIssues(
        Plan current, Plan proposed, IReadOnlyList<AddressConflictApproval>? approvals = null)
    {
        var duplicates = Inspect(current).Where(issue => issue.Code == AddressIssueCode.DuplicateIpv4)
            .ToDictionary(issue => (issue.NetworkId, issue.Ipv4), issue => InterfaceIds(issue));
        return Inspect(proposed).Where(issue =>
        {
            if (issue.Code != AddressIssueCode.DuplicateIpv4)
                return true;
            var ids = InterfaceIds(issue);
            // Reducing a previously kept duplicate does not require another confirmation.
            if (duplicates.TryGetValue((issue.NetworkId, issue.Ipv4), out var savedIds) && ids.IsSubsetOf(savedIds))
                return false;
            return approvals?.Any(approval => approval is not null &&
                approval.NetworkId == issue.NetworkId && approval.Ipv4 == issue.Ipv4 &&
                approval.InterfaceIds?.Count == ids.Count && ids.SetEquals(approval.InterfaceIds)) != true;
        }).ToArray();
    }

    private static HashSet<string> InterfaceIds(AddressIssue issue) =>
        issue.Interfaces.Select(port => port.InterfaceId).ToHashSet(StringComparer.Ordinal);
}

public sealed class AddressValidationException(IReadOnlyList<AddressIssue> issues)
    : ArgumentException("Check the plan's IPv4 settings.")
{
    public IReadOnlyList<AddressIssue> Issues { get; } = issues;
}
