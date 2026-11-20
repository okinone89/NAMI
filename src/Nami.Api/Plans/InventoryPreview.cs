using System.Security.Cryptography;
using System.Text.Json;

namespace Nami.Api.Plans;

/// <summary>Mapped spreadsheet rows and exact IPv4 conflicts approved by the editor.</summary>
internal sealed record InventoryPreviewRequest(
    IReadOnlyList<InventoryImportRow>? Rows,
    IReadOnlyList<AddressConflictApproval>? KeepAddressConflicts = null,
    IReadOnlyDictionary<string, string>? Answers = null);

/// <summary>One interface row. Absent fields preserve existing values unless named in Clear.</summary>
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
    bool Skip = false);

/// <summary>The stored or proposed inventory values for an interface.</summary>
internal sealed record InventoryValues(
    string ComponentName,
    string ComponentType,
    string InterfaceName,
    string? NetworkId,
    string? NetworkName,
    string? Ipv4);

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
    IReadOnlyList<AddressIssue> BlockingAddressIssues);

/// <summary>The import preview and a token for detecting changes to the affected records.</summary>
internal sealed record InventoryPreviewResponse(
    IReadOnlyList<InventoryPreviewRow> Rows,
    string StateToken,
    bool CanApply,
    IReadOnlyList<InventoryDecision> Decisions);

internal sealed record InventoryPreviewResult(InventoryPreviewResponse Response, Plan Proposed);

internal static class InventoryPreview
{
    private static readonly IEqualityComparer<string> Names = InventoryNames.Comparer;

    public static bool IsValid(InventoryPreviewRequest request) =>
        request.Rows is { Count: > 0 } rows &&
        rows.All(row => row is not null && row.RowNumber > 0) &&
        rows.Select(row => row.RowNumber).Distinct().Count() == rows.Count;

    public static InventoryPreviewResult Build(Plan current, InventoryPreviewRequest request)
    {
        var index = new PlanIndex(current);
        var decisions = new InventoryDecisions(request.Answers);
        var candidates = request.Rows!.Select(row => Match(row, index, decisions)).ToArray();
        ResolveRepeatedInterfaces(candidates);
        ResolveNewComponents(candidates);

        var edits = candidates.Where(row => row.After is not null && row.Errors.Count == 0).ToArray();
        var changes = edits.Where(row => row.Before != row.After).DistinctBy(row => row.TargetInterfaceId).ToArray();
        var byInterface = changes.ToDictionary(row => row.After!.Id, row => row.After!);
        var proposed = current with
        {
            Components = current.Components.Concat(changes.Where(row => row.AddsComponent)
                .Select(row => row.Component!).DistinctBy(component => component.Id)).ToArray(),
            Interfaces = current.Interfaces.Select(port => byInterface.GetValueOrDefault(port.Id, port))
                .Concat(changes.Where(row => row.Before is null).Select(row => row.After!)).ToArray()
        };

        var addressIssues = ByInterface(AddressValidation.Inspect(proposed));
        var blockers = AddressValidation.BlockingIssues(current, proposed, request.KeepAddressConflicts);
        var blockingIssues = ByInterface(blockers);
        var previewRows = candidates.Select(row =>
        {
            var hasChanges = row.After is not null && row.Before != row.After;
            var visible = row.TargetInterfaceId is not null && row.Errors.Count == 0;
            var issues = visible ? addressIssues[row.TargetInterfaceId!].ToArray() : [];
            var blocking = visible ? blockingIssues[row.TargetInterfaceId!].ToArray() : [];
            return new InventoryPreviewRow(
                row.Input.RowNumber, row.Match, row.Component?.Id, row.TargetInterfaceId,
                row.Before is { } before ? index.Values(row.Component!, before) : null,
                row.After is { } after ? index.Values(row.Component!, after) : null,
                row.Input.Clear ?? [], row.AddsComponent, hasChanges,
                hasChanges && row.Errors.Count == 0 && blocking.Length == 0, row.Errors, issues, blocking);
        }).ToArray();

        var stateToken = Hash(new
        {
            current.Id,
            Rows = previewRows,
            Decisions = decisions.Pending,
            Records = candidates.Where(row => !row.Input.Skip).Select(row => new
            {
                row.Before,
                SubnetBefore = row.Before?.NetworkId is { } beforeId ? index.Networks[beforeId].Subnet : null,
                SubnetAfter = row.After?.NetworkId is { } afterId ? index.Networks[afterId].Subnet : null,
            })
        });
        var canApply = blockers.Count == 0 &&
            previewRows.Any(row => row.CanApply) && previewRows.All(row => row.Errors.Count == 0);
        return new(new(previewRows, stateToken, canApply, decisions.Pending), proposed);
    }

