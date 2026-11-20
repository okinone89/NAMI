namespace Nami.Api.Plans;

internal static class InventoryNames
{
    public static readonly IEqualityComparer<string> Comparer = new TrimmedNameComparer();

    public static void Validate(Plan proposed, Plan? previous = null)
    {
        Check(proposed.Components.Select(item => (item.Id, item.Name)),
            previous?.Components.Select(item => (item.Id, item.Name)), "Component", $"plan '{proposed.Name}'");
        Check(proposed.Networks.Select(item => (item.Id, item.Name)),
            previous?.Networks.Select(item => (item.Id, item.Name)), "Network", $"plan '{proposed.Name}'");

        var oldPorts = previous?.Interfaces.ToLookup(port => port.ComponentId);
        var components = proposed.Components.ToDictionary(component => component.Id);
        foreach (var ports in proposed.Interfaces.GroupBy(port => port.ComponentId))
        {
            Check(ports.Select(port => (port.Id, port.Name)),
                oldPorts?[ports.Key].Select(port => (port.Id, port.Name)),
                "Interface", $"component '{components[ports.Key].Name}'");
        }
    }

    private static void Check(IEnumerable<(string Id, string Name)> items,
        IEnumerable<(string Id, string Name)>? previous, string kind, string owner)
    {
        var previousById = previous?.ToDictionary(item => item.Id, item => item.Name);
        foreach (var group in items.GroupBy(item => item.Name, Comparer))
        {
            if (group.Count() > 1 && group.Any(item =>
                previousById is null || !previousById.TryGetValue(item.Id, out var oldName) ||
                !Comparer.Equals(oldName, item.Name)))
            {
                throw new InventoryNameException($"{kind} name '{group.Key.Trim()}' is already used in {owner}.");
            }
        }
    }

    private sealed class TrimmedNameComparer : IEqualityComparer<string>
    {
        public bool Equals(string? left, string? right) =>
            StringComparer.OrdinalIgnoreCase.Equals(left?.Trim(), right?.Trim());

        public int GetHashCode(string name) => StringComparer.OrdinalIgnoreCase.GetHashCode(name.Trim());
    }
}

internal sealed class InventoryNameException(string message) : ArgumentException(message);
