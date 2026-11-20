using System.Security.Cryptography;
using System.Text.Json;

namespace Nami.Api.Plans;

/// <summary>Mapped spreadsheet rows and exact IPv4 conflicts approved by the editor.</summary>
internal sealed record InventoryPreviewRequest(
    IReadOnlyList<InventoryImportRow>? Rows,
    IReadOnlyList<AddressConflictApproval>? KeepAddressConflicts = null,
    IReadOnlyDictionary<string, string>? Answers = null);

/// <summary>One component or interface inventory row. Absent fields preserve existing values unless named in Clear.</summary>
internal sealed record InventoryImportRow(
    int RowNumber,
    string? ComponentId = null,
    string? InterfaceId = null,
    string? ComponentName = null,
    string? InterfaceName = null,
    string? ComponentType = null,
    string? NetworkId = null,
    string? NetworkName = null,
    string? Ipv4 = null,
    IReadOnlyList<string>? Clear = null,
    bool Skip = false,
    string? NetworkSubnet = null,
    string? LinkPartner = null,
    string? PartnerPort = null,
    string? ConnectionType = null,
    string? LinkProtocol = null,
    IReadOnlyList<string>? RemoveLinkIds = null);

/// <summary>The stored or proposed inventory values for an interface.</summary>
internal sealed record InventoryValues(
    string ComponentName,
    string ComponentType,
    string InterfaceName,
    string? NetworkId,
    string? NetworkName,
    string? Ipv4,
    string? NetworkSubnet = null);

/// <summary>A problem with matching or mapping an inventory row.</summary>
internal sealed record InventoryRowError(string Code, string Message);

/// <summary>The stable target, proposed changes, and validation for a source row.</summary>
internal sealed record InventoryPreviewRow(
    int RowNumber,
    string Match,
    string? ComponentId,
    string? InterfaceId,
    InventoryValues? Before,
    InventoryValues? After,
    IReadOnlyList<string> Clear,
    bool AddsComponent,
    bool HasChanges,
    bool CanApply,
    IReadOnlyList<InventoryRowError> Errors,
    IReadOnlyList<AddressIssue> AddressIssues,
    IReadOnlyList<AddressIssue> BlockingAddressIssues,
    IReadOnlyList<InventoryConnection> Connections);

/// <summary>The import preview and a token for detecting changes to the affected records.</summary>
internal sealed record InventoryPreviewResponse(
    IReadOnlyList<InventoryPreviewRow> Rows,
    string StateToken,
    bool CanApply,
    IReadOnlyList<InventoryDecision> Decisions,
    IReadOnlyList<InventoryLinkPreview> Links);

internal sealed record InventoryPreviewResult(InventoryPreviewResponse Response, Plan Proposed);

internal static partial class InventoryPreview
{
    private static readonly IEqualityComparer<string> Names = InventoryNames.Comparer;

    public static bool IsValid(InventoryPreviewRequest request) =>
        request.Rows is { } rows &&
        rows.All(row => row is not null && row.RowNumber > 0) &&
        rows.Select(row => row.RowNumber).Distinct().Count() == rows.Count;

