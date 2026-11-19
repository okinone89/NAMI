using System.Text.Json.Serialization;

namespace Nami.Api.Plans;

public sealed record InterfaceProtocolProfiles(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    EtherNetIpProfile? EtherNetIp = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    ProfinetProfile? Profinet = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    ModbusTcpProfile? ModbusTcp = null);

public sealed record EtherNetIpProfile(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? DeviceClass = null);

public sealed record ProfinetProfile(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? StationName = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string>? Roles = null);

public sealed record ModbusTcpProfile(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Role = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    ushort? ServerPort = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<ModbusDownstreamDevice>? DownstreamDevices = null);

public sealed record ModbusDownstreamDevice(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Name = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    byte? UnitId = null);
