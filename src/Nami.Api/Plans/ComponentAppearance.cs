using System.Buffers.Text;
using System.Text.Json.Serialization;

namespace Nami.Api.Plans;

public sealed record ComponentAppearance(
    string Kind,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Symbol = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? ImageData = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Shape = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Label = null)
{
    private const int MaxShapeLabelLength = 48;
    private const int MaxIconBytes = 96 * 1024;
    private const int MaxBase64Chars = (MaxIconBytes + 2) / 3 * 4;

    internal void Validate()
    {
        switch (Kind)
        {
            case "builtIn" when ImageData is null && Shape is null && Label is null &&
                Symbol is ("plc" or "hmi" or "switch" or "router" or "accessPoint" or "server" or "vm" or "computer" or "generic" or
                    "vfd" or "servoDrive" or "ioLinkMaster" or "ioLinkHub" or "ioLinkDevice" or "remoteIo" or
                    "safetyPlc" or "protocolGateway" or "visionCamera" or "barcodeReader"):
            case "custom" when Symbol is null && Shape is null && Label is null && IsIcon(ImageData):
            case "shape" when Symbol is null && ImageData is null &&
                Shape is ("rectangle" or "ellipse" or "diamond") && Label is { Length: <= MaxShapeLabelLength }:
                return;
            default:
                throw new ArgumentException("Check the component representation and icon data.");
        }
    }

    private static bool IsIcon(string? data)
    {
        if (data is null || data.Length > MaxBase64Chars + "data:image/jpeg;base64,".Length)
            return false;
        var comma = data.IndexOf(',');
        if (comma < 0)
            return false;

        var encoded = data.AsSpan(comma + 1);
        Span<byte> header = stackalloc byte[12];
        if (encoded.Length < 16 || encoded.Length > MaxBase64Chars ||
            !Base64.IsValid(encoded, out var decodedLength) || decodedLength > MaxIconBytes ||
            !Convert.TryFromBase64Chars(encoded[..16], header, out var headerLength) ||
            headerLength != header.Length)
        {
            return false;
        }

        return data.AsSpan(0, comma) switch
        {
            "data:image/png;base64" => header.StartsWith((ReadOnlySpan<byte>)[137, 80, 78, 71, 13, 10, 26, 10]),
            "data:image/jpeg;base64" => header.StartsWith((ReadOnlySpan<byte>)[255, 216, 255]),
            "data:image/webp;base64" => header.StartsWith("RIFF"u8) && header[8..].StartsWith("WEBP"u8),
            _ => false
        };
    }
}
