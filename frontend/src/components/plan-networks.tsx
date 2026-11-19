import { useState } from "react"
import { Button } from "@/components/ui/button"
import { NetworkDialog } from "@/components/network-dialog"
import { diagramDragSource } from "@/lib/diagram-placement"
import type { Plan, PlanNetwork } from "@/lib/plans"

type Props = {
  plan: Plan
  canEdit: boolean
  diagram: boolean
  savePlan: (plan: Plan) => Promise<void>
}

export function PlanNetworks({ plan, canEdit, savePlan, diagram }: Props) {
  const [editing, setEditing] = useState<PlanNetwork | "new">()

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
          {...(diagram ? diagramDragSource("network") : {})}
        >
          Add network
        </Button>
      )}
      {editing && canEdit && (
        <NetworkDialog
          plan={plan}
          network={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          savePlan={savePlan}
        />
      )}
    </section>
  )
}
