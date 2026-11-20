using System.Text.Json.Serialization;

namespace Nami.Api.Plans;

public sealed record Plan(string Id, string Name, long Revision)
{
    public IReadOnlyList<PlanNetwork> Networks { get; init; } = [];
    public IReadOnlyList<Component> Components { get; init; } = [];
    public IReadOnlyList<PlanInterface> Interfaces { get; init; } = [];
    public IReadOnlyList<PlanLink> Links { get; init; } = [];
    public IReadOnlyList<AddressIssue> AddressIssues => AddressValidation.Inspect(this);
    internal InventoryUndoReceipt? InventoryUndo { get; init; }
}

public sealed record PlanSummary(string Id, string Name);

public sealed record PlanNetwork(
    string Id,
    string Name,
    string? Subnet = null,
    DiagramPosition? Position = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    Ipv4Range? AllocationPool = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<Ipv4Range>? ExcludedIpv4Ranges = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    LinkMedium? Medium = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Color = null);

public sealed record Component(
    string Id,
    string Name,
    string Type,
    DiagramPosition? Position = null,
    string? HostId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    ComponentAppearance? Appearance = null);

public sealed record DiagramPosition(double X, double Y);

public sealed record PlanInterface(
    string Id,
    string ComponentId,
    string Name,
    string? NetworkId = null,
    string? Ipv4 = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    InterfaceProtocolProfiles? ProtocolProfiles = null);

public sealed record PlanLink(
    string Id,
    LinkEndpoint Source,
    LinkEndpoint Target,
    LinkMedium Medium,
    string? Protocol = null)
{
    // Keep the package field readable by clients that support per-link routing.
    public string LineType => "elbow";
}

public sealed record LinkEndpoint(string ComponentId, string? InterfaceId = null);

public enum LinkMedium
{
    Wired,
    Wireless,
    Virtual,
    FiberOptic
}
