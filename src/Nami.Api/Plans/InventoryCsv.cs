using System.Text;

namespace Nami.Api.Plans;

internal static class InventoryCsv
{
    public static byte[] Export(Plan plan)
    {
        var components = plan.Components.ToDictionary(component => component.Id);
        var networks = plan.Networks.ToDictionary(network => network.Id);
        var csv = new StringBuilder("\uFEFFComponent ID,Interface ID,Component,Interface,Component type,Network ID,Network,IPv4\r\n");
        foreach (var port in plan.Interfaces)
        {
            var component = components[port.ComponentId];
            var network = port.NetworkId is { } networkId ? networks[networkId] : null;
            string?[] cells = [component.Id, port.Id, component.Name, port.Name, component.Type,
                network?.Id, network?.Name, port.Ipv4];
            csv.AppendJoin(',', cells.Select(Escape));
            csv.Append("\r\n");
        }
        return Encoding.UTF8.GetBytes(csv.ToString());
    }

    private static string Escape(string? value)
    {
        if (value is null)
            return "";
        return value.IndexOfAny([',', '"', '\r', '\n']) >= 0
            ? "\"" + value.Replace("\"", "\"\"") + "\""
            : value;
    }
}
