using System.Globalization;

namespace Nami.Api.Plans;

public static class Ipv4Address
{
    public static bool TryParse(string? text, out uint address)
    {
        address = 0;
        var parts = text?.Split('.');
        if (parts is not { Length: 4 })
            return false;

        uint parsed = 0;
        foreach (var part in parts)
        {
            if (part.Length is < 1 or > 3 || (part.Length > 1 && part[0] == '0') ||
                !part.All(char.IsAsciiDigit) ||
                !byte.TryParse(part, NumberStyles.None, CultureInfo.InvariantCulture, out var octet))
                return false;
            parsed = (parsed << 8) | octet;
        }
        address = parsed;
        return true;
    }

    public static string Format(uint address) =>
        $"{address >> 24}.{(address >> 16) & 255}.{(address >> 8) & 255}.{address & 255}";
}

public readonly record struct Ipv4Subnet(uint NetworkAddress, uint BroadcastAddress)
{
    public bool Contains(uint address) => address >= NetworkAddress && address <= BroadcastAddress;

    public static bool TryParse(string? text, out Ipv4Subnet subnet)
    {
        subnet = default;
        var parts = text?.Split('/');
        if (parts is not { Length: 2 } || !Ipv4Address.TryParse(parts[0], out var address) ||
            parts[1].Length is < 1 or > 2 || !parts[1].All(char.IsAsciiDigit) ||
            !byte.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var prefix) || prefix > 32)
            return false;

        var hostMask = prefix switch
        {
            0 => uint.MaxValue,
            32 => 0u,
            _ => uint.MaxValue >> prefix
        };
        if ((address & hostMask) != 0)
            return false;
        subnet = new Ipv4Subnet(address, address | hostMask);
        return true;
    }
}
