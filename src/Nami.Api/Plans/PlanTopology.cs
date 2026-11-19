using System.Diagnostics.CodeAnalysis;

namespace Nami.Api.Plans;

// Persistence and transport share these four required collections.
internal record PlanTopology
{
    public required IReadOnlyList<PlanNetwork> Networks { get; init; }
    public required IReadOnlyList<Component> Components { get; init; }
    public required IReadOnlyList<PlanInterface> Interfaces { get; init; }
    public required IReadOnlyList<PlanLink> Links { get; init; }

    public PlanTopology() { }

    [SetsRequiredMembers]
    internal PlanTopology(Plan plan)
    {
        Networks = plan.Networks;
        Components = plan.Components;
        Interfaces = plan.Interfaces;
        Links = plan.Links;
    }

    public Plan ApplyTo(Plan plan) => plan with
    {
        Networks = Networks,
        Components = Components,
        Interfaces = Interfaces,
        Links = Links
    };
}