    public static InventoryPreviewResult Build(Plan current, InventoryPreviewRequest request)
    {
        var index = new PlanIndex(current);
        var decisions = new InventoryDecisions(request.Answers);
        var candidates = request.Rows!.Select(row => Match(row, index, decisions)).ToArray();
        ResolveRenames(candidates, index, decisions);
        ResolveRepeatedInterfaces(candidates, index, decisions);
        ResolveNewComponents(candidates);

        var networks = BuildNetworks(candidates, index, decisions);
        var edits = candidates.Where(row => row.Component is not null && row.Errors.Count == 0).ToArray();
        var changes = edits.Where(row => row.Before != row.After).DistinctBy(row => row.TargetInterfaceId).ToArray();
        var byInterface = changes.ToDictionary(row => row.After!.Id, row => row.After!);
        var renamed = edits.Where(row => !row.AddsComponent && row.Component != index.Components[row.Component!.Id])
            .Select(row => row.Component!).DistinctBy(component => component.Id).ToDictionary(component => component.Id);
        var proposed = current with
        {
            Networks = networks.Values.ToArray(),
            Components = current.Components.Select(component => renamed.GetValueOrDefault(component.Id, component))
                .Concat(edits.Where(row => row.AddsComponent)
                .Select(row => row.Component!).DistinctBy(component => component.Id)).ToArray(),
            Interfaces = current.Interfaces.Select(port => byInterface.GetValueOrDefault(port.Id, port))
                .Concat(changes.Where(row => row.Before is null).Select(row => row.After!)).ToArray()
        };

        var wiring = new InventoryWiring(proposed);
        var pendingIdentity = candidates.Any(row => row.Errors.Any(error => error.Code is "possibleRename" or "conflictingRenames"));
        var linkPreview = pendingIdentity ? [] : ResolveLinks(proposed, edits, index, decisions, wiring);
        var linkChanges = linkPreview.Where(link => link.Before != link.After).ToArray();
        var linksById = linkChanges.Where(change => change.Before is not null)
            .ToDictionary(change => change.Before!.Id, change => change.After);
        proposed = proposed with
        {
            Links = proposed.Links.Select(link => linksById.GetValueOrDefault(link.Id, link)).OfType<PlanLink>()
                .Concat(linkChanges.Where(link => link.Before is null).Select(link => link.After!)).ToArray()
        };
        var changedLinkRows = linkChanges.SelectMany(link => link.RowNumbers).ToHashSet();
        var addressIssues = ByInterface(AddressValidation.Inspect(proposed));
        var blockers = AddressValidation.BlockingIssues(current, proposed, request.KeepAddressConflicts);
        var subnetIssues = ReportSubnetIssues(candidates, blockers, networks, decisions);
        var blockingIssues = ByInterface(blockers.Except(subnetIssues));
        var previewRows = candidates.Select(row =>
        {
            var componentOnly = row.Component is not null && row.TargetInterfaceId is null && row.Errors.Count == 0;
            var networkId = row.NetworkId;
            var networkBefore = networkId is null ? null : index.StoredNetworks.GetValueOrDefault(networkId);
            var networkAfter = networkId is null ? null : networks.GetValueOrDefault(networkId);
            var hasChanges = changedLinkRows.Contains(row.Input.RowNumber) || row.AddsComponent ||
                (row.Component is not null && renamed.ContainsKey(row.Component.Id)) ||
                (row.After is not null && row.Before != row.After) ||
                (networkAfter is not null && networkBefore != networkAfter);
            var visible = row.TargetInterfaceId is not null && row.Errors.Count == 0;
            var issues = visible ? addressIssues[row.TargetInterfaceId!].ToArray() : [];
            var blocking = visible ? blockingIssues[row.TargetInterfaceId!].ToArray() : [];
            return new InventoryPreviewRow(
                row.Input.RowNumber, row.Match, row.Component?.Id, row.TargetInterfaceId,
                row.Before is not null || (componentOnly && !row.AddsComponent) ? Values(index.Components[row.Component!.Id], row.Before, index.StoredNetworks) : NetworkValues(row, networkBefore),
                row.After is not null || componentOnly ? Values(renamed.GetValueOrDefault(row.Component!.Id, row.Component), row.After, networks) : NetworkValues(row, networkAfter),
                row.Input.Clear ?? [], row.AddsComponent, hasChanges,
                hasChanges && row.Errors.Count == 0 && blocking.Length == 0, row.Errors, issues, blocking,
                row.Component is null ? [] : wiring.ByEndpoint[Source(row)]
                    .Select(link => new InventoryConnection(link.Id, wiring.Connection(link))).ToArray());
        }).ToArray();

        var changedNetworks = networks.Values.Where(network => network != index.StoredNetworks.GetValueOrDefault(network.Id))
            .Select(network => network.Id).ToHashSet();
        var stateToken = Hash(new
        {
            current.Id,
            Rows = previewRows,
            Links = linkPreview,
            Decisions = decisions.Pending,
            NetworkRecords = current.Networks.Where(network => changedNetworks.Contains(network.Id)),
            NetworkMembers = current.Interfaces.Where(port => port.NetworkId is { } id && changedNetworks.Contains(id)),

            Records = candidates.Where(row => !row.Input.Skip).Select(row => new
            {
                row.Before,
                SubnetBefore = row.Before?.NetworkId is { } beforeId ? index.StoredNetworks[beforeId].Subnet : null,
                SubnetAfter = row.After?.NetworkId is { } afterId ? index.StoredNetworks.GetValueOrDefault(afterId)?.Subnet : null,
            })
        });
        var canApply = decisions.Pending.Count == 0 && blockers.Count == 0 &&
            previewRows.Any(row => row.CanApply) && previewRows.All(row => row.Errors.Count == 0);
        return new(new(previewRows, stateToken, canApply, decisions.Pending, linkPreview), proposed);
    }

