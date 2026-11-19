import {
  etherNetIpDeviceClasses,
  modbusRoles,
  profileNames,
  profinetRoles,
  type InterfaceProtocolProfiles,
} from "@/lib/protocol-profiles"

export function ProtocolProfileDetails({
  profiles,
}: {
  profiles?: InterfaceProtocolProfiles
}) {
  const { etherNetIp, profinet, modbusTcp } = profiles ?? {}
  if (!etherNetIp && !profinet && !modbusTcp) return null

  return (
    <section aria-label="Protocol profiles" className="mt-3 grid gap-2">
      {etherNetIp && (
        <div className="border p-2">
          <h5 className="font-medium">{profileNames.etherNetIp}</h5>
          <dl>
            <ProfileValue
              label="Device class"
              value={
                etherNetIp.deviceClass &&
                etherNetIpDeviceClasses[etherNetIp.deviceClass]
              }
            />
          </dl>
        </div>
      )}
      {profinet && (
        <div className="border p-2">
          <h5 className="font-medium">{profileNames.profinet}</h5>
          <dl>
            <ProfileValue label="Station name" value={profinet.stationName} />
            <ProfileValue
              label="IO roles"
              value={profinet.roles
                ?.map((role) => profinetRoles[role])
                .join(", ")}
            />
          </dl>
        </div>
      )}
      {modbusTcp && (
        <div className="border p-2">
          <h5 className="font-medium">{profileNames.modbusTcp}</h5>
          <dl>
            <ProfileValue
              label="Role"
              value={modbusTcp.role && modbusRoles[modbusTcp.role]}
            />
            <ProfileValue
              label="Server TCP port"
              value={modbusTcp.serverPort}
            />
          </dl>
          {modbusTcp.downstreamDevices?.length ? (
            <div className="mt-2">
              <h6 className="text-muted-foreground">Downstream devices</h6>
              <ul className="ml-4 list-disc">
                {modbusTcp.downstreamDevices.map((device, index) => (
                  <li key={index}>
                    <span>{device.name || `Device ${index + 1}`}</span>
                    {device.unitId !== undefined && (
                      <span className="ml-2 text-muted-foreground">
                        Unit ID {device.unitId}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

function ProfileValue({
  label,
  value,
}: {
  label: string
  value?: string | number
}) {
  if (value === undefined || value === "") return null
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
