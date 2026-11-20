using System.Text;

namespace Nami.Api.Plans;

internal static class InventoryCsv
{
    internal static string MediumName(LinkMedium medium) => medium == LinkMedium.FiberOptic ? "FO" : medium.ToString();

    public static byte[] Export(Plan plan)
    {
        var ports = plan.Interfaces.ToLookup(port => port.ComponentId);
        var components = plan.Components.ToDictionary(component => component.Id);
        var interfaces = plan.Interfaces.ToDictionary(port => port.Id);
        var partners = plan.Links.SelectMany(link => new[]
        {
            (End: link.Source, Partner: link.Target, Link: link),
            (End: link.Target, Partner: link.Source, Link: link)
        }.Distinct()).ToLookup(item => item.End);
        var networks = plan.Networks.ToDictionary(network => network.Id);
        var csv = new StringBuilder("\uFEFFComponent,Interface,Component type,Network,Network subnet,IPv4,Link partner,Partner port,Connection type,Link protocol\r\n");
        foreach (var component in plan.Components)
        {
            var componentEnd = new LinkEndpoint(component.Id);
            if (!ports[component.Id].Any() || partners.Contains(componentEnd))
                WriteRows(component, null, componentEnd);
            foreach (var port in ports[component.Id])
                WriteRows(component, port, new LinkEndpoint(component.Id, port.Id));
        }
        void WriteRows(Component component, PlanInterface? port, LinkEndpoint endpoint)
        {
            var network = port?.NetworkId is { } networkId ? networks[networkId] : null;
            foreach (var (_, partner, link) in partners[endpoint].DefaultIfEmpty())
            {
                var medium = link is null ? null : MediumName(link.Medium);
                string?[] cells = [component.Name, port?.Name, component.Type, network?.Name, network?.Subnet,
                    port?.Ipv4, partner is null ? null : components[partner.ComponentId].Name,
                    partner?.InterfaceId is { } id ? interfaces[id].Name : null, medium, link?.Protocol];
                csv.AppendJoin(',', cells.Select(Escape));
                csv.Append("\r\n");
            }
        }
        var assigned = plan.Interfaces.Select(port => port.NetworkId).ToHashSet();
        foreach (var network in plan.Networks.Where(network => !assigned.Contains(network.Id)))
        {
            string?[] cells = [null, null, null, network.Name, network.Subnet, null, null, null, null, null];
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