    private static void ResolveRepeatedInterfaces(IEnumerable<Candidate> candidates, PlanIndex index, InventoryDecisions decisions)
    {
        foreach (var group in candidates.Where(row => row.After is not null && row.Errors.Count == 0)
            .GroupBy(row => row.TargetInterfaceId))
        {
            if (group.Count() < 2)
                continue;

            var networkRows = group.Where(row => NonBlank(row.Input.NetworkName) is not null ||
                NonBlank(row.Input.NetworkId) is not null || row.Input.Clear?.Contains("network") == true).ToArray();
            var addressRows = group.Where(row => NonBlank(row.Input.Ipv4) is not null ||
                row.Input.Clear?.Contains("ipv4") == true).ToArray();
            var networks = networkRows.Select(row => row.After!.NetworkId).Distinct().ToArray();
            var addresses = addressRows.Select(row => row.After!.Ipv4).Distinct().ToArray();
            var first = group.First();
            if (networks.Length > 1 || addresses.Length > 1)
            {
                var conflicts = new Dictionary<Candidate, List<string>>();
                void Describe(Candidate row, string value)
                {
                    if (!conflicts.TryGetValue(row, out var values))
                        conflicts[row] = values = [];
                    values.Add(value);
                }
                if (networks.Length > 1)
                    foreach (var row in networkRows)
                    {
                        var name = NonBlank(row.Input.NetworkName) ??
                            (row.After!.NetworkId is { } id ? index.StoredNetworks[id].Name : "clear membership");
                        Describe(row, $"network {name}");
                    }
                if (addresses.Length > 1)
                    foreach (var row in addressRows)
                        Describe(row, $"IPv4 {row.After!.Ipv4 ?? "clear address"}");
                var affected = conflicts.Keys.OrderBy(row => row.Input.RowNumber).ToArray();
                var evidence = string.Join("; ", affected.Select(row => $"row {row.Input.RowNumber}: {string.Join(", ", conflicts[row])}"));
                RequireCorrection(decisions, affected, "repeatedTarget", first.TargetInterfaceId!, "Review interface values",
                    $"Rows for {first.Component!.Name} / {first.After!.Name} specify conflicting values ({evidence}).");
                continue;
            }

            var port = first.After!;
            var merged = port with
            {
                NetworkId = networks.Length == 0 ? port.NetworkId : networks[0],
                Ipv4 = addresses.Length == 0 ? port.Ipv4 : addresses[0]
            };
            foreach (var row in group)
                row.After = merged;
        }
    }

    private static void ResolveNewComponents(IEnumerable<Candidate> candidates)
    {
        var groups = candidates.Where(row => row.AddsComponent && row.Errors.Count == 0)
            .GroupBy(row => row.Component!.Id);
        foreach (var group in groups)
        {
            var types = group.Select(row => NonBlank(row.Input.ComponentType)).OfType<string>()
                .Distinct(Names).Take(2).ToArray();
            if (types.Length > 1)
            {
                foreach (var row in group)
                    row.Errors.Add(new("inconsistentComponentType", "Rows adding this component specify different types."));
                continue;
            }
            var component = group.First().Component! with { Type = types.SingleOrDefault() ?? "Other" };
            foreach (var row in group)
                row.Component = component;
        }
    }

    private static ILookup<string, AddressIssue> ByInterface(IEnumerable<AddressIssue> issues) =>
        issues.SelectMany(issue => issue.Interfaces.Select(port => (port.InterfaceId, Issue: issue)))
            .ToLookup(item => item.InterfaceId, item => item.Issue);

