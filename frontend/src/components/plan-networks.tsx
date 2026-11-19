import { useState } from "react"
import { Button } from "@/components/ui/button"
import { PlanNameDialog } from "@/components/plan-name-dialog"
import type { Plan, PlanNetwork } from "@/lib/plans"

type Props = {
  plan: Plan
  canEdit: boolean
  savePlan: (plan: Plan) => Promise<void>
}

export function PlanNetworks({ plan, canEdit, savePlan }: Props) {
  const [editing, setEditing] = useState<PlanNetwork | "new">()

  async function save(name: string) {
    if (!editing) return
    const networks =
      editing === "new"
        ? [
            ...plan.networks,
            { id: crypto.randomUUID(), name, subnet: null, position: null },
          ]
        : plan.networks.map((network) =>
            network.id === editing.id ? { ...network, name } : network
          )
    await savePlan({ ...plan, networks })
  }

  if (!canEdit && !plan.networks.length) return null

  return (
    <section
      aria-label="Networks"
      className="mb-5 flex flex-wrap items-center gap-3"
    >
      <h2 className="text-sm font-medium">Networks</h2>
      {!!plan.networks.length && (
        <ul className="flex min-w-0 flex-wrap items-center gap-2">
          {plan.networks.map((network) => (
            <li key={network.id} className="min-w-0">
              {canEdit ? (
                <Button
                  variant="ghost"
                  aria-label={`Edit network ${network.name}`}
                  onClick={() => setEditing(network)}
                  className="min-h-11 max-w-full"
                >
                  <span className="truncate">{network.name}</span>
                </Button>
              ) : (
                <span className="block truncate border px-3 py-2 text-xs">
                  {network.name}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => setEditing("new")}
        >
          Add network
        </Button>
      )}
      {editing && canEdit && (
        <PlanNameDialog
          title={editing === "new" ? "Add network" : "Edit network"}
          label="Network name"
          action="Save network"
          name={editing === "new" ? undefined : editing.name}
          onClose={() => setEditing(undefined)}
          onSave={save}
        />
      )}
    </section>
  )
}
