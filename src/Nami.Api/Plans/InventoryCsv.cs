using System.Text;

namespace Nami.Api.Plans;

internal static class InventoryCsv
{
    public static byte[] Export(Plan plan)
    {
        var ports = plan.Interfaces.ToLookup(port => port.ComponentId);
        var networks = plan.Networks.ToDictionary(network => network.Id);
        var csv = new StringBuilder("\uFEFFComponent,Interface,Component type,Network,Network subnet,IPv4,Link partner,Partner port,Connection type,Link protocol\r\n");
        foreach (var component in plan.Components)
        {
            foreach (var port in ports[component.Id].DefaultIfEmpty())
            {
                var network = port?.NetworkId is { } networkId ? networks[networkId] : null;
                string?[] cells = [component.Name, port?.Name, component.Type, network?.Name,
                    network?.Subnet, port?.Ipv4, null, null, null, null];
                csv.AppendJoin(',', cells.Select(Escape));
                csv.Append("\r\n");
            }
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
