import { useId } from "react"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PlanNameDialog } from "@/components/plan-name-dialog"
import type { DiagramPosition, Plan, PlanNetwork } from "@/lib/plans"

type Props = {
  plan: Plan
  network?: PlanNetwork
  position?: DiagramPosition
  savePlan: (plan: Plan) => Promise<void>
  onClose: () => void
}

export function NetworkDialog({
  plan,
  network,
  position,
  savePlan,
  onClose,
}: Props) {
  const subnetId = useId()

  async function save(name: string, fields: FormData) {
    const subnet = String(fields.get("subnet") ?? "").trim() || null
    const networks = network
      ? plan.networks.map((item) =>
          item.id === network.id ? { ...item, name, subnet } : item
        )
      : [
          ...plan.networks,
          {
            id: crypto.randomUUID(),
            name,
            subnet,
            position: position ?? null,
          },
        ]
    await savePlan({ ...plan, networks })
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
          defaultValue={network?.subnet ?? ""}
          placeholder="192.168.1.0/24"
          spellCheck={false}
          autoComplete="off"
          className="min-h-11"
        />
      </Field>
    </PlanNameDialog>
  )
}
