namespace Nami.Api.Plans;

internal sealed record InventoryLinkPreview(PlanLink? Before, PlanLink? After, IReadOnlyList<int> RowNumbers, string? Summary = null);
internal sealed record InventoryConnection(string Id, string Label);

internal static partial class InventoryPreview
{
    // Cabling is undirected. Canonical ends make declarations and IDs independent of file order.
    private sealed record EndpointPair(LinkEndpoint First, LinkEndpoint Second)
    {
        public static EndpointPair Of(LinkEndpoint source, LinkEndpoint target)
        {
            var order = string.CompareOrdinal(source.ComponentId, target.ComponentId);
            if (order == 0)
                order = string.CompareOrdinal(source.InterfaceId, target.InterfaceId);
            return order <= 0 ? new(source, target) : new(target, source);
        }
    }

    private static IReadOnlyList<InventoryLinkPreview> ResolveLinks(Plan inventory, Candidate[] rows,
        PlanIndex index, InventoryDecisions decisions, InventoryWiring wiring)
    {
        var components = inventory.Components.ToLookup(component => component.Name, Names);
        var ports = inventory.Interfaces.ToLookup(port => port.ComponentId);
        var declarations = new Dictionary<EndpointPair, List<Candidate>>();
        var protectedIds = new HashSet<string>();
        foreach (var row in rows)
        {
            var partnerName = NonBlank(row.Input.LinkPartner);
            var portName = NonBlank(row.Input.PartnerPort);
            if (row.Input.SkipConnection)
            {
                var source = Source(row);
                foreach (var link in wiring.ByEndpoint[source])
                {
                    var skippedPartner = link.Source == source ? link.Target : link.Source;
                    if (wiring.Matches(skippedPartner, partnerName, portName))
                        protectedIds.Add(link.Id);
                }
                continue;
            }

            if (partnerName is null)
            {
                if (portName is not null)
                    RequirePartnerCorrection(decisions, row, "missingLinkPartner", "Supply the component name in Link partner for this port.");
                continue;
            }

            var matches = components[partnerName].ToArray();
            if (matches.Length == 0)
            {
                RequirePartnerCorrection(decisions, row, "unknownLinkPartner", "The supplied Link partner does not match a selected or existing component.");
                continue;
            }
            var owner = matches.Length == 1 ? matches[0] : ChooseComponent(matches, index, row, decisions);
            if (owner is null)
                continue;
            var partner = new LinkEndpoint(owner.Id);
            if (portName is not null)
            {
                var matchedPorts = ports[partner.ComponentId].Where(port => Names.Equals(port.Name, portName)).ToArray();
                if (matchedPorts.Length == 0)
                {
                    RequirePartnerCorrection(decisions, row, "unknownPartnerPort", "The supplied Partner port does not match an interface on the link partner.");
                    continue;
                }
                var port = matchedPorts.Length == 1 ? matchedPorts[0] : ChooseInterface(matchedPorts, owner, index, row, decisions);
                if (port is null)
                    continue;
                partner = partner with { InterfaceId = port.Id };
            }

            var pair = EndpointPair.Of(new(row.Component!.Id, row.TargetInterfaceId), partner);
            if (!declarations.TryGetValue(pair, out var group))
                declarations.Add(pair, group = []);
            group.Add(row);
        }

        var preview = ResolveLinkRemovals(inventory, rows);
        var removedIds = preview.Select(change => change.Before!.Id).ToHashSet();
        foreach (var change in preview)
        {
            var removedLink = change.Before!;
            var pair = EndpointPair.Of(removedLink.Source, removedLink.Target);
            if (wiring.Existing[pair].All(link => removedIds.Contains(link.Id)))
                declarations.Remove(pair);
        }
        protectedIds.UnionWith(removedIds);
        var moves = ResolveLinkMoves(inventory, wiring, protectedIds, declarations, decisions, out var unresolved);
        var movedIds = moves.Values.Select(link => link.Id).ToHashSet();
        var usedIds = inventory.Links.Select(link => link.Id).ToHashSet();
        foreach (var (ends, group) in declarations)
        {
            if (unresolved.Contains(ends))
                continue;
            var existing = wiring.Existing[ends].Where(link => !removedIds.Contains(link.Id)).ToArray();
            var available = existing.Where(link => !movedIds.Contains(link.Id)).OrderBy(link => link.Id, StringComparer.Ordinal).ToList();
            if (existing.Length > 0 && available.Count == 0)
                continue;
            if (moves.TryGetValue(ends, out var moved))
                available.Add(moved);
            var removed = wiring.Existing[ends].Where(link => removedIds.Contains(link.Id)).ToList();
            ResolveDeclaredCables(inventory.Id, ends, group, available, removed, usedIds, wiring, decisions, preview);
        }
        return preview.Select(change => change with { Summary = wiring.Summary(change.Before, change.After) }).ToArray();
    }

