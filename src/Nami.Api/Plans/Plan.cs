using System.Text.Json.Serialization;

namespace Nami.Api.Plans;

public sealed record Plan(string Id, string Name, long Revision)
{
    public IReadOnlyList<PlanNetwork> Networks { get; init; } = [];
    public IReadOnlyList<Component> Components { get; init; } = [];
    public IReadOnlyList<PlanInterface> Interfaces { get; init; } = [];
    public IReadOnlyList<PlanLink> Links { get; init; } = [];
}

public sealed record PlanSummary(string Id, string Name);

public sealed record PlanNetwork(
    string Id,
    string Name,
    string? Subnet = null,
    DiagramPosition? Position = null);

public sealed record Component(
    string Id,
    string Name,
    string Type,
    DiagramPosition? Position = null,
    string? HostId = null);

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
    string? Protocol = null);

public sealed record LinkEndpoint(string ComponentId, string? InterfaceId = null);

public enum LinkMedium
{
    Wired,
    Wireless,
    Virtual
}
