import type { ComponentType } from "react"
import type { Plan, SavePlanSnapshot, WithEditorAccess } from "@/lib/plans"

import type { PlanFilter } from "@/hooks/use-plan-filter"

export type PlanViewProps = {
  filter: PlanFilter
  updateFilter: (changes: Partial<PlanFilter>) => void
  plan: Plan
  canEdit: boolean
  automaticIpAssignment?: boolean
  onSelectComponent: (componentId: string, onMove?: () => void) => void
  savePlan: SavePlanSnapshot
  refreshPlan?: () => void
  withEditorAccess: WithEditorAccess
}

export function EmptyPlanView({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ size: number; stroke: number; className: string }>
  title: string
  description: string
}) {
  return (
    <div className="grid min-h-[50svh] place-items-center px-5 text-center">
      <div className="bg-background p-5">
        <Icon
          aria-hidden="true"
          size={36}
          stroke={1.3}
          className="mx-auto mb-4"
        />
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="mt-2 max-w-sm text-sm">{description}</p>
      </div>
    </div>
  )
}