    private static Candidate Match(InventoryImportRow row, PlanIndex index, InventoryDecisions decisions,
        Component? confirmedComponent = null, PlanInterface? confirmedPort = null)
    {
        var candidate = new Candidate(row);
        if (row.Skip)
        {
            candidate.Match = "skipped";
            return candidate;
        }

        var componentId = NonBlank(row.ComponentId);
        var interfaceId = NonBlank(row.InterfaceId);
        var componentName = NonBlank(row.ComponentName);
        var interfaceName = NonBlank(row.InterfaceName);
        if (componentId is null && interfaceId is null && componentName is null && interfaceName is null &&
            NonBlank(row.ComponentType) is null && NonBlank(row.Ipv4) is null && row.Clear is not { Count: > 0 } &&
            (NonBlank(row.NetworkName) is not null || NonBlank(row.NetworkId) is not null))
        {
            if (NonBlank(row.LinkPartner) is not null || NonBlank(row.PartnerPort) is not null ||
                NonBlank(row.ConnectionType) is not null || NonBlank(row.LinkProtocol) is not null)
                return candidate.Fail("missingName", "Provide the component name for this link.");
            candidate.NetworkOnly = true;
            candidate.StandaloneNetworkId = ResolveNetwork(candidate, index, decisions, null);
            if (candidate.NetworkId is { } matched)
                candidate.Match = index.StoredNetworks.ContainsKey(matched) ? "name" : "addition";
            return candidate;
        }
        var component = confirmedComponent ?? (componentId is null ? null : index.Components.GetValueOrDefault(componentId));
        if (componentId is not null && component is null)
            return candidate.Fail("unknownComponentId", "The component ID is not in this plan.");

        PlanInterface? port = null;
        if (interfaceId is not null)
        {
            port = index.Interfaces.GetValueOrDefault(interfaceId);
            if (port is null)
                return candidate.Fail("unknownInterfaceId", "The interface ID is not in this plan.");
            if (componentId is not null && port.ComponentId != componentId)
                return candidate.Fail("inconsistentIds", "The interface ID belongs to a different component.");
            component = index.Components[port.ComponentId];
        }
        else
        {
            if (component is null && componentName is null)
                return candidate.Fail("missingName", "Provide the component name.");

            if (component is null)
            {
                var matches = index.ComponentsByName[componentName!].ToArray();
                if (matches.Length > 1)
                {
                    component = ChooseComponent(matches, index, candidate, decisions);
                    if (component is null)
                        return candidate;
                }
                else
                    component = matches.SingleOrDefault();
            }
            if (component is not null && interfaceName is not null)
            {
                var matches = index.InterfacesByComponent[component.Id]
                    .Where(item => Names.Equals(item.Name, interfaceName)).ToArray();
                if (matches.Length > 1)
                {
                    port = ChooseInterface(matches, component, index, candidate, decisions);
                    if (port is null)
                        return candidate;
                }
                else
                    port = matches.SingleOrDefault();
            }
        }

        port = confirmedPort ?? port;
        candidate.AddsComponent = component is null;
        component ??= index.NewComponent(componentName!);
        candidate.Component = component;
        if (interfaceName is null && port is null)
        {
            if (NonBlank(row.NetworkName) is not null || NonBlank(row.NetworkId) is not null ||
                NonBlank(row.Ipv4) is not null || NonBlank(row.NetworkSubnet) is not null || row.Clear is { Count: > 0 })
                return candidate.Fail("missingInterface", "Provide the interface name to assign a network or IPv4 address.");
            candidate.Match = candidate.AddsComponent ? "addition" : "name";
            return candidate;
        }
        candidate.Match = port is null ? "addition" : componentId is not null || interfaceId is not null ? "id" : "name";
        candidate.Before = port;
        candidate.TargetInterfaceId = port?.Id ?? index.NewInterfaceId(component.Id, interfaceName!);

        var clear = row.Clear ?? [];
        if (clear.Any(field => field is not ("network" or "ipv4")))
            return candidate.Fail("unknownClearField", "Only network membership and IPv4 can be cleared.");

        var networkId = ResolveNetwork(candidate, index, decisions, port?.NetworkId);
        if (candidate.Errors.Count > 0)
            return candidate;

        var ipv4 = clear.Contains("ipv4") ? null : NonBlank(row.Ipv4) ?? port?.Ipv4;
        candidate.After = port is { } existing
            ? existing with { NetworkId = networkId, Ipv4 = ipv4 }
            : new PlanInterface(candidate.TargetInterfaceId, component.Id,
                interfaceName!, networkId, ipv4);
        return candidate;
    }