    private static void ResolveRepeatedInterfaces(IEnumerable<Candidate> candidates)
    {
        foreach (var group in candidates.Where(row => row.After is not null && row.Errors.Count == 0)
            .GroupBy(row => row.TargetInterfaceId))
        {
            if (group.Count() < 2)
                continue;

            var networks = group.Where(row => NonBlank(row.Input.NetworkName) is not null ||
                    NonBlank(row.Input.NetworkId) is not null || row.Input.Clear?.Contains("network") == true)
                .Select(row => row.After!.NetworkId).Distinct().ToArray();
            var addresses = group.Where(row => NonBlank(row.Input.Ipv4) is not null ||
                    row.Input.Clear?.Contains("ipv4") == true)
                .Select(row => row.After!.Ipv4).Distinct().ToArray();
            var first = group.First();
            if (networks.Length > 1 || addresses.Length > 1)
            {
                foreach (var row in group)
                    row.Errors.Add(new("repeatedTarget",
                        $"Rows for interface '{first.After!.Name}' on '{first.Component!.Name}' specify conflicting values. Correct or skip a row."));
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
        var groups = candidates.Where(row => row.AddsComponent && row.After is not null && row.Errors.Count == 0)
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

    private static Candidate Match(InventoryImportRow row, PlanIndex index, InventoryDecisions decisions)
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
        var component = componentId is null ? null : index.Components.GetValueOrDefault(componentId);
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
            if (interfaceName is null || (component is null && componentName is null))
                return candidate.Fail("missingName", "Provide the component and interface names or their stable IDs.");

            if (component is null)
            {
                var matches = index.ComponentsByName[componentName!].ToArray();
                if (matches.Length > 1)
                {
                    var message = $"Choose which component named '{matches[0].Name.Trim()}' in plan '{index.Plan.Name}' these rows describe.";
                    var id = decisions.Choose("component", index.Plan.Id, componentName!, "Choose a component",
                        message, row.RowNumber, matches.Select(item =>
                            new InventoryDecisionChoice(item.Id, $"{item.Name.Trim()} ({item.Type}, {item.Id})")));
                    if (id is null)
                        return candidate.Fail("ambiguousMatch", message);
                    component = index.Components[id];
                }
                else
                    component = matches.SingleOrDefault();
            }
            if (component is not null)
            {
                var matches = index.InterfacesByComponent[component.Id]
                    .Where(item => Names.Equals(item.Name, interfaceName)).ToArray();
                if (matches.Length > 1)
                {
                    var message = $"Choose which interface named '{matches[0].Name.Trim()}' on component '{component.Name.Trim()}' these rows describe.";
                    var id = decisions.Choose("interface", component.Id, interfaceName!, "Choose an interface",
                        message, row.RowNumber, matches.Select(item =>
                            new InventoryDecisionChoice(item.Id, $"{item.Name.Trim()} ({item.Ipv4 ?? "no IPv4"}, {item.Id})")));
                    if (id is null)
                        return candidate.Fail("ambiguousMatch", message);
                    port = index.Interfaces[id];
                }
                else
                    port = matches.SingleOrDefault();
            }
        }

        candidate.AddsComponent = component is null;
        component ??= index.NewComponent(componentName!);
        candidate.Component = component;
        candidate.Match = port is null ? "addition" : componentId is not null || interfaceId is not null ? "id" : "name";
        candidate.Before = port;
        candidate.TargetInterfaceId = port?.Id ?? index.NewInterfaceId(component.Id, interfaceName!);

        var clear = row.Clear ?? [];
        if (clear.Any(field => field is not ("network" or "ipv4")))
            return candidate.Fail("unknownClearField", "Only network membership and IPv4 can be cleared.");

        var networkId = port?.NetworkId;
        var networkName = NonBlank(row.NetworkName);
        if (clear.Contains("network"))
            networkId = null;
        else if (NonBlank(row.NetworkId) is { } requestedId)
        {
            if (!index.Networks.TryGetValue(requestedId, out var network))
                return candidate.Fail("unknownNetworkId", "The network ID is not in this plan.");
            if (networkName is not null && !Names.Equals(network.Name.Trim(), networkName))
                return candidate.Fail("inconsistentIds",
                    "Network ID and Network identify different networks. Correct or ignore one of those columns.");
            networkId = requestedId;
        }
        else if (networkName is not null)
        {
            var networks = index.NetworksByName[networkName].Take(2).ToArray();
            if (networks.Length == 0)
                return candidate.Fail("unknownNetwork", "Choose an existing network or clear network membership.");
            if (networks.Length > 1)
                return candidate.Fail("ambiguousNetwork", $"Network name '{networkName}' matches multiple networks in plan '{index.Plan.Name}'. Choose its network ID.");
            networkId = networks[0].Id;
        }

        var ipv4 = clear.Contains("ipv4") ? null : NonBlank(row.Ipv4) ?? port?.Ipv4;
        candidate.After = port is { } existing
            ? existing with { NetworkId = networkId, Ipv4 = ipv4 }
            : new PlanInterface(candidate.TargetInterfaceId, component.Id,
                interfaceName!, networkId, ipv4);
        return candidate;
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
        public Dictionary<string, PlanNetwork> Networks { get; } = plan.Networks.ToDictionary(network => network.Id);
        public ILookup<string, Component> ComponentsByName { get; } = plan.Components.ToLookup(component => component.Name, Names);
        public ILookup<string, PlanInterface> InterfacesByComponent { get; } = plan.Interfaces.ToLookup(port => port.ComponentId);
        public ILookup<string, PlanNetwork> NetworksByName { get; } = plan.Networks.ToLookup(network => network.Name, Names);

        public InventoryValues Values(Component component, PlanInterface port) => new(
            component.Name, component.Type, port.Name, port.NetworkId,
            port.NetworkId is { } networkId ? Networks[networkId].Name : null, port.Ipv4);

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
