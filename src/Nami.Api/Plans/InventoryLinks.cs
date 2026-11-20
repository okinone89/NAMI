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
        foreach (var row in rows)
        {
            if (row.Input.SkipConnection)
                continue;

            var partnerName = NonBlank(row.Input.LinkPartner);
            var portName = NonBlank(row.Input.PartnerPort);
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
        var moves = ResolveLinkMoves(inventory, wiring, removedIds, declarations, decisions, out var unresolved);
        var movedIds = moves.Values.Select(link => link.Id).ToHashSet();
        var usedIds = inventory.Links.Select(link => link.Id).ToHashSet();
        foreach (var (ends, group) in declarations)
        {
            if (unresolved.Contains(ends))
                continue;
            var before = wiring.Existing[ends].Where(link => !removedIds.Contains(link.Id)).ToArray();
            if (before.Length > 1)
            {
                foreach (var row in group)
                    row.Fail("ambiguousLink", "More than one existing link connects these endpoints.");
                continue;
            }
            if (before.Length == 1 && movedIds.Contains(before[0].Id))
                continue;
            var link = before.SingleOrDefault() ?? moves.GetValueOrDefault(ends);
            var media = group.Select(row => NonBlank(row.Input.ConnectionType)).OfType<string>()
                .Select(ParseMedium).Distinct().ToArray();
            var protocols = group.Select(row => NonBlank(row.Input.LinkProtocol)).OfType<string>()
                .Distinct(StringComparer.Ordinal).ToArray();
            if (media.Contains(null) || media.Length > 1 || protocols.Length > 1 || (link is null && media.Length == 0))
            {
                var message = link is null && media.Length == 0
                    ? "Supply a connection type for the new link (Wired, FO, Wireless, or Virtual)."
                    : "Use one connection type (Wired, FO, Wireless, or Virtual) and one link protocol across these declarations.";
                RequireCorrection(decisions, group, "linkMetadata", Hash(ends), "Review connection details", message, "connection");
                continue;
            }

            var medium = media.SingleOrDefault() ?? link!.Medium;
            var protocol = protocols.SingleOrDefault() ?? link?.Protocol;
            var after = link is null
                ? new PlanLink(NewLinkId(inventory.Id, ends, usedIds), ends.First, ends.Second, medium, protocol)
                : Reconnect(link, ends) with { Medium = medium, Protocol = protocol };
            preview.Add(new(link, after, group.Select(row => row.Input.RowNumber).Order().ToArray()));
        }
        return preview.Select(change => change with { Summary = wiring.Summary(change.Before, change.After) }).ToArray();
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
