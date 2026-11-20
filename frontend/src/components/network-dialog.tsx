import { useId, useState } from "react"
import {
  NetworkAllocationFields,
  readAllocationFields,
} from "@/components/network-allocation-fields"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PlanNameDialog } from "@/components/plan-name-dialog"
import { networkCidr, subnetMask } from "@/lib/ipv4-subnet"
import { linkMediumLabels } from "@/lib/link-labels"
import { defaultNetworkColor, networkColor } from "@/lib/network-color"
import type {
  LinkMedium,
  DiagramPosition,
  Plan,
  PlanNetwork,
} from "@/lib/plans"

type Props = {
  plan: Plan
  network?: PlanNetwork
  position?: DiagramPosition
  savePlan: (plan: Plan) => Promise<void>
  onCreated?: (networkId: string) => void
  onClose: () => void
}

export function NetworkDialog({
  plan,
  network,
  position,
  savePlan,
  onCreated,
  onClose,
}: Props) {
  const subnetId = useId()
  const [address, setAddress] = useState(network?.subnet?.split("/")[0] ?? "")
  const [mask, setMask] = useState(subnetMask(network?.subnet))
  const [networkId] = useState(() => network?.id ?? crypto.randomUUID())
  const [color, setColor] = useState(() =>
    network ? networkColor(network) : defaultNetworkColor(networkId)
  )

  async function save(name: string, fields: FormData) {
    const savedSubnet = networkCidr(address.trim(), mask.trim())
    const medium = fields.get("medium") as LinkMedium | ""
    const details = {
      medium: medium || null,
      subnet: savedSubnet,
      color,
      ...readAllocationFields(fields),
    }
    if (network) {
      const networks = plan.networks.map((item) =>
        item.id === network.id ? { ...item, name, ...details } : item
      )
      await savePlan({ ...plan, networks })
      return
    }

    const created = {
      id: networkId,
      name,
      ...details,
      position: position ?? null,
    }
    await savePlan({ ...plan, networks: [...plan.networks, created] })
    onCreated?.(created.id)
  }

  return (
    <PlanNameDialog
      title={network ? "Edit network" : "Add network"}
      label="Network name"
      action="Save network"
      name={network?.name}
      onClose={onClose}
      onSave={save}
    >
      <Field>
        <FieldLabel htmlFor={subnetId}>
          IPv4 network address (optional)
        </FieldLabel>
        <Input
          id={subnetId}
          name="networkAddress"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="192.168.1.0"
          spellCheck={false}
          autoComplete="off"
          className="min-h-11"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={subnetId + "-mask"}>Subnet mask</FieldLabel>
        <Input
          id={subnetId + "-mask"}
          name="subnetMask"
          value={mask}
          onChange={(event) => setMask(event.target.value)}
          placeholder="255.255.255.0"
          spellCheck={false}
          autoComplete="off"
          className="min-h-11"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={subnetId + "-medium"}>Network type</FieldLabel>
        <select
          name="medium"
          id={subnetId + "-medium"}
          defaultValue={network?.medium ?? ""}
          className="min-h-11 border border-input bg-background px-2"
        >
          <option value="">Unspecified</option>
          {Object.entries(linkMediumLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor={subnetId + "-color"}>Network color</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={subnetId + "-color"}
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="min-h-11 w-20 cursor-pointer p-1"
          />
          <span className="text-xs text-muted-foreground">{color}</span>
        </div>
      </Field>
      <NetworkAllocationFields
        network={network}
        disabled={!address.trim() || !mask.trim()}
      />
    </PlanNameDialog>
  )
}
