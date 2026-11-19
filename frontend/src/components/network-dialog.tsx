import { useId, useState } from "react"
import {
  NetworkAllocationFields,
  readAllocationFields,
} from "@/components/network-allocation-fields"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PlanNameDialog } from "@/components/plan-name-dialog"
import type { DiagramPosition, Plan, PlanNetwork } from "@/lib/plans"

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
  const [subnet, setSubnet] = useState(network?.subnet ?? "")

  async function save(name: string, fields: FormData) {
    const savedSubnet = subnet.trim() || null
    const addressing = { subnet: savedSubnet, ...readAllocationFields(fields) }
    if (network) {
      const networks = plan.networks.map((item) =>
        item.id === network.id ? { ...item, name, ...addressing } : item
      )
      await savePlan({ ...plan, networks })
      return
    }

    const created = {
      id: crypto.randomUUID(),
      name,
      ...addressing,
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
        <FieldLabel htmlFor={subnetId}>IPv4 subnet (optional)</FieldLabel>
        <Input
          id={subnetId}
          name="subnet"
          value={subnet}
          onChange={(event) => setSubnet(event.target.value)}
          placeholder="192.168.1.0/24"
          spellCheck={false}
          autoComplete="off"
          className="min-h-11"
        />
      </Field>
      <NetworkAllocationFields network={network} disabled={!subnet.trim()} />
    </PlanNameDialog>
  )
}
