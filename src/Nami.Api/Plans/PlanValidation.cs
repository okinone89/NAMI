namespace Nami.Api.Plans;

internal static class PlanValidation
{
    public static void Validate(Plan plan)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(plan.Id);
        ArgumentException.ThrowIfNullOrWhiteSpace(plan.Name);

        var networks = IndexById(plan.Networks, network => network.Id, "network");
        var components = IndexById(plan.Components, component => component.Id, "component");
        var interfaces = IndexById(plan.Interfaces, port => port.Id, "interface");
        IndexById(plan.Links, link => link.Id, "link");

        foreach (var network in plan.Networks)
            ArgumentException.ThrowIfNullOrWhiteSpace(network.Name);

        foreach (var component in plan.Components)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(component.Name);
            ArgumentException.ThrowIfNullOrWhiteSpace(component.Type);
            if (component.HostId is { } hostId &&
                (!string.Equals(component.Type, "vm", StringComparison.OrdinalIgnoreCase) ||
                 !components.TryGetValue(hostId, out var host) ||
                 !string.Equals(host.Type, "server", StringComparison.OrdinalIgnoreCase)))
            {
                throw new ArgumentException($"Component '{component.Id}' must be a VM hosted on a server in the same plan.");
            }
        }

        foreach (var port in plan.Interfaces)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(port.Name);
            if (!components.ContainsKey(port.ComponentId))
                throw new ArgumentException($"Interface '{port.Id}' must belong to a component in the same plan.");
            if (port.NetworkId is { } networkId && !networks.ContainsKey(networkId))
                throw new ArgumentException($"Interface '{port.Id}' must reference a network in the same plan.");
        }

        foreach (var link in plan.Links)
        {
            if (!Enum.IsDefined(link.Medium))
                throw new ArgumentException($"Link '{link.Id}' must use a known medium.");
            ValidateEndpoint(link.Id, link.Source, components, interfaces);
            ValidateEndpoint(link.Id, link.Target, components, interfaces);
        }
    }

    private static Dictionary<string, T> IndexById<T>(IReadOnlyList<T> items, Func<T, string> getId, string kind)
        where T : class
    {
        ArgumentNullException.ThrowIfNull(items);
        var index = new Dictionary<string, T>(items.Count, StringComparer.Ordinal);
        foreach (var item in items)
        {
            if (item is null)
                throw new ArgumentException($"Each {kind} must have an ID.");

            var id = getId(item);
            if (string.IsNullOrWhiteSpace(id) || !index.TryAdd(id, item))
                throw new ArgumentException($"Each {kind} must have a unique ID within its plan.");
        }
        return index;
    }

    private static void ValidateEndpoint(
        string linkId,
        LinkEndpoint endpoint,
        Dictionary<string, Component> components,
        Dictionary<string, PlanInterface> interfaces)
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        if (!components.ContainsKey(endpoint.ComponentId))
            throw new ArgumentException($"Link '{linkId}' must connect components in the same plan.");
        if (endpoint.InterfaceId is { } portId &&
            (!interfaces.TryGetValue(portId, out var port) || port.ComponentId != endpoint.ComponentId))
        {
            throw new ArgumentException($"Link '{linkId}' must use an interface on its endpoint component.");
        }
    }
}
