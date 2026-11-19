import { useId, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  etherNetIpDeviceClasses,
  modbusRoles,
  profileNames,
  profinetRoles,
  type EtherNetIpDeviceClass,
  type InterfaceProtocolProfiles,
  type ModbusDownstreamDevice,
  type ModbusRole,
  type ProfinetRole,
} from "@/lib/protocol-profiles"

const profileTypes = Object.keys(profileNames) as (keyof typeof profileNames)[]
const ioRoles = Object.keys(profinetRoles) as ProfinetRole[]
const selectClassName =
  "min-h-11 min-w-0 border border-input bg-background px-2"

export function ProtocolProfileFields({
  profiles = {},
  onChange,
}: {
  profiles?: InterfaceProtocolProfiles
  onChange: (profiles?: InterfaceProtocolProfiles) => void
}) {
  const id = useId()
  const [chooserOpen, setChooserOpen] = useState(false)
  const { etherNetIp, profinet, modbusTcp } = profiles
  const availableProfiles = profileTypes.filter((type) => !profiles[type])

  function removeProfile(type: keyof InterfaceProtocolProfiles) {
    const remaining = { ...profiles }
    delete remaining[type]
    onChange(profileTypes.some((key) => remaining[key]) ? remaining : undefined)
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {etherNetIp && (
        <ProfileFields
          name={profileNames.etherNetIp}
          onRemove={() => removeProfile("etherNetIp")}
        >
          <Field>
            <FieldLabel htmlFor={`${id}-class`}>
              EtherNet/IP device class
            </FieldLabel>
            <select
              id={`${id}-class`}
              className={selectClassName}
              value={etherNetIp.deviceClass ?? ""}
              onChange={(event) =>
                onChange({
                  ...profiles,
                  etherNetIp: {
                    deviceClass: (event.target.value || undefined) as
                      EtherNetIpDeviceClass | undefined,
                  },
                })
              }
            >
              <option value="">Unspecified</option>
              {Object.entries(etherNetIpDeviceClasses).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </ProfileFields>
      )}
      {profinet && (
        <ProfileFields
          name={profileNames.profinet}
          onRemove={() => removeProfile("profinet")}
        >
          <Field>
            <FieldLabel htmlFor={`${id}-station-name`}>Station name</FieldLabel>
            <Input
              id={`${id}-station-name`}
              className="min-h-11"
              value={profinet.stationName ?? ""}
              spellCheck={false}
              onChange={(event) =>
                onChange({
                  ...profiles,
                  profinet: {
                    ...profinet,
                    stationName: event.target.value || undefined,
                  },
                })
              }
            />
          </Field>
          <FieldSet className="gap-0">
            <FieldLegend variant="label" className="mb-0">
              Applicable IO roles
            </FieldLegend>
            <FieldGroup className="flex-row flex-wrap gap-x-4 gap-y-0">
              {ioRoles.map((role) => (
                <FieldLabel key={role} className="min-h-11 items-center">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={profinet.roles?.includes(role) ?? false}
                    onChange={(event) => {
                      const selected = profinet.roles ?? []
                      const roles = event.target.checked
                        ? [...selected, role]
                        : selected.filter((item) => item !== role)
                      onChange({
                        ...profiles,
                        profinet: { ...profinet, roles },
                      })
                    }}
                  />
                  {profinetRoles[role]}
                </FieldLabel>
              ))}
            </FieldGroup>
          </FieldSet>
        </ProfileFields>
      )}
      {modbusTcp && (
        <ProfileFields
          name={profileNames.modbusTcp}
          onRemove={() => removeProfile("modbusTcp")}
        >
          <FieldGroup className="gap-3 sm:grid sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${id}-modbus-role`}>Modbus role</FieldLabel>
              <select
                id={`${id}-modbus-role`}
                className={selectClassName}
                value={modbusTcp.role ?? ""}
                onChange={(event) =>
                  onChange({
                    ...profiles,
                    modbusTcp: {
                      ...modbusTcp,
                      role: (event.target.value || undefined) as
                        ModbusRole | undefined,
                    },
                  })
                }
              >
                <option value="">Unspecified</option>
                {Object.entries(modbusRoles).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-modbus-port`}>
                Server TCP port
              </FieldLabel>
              <Input
                id={`${id}-modbus-port`}
                type="number"
                min={1}
                max={65535}
                className="min-h-11"
                value={modbusTcp.serverPort ?? ""}
                onChange={(event) =>
                  onChange({
                    ...profiles,
                    modbusTcp: {
                      ...modbusTcp,
                      serverPort: event.target.value
                        ? event.target.valueAsNumber
                        : undefined,
                    },
                  })
                }
              />
            </Field>
          </FieldGroup>
          <ModbusDeviceFields
            devices={modbusTcp.downstreamDevices ?? []}
            onChange={(downstreamDevices) =>
              onChange({
                ...profiles,
                modbusTcp: { ...modbusTcp, downstreamDevices },
              })
            }
          />
        </ProfileFields>
      )}
      {availableProfiles.length > 0 && (
        <div className="flex flex-col items-start gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            aria-expanded={chooserOpen}
            aria-controls={`${id}-available`}
            onClick={() => setChooserOpen(!chooserOpen)}
          >
            Add protocol profile
          </Button>
          <div
            id={`${id}-available`}
            hidden={!chooserOpen}
            className="flex flex-wrap gap-2"
          >
            {availableProfiles.map((type) => (
              <Button
                key={type}
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  onChange({ ...profiles, [type]: {} })
                  setChooserOpen(false)
                }}
              >
                Add {profileNames[type]}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ProfileFields({
  name,
  onRemove,
  children,
}: {
  name: string
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <FieldSet className="min-w-0 gap-3 border p-3">
      <FieldLegend className="mb-0 px-1">{name}</FieldLegend>
      {children}
      <Button
        type="button"
        variant="ghost"
        className="min-h-11 self-start"
        onClick={onRemove}
      >
        Remove {name} profile
      </Button>
    </FieldSet>
  )
}

function ModbusDeviceFields({
  devices,
  onChange,
}: {
  devices: ModbusDownstreamDevice[]
  onChange: (devices: ModbusDownstreamDevice[]) => void
}) {
  const [rowIds, setRowIds] = useState(() =>
    devices.map(() => crypto.randomUUID())
  )

  function update(index: number, device: ModbusDownstreamDevice) {
    onChange(
      devices.map((item, position) => (position === index ? device : item))
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {devices.map((device, index) => {
        const id = rowIds[index]
        return (
          <FieldSet key={id} className="min-w-0 gap-1 border p-2">
            <FieldLegend className="mb-0 px-1" variant="label">
              Downstream device {index + 1}
            </FieldLegend>
            <FieldGroup className="gap-3 sm:grid sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-name`}>Device name</FieldLabel>
                <Input
                  id={`${id}-name`}
                  className="min-h-11"
                  value={device.name ?? ""}
                  onChange={(event) =>
                    update(index, {
                      ...device,
                      name: event.target.value || undefined,
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-unit`}>Unit ID</FieldLabel>
                <Input
                  id={`${id}-unit`}
                  type="number"
                  min={0}
                  max={255}
                  className="min-h-11"
                  value={device.unitId ?? ""}
                  onChange={(event) =>
                    update(index, {
                      ...device,
                      unitId: event.target.value
                        ? event.target.valueAsNumber
                        : undefined,
                    })
                  }
                />
              </Field>
            </FieldGroup>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 self-start"
              onClick={() => {
                setRowIds(rowIds.filter((_, position) => position !== index))
                onChange(devices.filter((_, position) => position !== index))
              }}
            >
              Remove downstream device
            </Button>
          </FieldSet>
        )
      })}
      <Button
        type="button"
        variant="outline"
        className="min-h-11 self-start"
        onClick={() => {
          setRowIds([...rowIds, crypto.randomUUID()])
          onChange([...devices, {}])
        }}
      >
        Add downstream device
      </Button>
    </div>
  )
}