    private static Component? ChooseComponent(Component[] matches, PlanIndex index, Candidate row, InventoryDecisions decisions)
    {
        var name = matches[0].Name.Trim();
        var message = $"Choose which component named '{name}' in plan '{index.Plan.Name}' these rows describe.";
        var choices = matches.Select(item => index.Components.GetValueOrDefault(item.Id, item))
            .Select(item => new InventoryDecisionChoice(item.Id, $"{item.Name.Trim()} ({item.Type}, {item.Id})"));
        var id = decisions.Choose("component", index.Plan.Id, name, "Choose a component", message, row.Input.RowNumber, choices);
        if (id is null)
            row.Fail("ambiguousMatch", message);
        return matches.SingleOrDefault(item => item.Id == id);
    }

    private static PlanInterface? ChooseInterface(PlanInterface[] matches, Component owner, PlanIndex index,
        Candidate row, InventoryDecisions decisions)
    {
        var name = matches[0].Name.Trim();
        var message = $"Choose which interface named '{name}' on component '{owner.Name.Trim()}' these rows describe.";
        var choices = matches.Select(item => index.Interfaces.GetValueOrDefault(item.Id, item))
            .Select(item => new InventoryDecisionChoice(item.Id, $"{item.Name.Trim()} ({item.Ipv4 ?? "no IPv4"}, {item.Id})"));
        var id = decisions.Choose("interface", owner.Id, name, "Choose an interface", message, row.Input.RowNumber, choices);
        if (id is null)
            row.Fail("ambiguousMatch", message);
        return matches.SingleOrDefault(item => item.Id == id);
    }

    private static string? NonBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    internal static string Hash<T>(T data) =>
        Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(data)));

    private sealed class Candidate(InventoryImportRow input)
    {
        public InventoryImportRow Input { get; } = input;
        public string Match { get; set; } = "unresolved";
        public Component? Component { get; set; }
        public PlanInterface? Before { get; set; }
        public PlanInterface? After { get; set; }
        public bool NetworkOnly { get; set; }
        public string? StandaloneNetworkId { get; set; }
        public string? NetworkId => StandaloneNetworkId ?? After?.NetworkId;
        public string? TargetInterfaceId { get; set; }
        public bool AddsComponent { get; set; }
        public List<InventoryRowError> Errors { get; } = [];

        public Candidate Fail(string code, string message)
        {
            Errors.Add(new(code, message));
            return this;
        }
    }

    private sealed class PlanIndex(Plan plan)
    {
        public Plan Plan => plan;
        public Dictionary<string, Component> Components { get; } = plan.Components.ToDictionary(component => component.Id);
        public Dictionary<string, PlanInterface> Interfaces { get; } = plan.Interfaces.ToDictionary(port => port.Id);
        public Dictionary<string, PlanNetwork> StoredNetworks { get; } = plan.Networks.ToDictionary(network => network.Id);
        public ILookup<string, Component> ComponentsByName { get; } = plan.Components.ToLookup(component => component.Name, Names);
        public ILookup<string, PlanInterface> InterfacesByComponent { get; } = plan.Interfaces.ToLookup(port => port.ComponentId);
        public ILookup<string, PlanNetwork> NetworksByName { get; } = plan.Networks.ToLookup(network => network.Name, Names);

        public Dictionary<string, PlanNetwork> NewNetworks { get; } = new(Names);

        public PlanNetwork NewNetwork(string name)
        {
            if (!NewNetworks.TryGetValue(name, out var network))
            {
                network = new(AvailableId("network", "", name.ToUpperInvariant(), StoredNetworks.ContainsKey), name);
                NewNetworks.Add(name, network);
            }
            return network;
        }

        public Component NewComponent(string name) =>
            new(AvailableId("component", name.ToUpperInvariant(), "", Components.ContainsKey), name, "Other");

        public string NewInterfaceId(string componentId, string name) =>
            AvailableId("interface", componentId, name.ToUpperInvariant(), Interfaces.ContainsKey);

        private string AvailableId(string kind, string parent, string name, Func<string, bool> exists)
        {
            for (var attempt = 0; ; attempt++)
            {
                var id = Hash(new { plan.Id, kind, parent, name, attempt })[..32];
                if (!exists(id))
                    return id;
            }
        }
    }
}
