export const profileNames = {
  etherNetIp: "EtherNet/IP",
  profinet: "PROFINET",
  modbusTcp: "Modbus TCP",
} as const

export const etherNetIpDeviceClasses = {
  scanner: "Scanner",
  adapter: "Adapter",
  messaging: "Messaging",
} as const

export const profinetRoles = {
  controller: "IO controller",
  device: "IO device",
  supervisor: "IO supervisor",
} as const

export const modbusRoles = { client: "Client", server: "Server" } as const

export type EtherNetIpDeviceClass = keyof typeof etherNetIpDeviceClasses
export type ProfinetRole = keyof typeof profinetRoles
export type ModbusRole = keyof typeof modbusRoles

export type ModbusDownstreamDevice = { name?: string; unitId?: number }

export type InterfaceProtocolProfiles = {
  etherNetIp?: { deviceClass?: EtherNetIpDeviceClass }
  profinet?: { stationName?: string; roles?: ProfinetRole[] }
  modbusTcp?: {
    role?: ModbusRole
    serverPort?: number
    downstreamDevices?: ModbusDownstreamDevice[]
  }
}

export function profileSummary(profiles?: InterfaceProtocolProfiles) {
  return (Object.keys(profileNames) as (keyof typeof profileNames)[])
    .filter((profile) => profiles?.[profile])
    .map((profile) => profileNames[profile])
    .join(", ")
}
