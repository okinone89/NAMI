namespace Nami.Api.Plans;

internal static partial class InventoryPreview
{
    private static LinkEndpoint Source(Candidate row) => new(row.Component!.Id, row.TargetInterfaceId);

    private static PlanLink Reconnect(PlanLink link, EndpointPair ends)
    {
        if (EndpointPair.Of(link.Source, link.Target) == ends)
            return link;
        if (link.Source == ends.First)
            return link with { Target = ends.Second };
        if (link.Source == ends.Second)
            return link with { Target = ends.First };
        return link with { Source = link.Target == ends.First ? ends.Second : ends.First };
    }

    private static List<InventoryLinkPreview> ResolveLinkRemovals(Plan inventory, Candidate[] rows)
    {
        var byId = inventory.Links.ToDictionary(link => link.Id);
        var removals = new Dictionary<PlanLink, List<int>>();
        foreach (var row in rows)
        {
            var endpoint = Source(row);
            foreach (var id in (row.Input.RemoveLinkIds ?? []).Distinct())
            {
                if (string.IsNullOrEmpty(id) || !byId.TryGetValue(id, out var link) ||
                    (link.Source != endpoint && link.Target != endpoint))
                {
                    row.Fail("missingConnection", "The connection selected for removal no longer belongs to this row.");
                    continue;
                }
                if (!removals.TryGetValue(link, out var numbers))
                    removals.Add(link, numbers = []);
                numbers.Add(row.Input.RowNumber);
            }
        }
        return removals.Select(item => new InventoryLinkPreview(item.Key, null, item.Value.Order().ToArray())).ToList();
    }

    private sealed class InventoryWiring(Plan inventory)
    {
        private readonly Dictionary<string, Component> components = inventory.Components.ToDictionary(c => c.Id);
        private readonly Dictionary<string, PlanInterface> ports = inventory.Interfaces.ToDictionary(p => p.Id);

        public ILookup<EndpointPair, PlanLink> Existing { get; } = inventory.Links
            .ToLookup(link => EndpointPair.Of(link.Source, link.Target));
        public ILookup<LinkEndpoint, PlanLink> ByEndpoint { get; } = inventory.Links
            .SelectMany(link => new[] { link.Source, link.Target }.Distinct().Select(end => (end, link)))
            .ToLookup(item => item.end, item => item.link);

        public string Name(LinkEndpoint end) => end.InterfaceId is null
            ? components[end.ComponentId].Name : $"{components[end.ComponentId].Name} / {ports[end.InterfaceId].Name}";
        public string Connection(PlanLink link)
        {
            var label = $"{Name(link.Source)} ↔ {Name(link.Target)}";
            return Existing[EndpointPair.Of(link.Source, link.Target)].Count() > 1 ? $"{label} ({link.Id})" : label;
        }

        public string? Summary(PlanLink? before, PlanLink? after)
        {
            if (after is null)
                return $"Remove {Connection(before!)}";
            if (before is null || (before.Source == after.Source && before.Target == after.Target))
                return null;
            var stableSource = before.Source == after.Source;
            var shared = stableSource ? before.Source : before.Target;
            var oldPartner = stableSource ? before.Target : before.Source;
            var newPartner = stableSource ? after.Target : after.Source;
            return $"Move {Name(shared)} from {Name(oldPartner)} to {Name(newPartner)}";
        }
    }

    private static Dictionary<EndpointPair, PlanLink> ResolveLinkMoves(Plan inventory, InventoryWiring wiring, HashSet<string> removedIds,
        Dictionary<EndpointPair, List<Candidate>> declarations, InventoryDecisions decisions,
        out HashSet<EndpointPair> unresolved)
    {
        unresolved = [];
        var moves = new Dictionary<EndpointPair, PlanLink>();
        var assigned = new HashSet<string>();
        // A declaration protects the existing link at its own end. A claim from the
        // opposite end instead becomes evidence for the move-or-keep decision.
        bool MayMove(LinkEndpoint endpoint, PlanLink link)
        {
            if (removedIds.Contains(link.Id))
                return false;
            return !declarations.TryGetValue(EndpointPair.Of(link.Source, link.Target), out var claims) ||
                claims.All(claim => Source(claim) != endpoint);
        }
        var possibilities = declarations.Where(item => !wiring.Existing.Contains(item.Key))
            .ToDictionary(item => item.Key, item => item.Value.Select(Source).Distinct()
                .SelectMany(endpoint => wiring.ByEndpoint[endpoint].Where(link => MayMove(endpoint, link))).Distinct().ToArray());
        var demand = possibilities.Values.SelectMany(links => links).ToLookup(link => link.Id);
        foreach (var (ends, possible) in possibilities.OrderBy(item => declarations[item.Key].Min(row => row.Input.RowNumber)))
        {
            var group = declarations[ends];
            var candidates = possible.Where(link => !assigned.Contains(link.Id)).ToArray();
            if (candidates.Length == 0)
                continue;
            var claims = candidates.SelectMany(link =>
                declarations.GetValueOrDefault(EndpointPair.Of(link.Source, link.Target)) ?? []).ToArray();
            if (candidates.Length == 1 && claims.Length == 0 && demand[candidates[0].Id].Count() == 1)
            {
                moves.Add(ends, candidates[0]);
                assigned.Add(candidates[0].Id);
                continue;
            }
            var rows = group.Concat(claims).Select(row => row.Input.RowNumber).Distinct().Order().ToArray();
            var target = $"{wiring.Name(ends.First)} ↔ {wiring.Name(ends.Second)}";
            var choices = candidates.Select(link => new InventoryDecisionChoice("move:" + link.Id,
                $"Move {wiring.Connection(link)} to {target}")).Append(
                new("add", candidates.Length == 1 && claims.Length > 0 ? "Keep both connections" : $"Add {target}"))
                .ToArray();
            string? answer = null;
            var scope = Hash(new { inventory.Id, ends, rows });
            foreach (var number in rows)
                answer = decisions.Choose("wiring", scope, target, "Choose a connection",
                    $"Review the existing wiring for {target}.", number, choices);
            var moved = candidates.SingleOrDefault(link => "move:" + link.Id == answer);
            if (answer is null)
                unresolved.Add(ends);
            else if (moved is not null)
            {
                moves.Add(ends, moved);
                assigned.Add(moved.Id);
            }
        }
        return moves;
    }
}