    // Balanced reciprocal rows with matching cable details preserve the multiplicity of a complete export.
    // A repeated declaration from just one end can describe the same cable more than once.
    private static List<List<Candidate>> CableDeclarations(EndpointPair ends, List<Candidate> rows)
    {
        if (rows.Count < 4 || ends.First == ends.Second)
            return [rows];

        var byDetails = rows.GroupBy(row => (Medium: ParseMedium(NonBlank(row.Input.ConnectionType) ?? ""),
            Protocol: NonBlank(row.Input.LinkProtocol))).OrderBy(group => group.Key.Medium)
            .ThenBy(group => group.Key.Protocol, StringComparer.Ordinal);
        var declarations = new List<List<Candidate>>();
        foreach (var details in byDetails)
        {
            var left = details.Where(row => Source(row) == ends.First).OrderBy(row => row.Input.RowNumber).ToArray();
            var right = details.Where(row => Source(row) == ends.Second).OrderBy(row => row.Input.RowNumber).ToArray();
            if (details.Key.Medium is null || left.Length != right.Length)
                return [rows];
            for (var i = 0; i < left.Length; i++)
                declarations.Add([left[i], right[i]]);
        }
        return declarations;
    }

    private sealed record CableDeclaration(int[] Rows, LinkMedium? Medium, string? Protocol)
    {
        public PlanLink? Unchanged(IEnumerable<PlanLink> links) => links
            .Where(link => (Medium is null || Medium == link.Medium) && (Protocol is null || Protocol == link.Protocol))
            .OrderByDescending(link => link.Protocol == Protocol).FirstOrDefault();
    }

    private static void ResolveDeclaredCables(string planId, EndpointPair ends, List<Candidate> rows,
        List<PlanLink> available, List<PlanLink> removed, HashSet<string> usedIds, InventoryWiring wiring, InventoryDecisions decisions,
        List<InventoryLinkPreview> preview)
    {
        var unmatched = new List<CableDeclaration>();
        void Preview(CableDeclaration cable, PlanLink? link)
        {
            var after = link is null
                ? new PlanLink(NewLinkId(planId, ends, usedIds), ends.First, ends.Second, cable.Medium!.Value, cable.Protocol)
                : Reconnect(link, ends) with { Medium = cable.Medium ?? link.Medium, Protocol = cable.Protocol ?? link.Protocol };
            preview.Add(new(link, after, cable.Rows));
            if (link is not null)
                available.Remove(link);
        }

        foreach (var group in CableDeclarations(ends, rows))
        {
            var media = group.Select(row => NonBlank(row.Input.ConnectionType)).OfType<string>()
                .Select(ParseMedium).Distinct().ToArray();
            var protocols = group.Select(row => NonBlank(row.Input.LinkProtocol)).OfType<string>()
                .Distinct(StringComparer.Ordinal).ToArray();
            if (media.Contains(null) || media.Length > 1 || protocols.Length > 1 || (available.Count == 0 && media.Length == 0))
            {
                var message = available.Count == 0 && media.Length == 0
                    ? "Supply a connection type for the new link (Wired, FO, Wireless, or Virtual)."
                    : "Use one connection type (Wired, FO, Wireless, or Virtual) and one link protocol across these declarations.";
                RequireCorrection(decisions, group, "linkMetadata", Hash(ends), "Review connection details", message, "connection");
                return;
            }
            var cable = new CableDeclaration(group.Select(row => row.Input.RowNumber).Order().ToArray(),
                media.SingleOrDefault(), protocols.SingleOrDefault());
            if (cable.Unchanged(available) is { } match)
                Preview(cable, match);
            else if (cable.Unchanged(removed) is { } deleted)
                removed.Remove(deleted);
            else
                unmatched.Add(cable);
        }

        for (var i = 0; i < unmatched.Count; i++)
        {
            var cable = unmatched[i];
            PlanLink? target = null;
            if (available.Count == 1 && i == unmatched.Count - 1)
                target = available[0];
            else if (available.Count > 0)
            {
                var options = available.Select(link => new InventoryDecisionChoice("update:" + link.Id,
                    $"Update {wiring.Connection(link)} ({InventoryWiring.Details(link)})")).ToList();
                if (cable.Medium.HasValue)
                    options.Add(new("add-cable", "Add a separate connection"));
                var message = $"Choose the cable for {wiring.Name(ends.First)} ↔ {wiring.Name(ends.Second)}.";
                var scope = Hash(new { planId, ends, cable, available });
                string? answer = null;
                foreach (var number in cable.Rows)
                    answer = decisions.Choose("parallelCable", scope, "", "Choose a connection", message, number, options, "connection");
                if (answer is null)
                    return;
                target = available.SingleOrDefault(link => "update:" + link.Id == answer);
            }
            Preview(cable, target);
        }
    }

    private static void RequirePartnerCorrection(InventoryDecisions decisions, Candidate row, string code, string message)
    {
        var connection = Hash(new
        {
            row.Component!.Id, row.TargetInterfaceId,
            Partner = NonBlank(row.Input.LinkPartner)?.ToUpperInvariant(),
            Port = NonBlank(row.Input.PartnerPort)?.ToUpperInvariant()
        });
        decisions.Choose(code, connection, "", "Review link partner", message, row.Input.RowNumber, [], "connection");
        row.Fail(code, message);
    }

    private static LinkMedium? ParseMedium(string value) => value.ToUpperInvariant() switch
    {
        "FO" => LinkMedium.FiberOptic,
        "WIRED" => LinkMedium.Wired,
        "WIRELESS" => LinkMedium.Wireless,
        "VIRTUAL" => LinkMedium.Virtual,
        _ => null
    };

    private static string NewLinkId(string planId, EndpointPair ends, HashSet<string> usedIds)
    {
        for (var attempt = 0; ; attempt++)
        {
            var id = Hash(new { planId, kind = "link", ends, attempt })[..32];
            if (usedIds.Add(id))
                return id;
        }
    }
}
