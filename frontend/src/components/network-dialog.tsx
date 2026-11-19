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
  async function save(name: string) {
    const networks = network
      ? plan.networks.map((item) =>
          item.id === network.id ? { ...item, name } : item
        )
      : [
          ...plan.networks,
          {
            id: crypto.randomUUID(),
            name,
            subnet: null,
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
    />
  )
}
