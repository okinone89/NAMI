namespace Nami.Api.Plans;

/// <summary>An inclusive IPv4 range. Omit the end to specify a single address.</summary>
public sealed record Ipv4Range(string Start, string? End = null);

internal readonly record struct Ipv4Interval(uint Start, uint End)
{
    public bool Contains(Ipv4Interval interval) => interval.Start >= Start && interval.End <= End;

    public static bool TryParse(Ipv4Range range, out Ipv4Interval interval)
    {
        interval = default;
        if (!Ipv4Address.TryParse(range.Start, out var start) ||
            !Ipv4Address.TryParse(range.End ?? range.Start, out var end) || end < start)
            return false;

        interval = new(start, end);
        return true;
    }
}

internal static class AddressAllocation
{
    public const string Proposed = "proposed";
    public const string Assigned = "assigned";
    public const string Exhausted = "exhausted";
    public const string Unavailable = "unavailable";

    public static Plan AssignNewAttachments(Plan current, Plan proposed)
    {
        var connected = current.Interfaces.Where(port => port.NetworkId is not null)
            .Select(port => port.Id).ToHashSet(StringComparer.Ordinal);
        var selected = proposed.Interfaces
            .Where(port => port is { NetworkId: not null, Ipv4: null } && !connected.Contains(port.Id))
            .Select(port => port.Id).ToArray();
        return selected.Length == 0 ? proposed : Apply(proposed, Preview(proposed, selected));
    }

    public static Plan Apply(Plan plan, AddressAllocationPreview preview)
    {
        var changes = preview.Assignments.Where(assignment => assignment.Status == Proposed)
            .ToDictionary(assignment => assignment.InterfaceId, assignment => assignment.Ipv4);
        return changes.Count == 0 ? plan : plan with
        {
            Interfaces = plan.Interfaces.Select(port => changes.TryGetValue(port.Id, out var ipv4)
                ? port with { Ipv4 = ipv4 }
                : port).ToArray()
        };
    }

    public static string? ReadRanges(PlanNetwork network, Ipv4Subnet subnet, out Ipv4Interval pool,
        out List<Ipv4Interval> exclusions)
    {
        // Point-to-point /31 networks and single-host /32 networks use their whole subnet.
        var usable = subnet.BroadcastAddress - subnet.NetworkAddress <= 1
            ? new Ipv4Interval(subnet.NetworkAddress, subnet.BroadcastAddress)
            : new Ipv4Interval(subnet.NetworkAddress + 1, subnet.BroadcastAddress - 1);
        pool = usable;
        exclusions = [];

        if (network.AllocationPool is { } range &&
            (!Ipv4Interval.TryParse(range, out pool) || !usable.Contains(pool)))
        {
            return $"The allocation pool for {network.Name} must be an ordered IPv4 range within usable subnet addresses.";
        }

        var subnetInterval = new Ipv4Interval(subnet.NetworkAddress, subnet.BroadcastAddress);
        foreach (var exclusion in network.ExcludedIpv4Ranges ?? [])
        {
            if (exclusion is null || !Ipv4Interval.TryParse(exclusion, out var excluded) ||
                !subnetInterval.Contains(excluded))
            {
                return $"Each excluded IPv4 address or range for {network.Name} must be within its subnet.";
            }
            exclusions.Add(excluded);
        }
        return null;
    }

    public static AddressAllocationPreview Preview(Plan plan, IReadOnlyList<string> interfaceIds)
    {
        var ports = plan.Interfaces.ToDictionary(port => port.Id);
        var networks = plan.Networks.ToDictionary(network => network.Id);
        var available = new Dictionary<string, Queue<uint>>(StringComparer.Ordinal);
        var selected = interfaceIds.Select(id => ports.GetValueOrDefault(id)).ToArray();

        foreach (var group in selected
            .OfType<PlanInterface>()
            .Where(port => port is { Ipv4: null, NetworkId: not null })
            .GroupBy(port => port.NetworkId!))
        {
            if (!networks.TryGetValue(group.Key, out var network) ||
                !Ipv4Subnet.TryParse(network.Subnet, out var subnet) ||
                ReadRanges(network, subnet, out var pool, out var blocked) is not null)
                continue;

            foreach (var port in plan.Interfaces)
                if (port.NetworkId == network.Id && Ipv4Address.TryParse(port.Ipv4, out var address))
                    blocked.Add(new(address, address));

            available.Add(network.Id, new Queue<uint>(AvailableAddresses(pool, blocked).Take(group.Count())));
        }

        var assignments = new AddressAllocationAssignment[interfaceIds.Count];
        for (var index = 0; index < interfaceIds.Count; index++)
        {
            var id = interfaceIds[index];
            var port = selected[index];
            assignments[index] = port switch
            {
                { Ipv4: not null } => new(id, port.NetworkId, port.Ipv4, Assigned),
                { NetworkId: not null } when available.TryGetValue(port.NetworkId, out var addresses) =>
                    addresses.TryDequeue(out var address)
                        ? new(id, port.NetworkId, Ipv4Address.Format(address), Proposed)
                        : new(id, port.NetworkId, null, Exhausted),
                _ => new(id, port?.NetworkId, null, Unavailable)
            };
        }

        return new(plan.Revision, assignments);
    }

    private static IEnumerable<uint> AvailableAddresses(Ipv4Interval pool, List<Ipv4Interval> blocked)
    {
        // The wider cursor can advance past 255.255.255.255 without wrapping.
        ulong next = pool.Start;
        foreach (var interval in blocked.OrderBy(range => range.Start))
        {
            while (next < interval.Start && next <= pool.End)
                yield return (uint)next++;
            next = Math.Max(next, (ulong)interval.End + 1);
            if (next > pool.End)
                yield break;
        }
        while (next <= pool.End)
            yield return (uint)next++;
    }
}

/// <summary>The saved state or proposed address of an interface in an allocation preview.</summary>
internal sealed record AddressAllocationAssignment(string InterfaceId, string? NetworkId, string? Ipv4, string Status);

/// <summary>A set of proposed assignments at a saved revision of the plan.</summary>
internal sealed record AddressAllocationPreview(long Revision, IReadOnlyList<AddressAllocationAssignment> Assignments)
{
    public bool CanApply => Assignments.Any(assignment => assignment.Status == AddressAllocation.Proposed) &&
        Assignments.All(assignment => assignment.Status is AddressAllocation.Proposed or AddressAllocation.Assigned);
}
