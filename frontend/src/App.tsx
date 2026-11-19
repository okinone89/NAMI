import { useState } from "react"
import {
  IconCircuitSwitchOpen,
  IconSchema,
  IconTable,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { EditorSessionControls } from "@/components/editor-session"
import { useEditorSession } from "@/hooks/use-editor-session"
import { usePlanWorkspace } from "@/hooks/use-plan-workspace"
import { PlanNameDialog } from "@/components/plan-name-dialog"
import { PlanNetworks } from "@/components/plan-networks"
import { ComponentEditor } from "@/components/component-editor"
import { DiagramView } from "@/components/diagram-view"
import { InterfaceTable } from "@/components/interface-table"
import { diagramDragSource } from "@/lib/diagram-placement"
import type { DiagramPosition, SavePlanSnapshot } from "@/lib/plans"

const views = {
  Diagram: {
    icon: IconSchema,
    heading: "Network diagram",
    component: DiagramView,
  },
  Table: {
    icon: IconTable,
    heading: "Interface table",
    component: InterfaceTable,
  },
}
type View = keyof typeof views
type ComponentSelection = {
  planId: string
  componentId: string | null
  position?: DiagramPosition
  onMove?: () => void
}

export default function App() {
  const editorSession = useEditorSession()
  const workspace = usePlanWorkspace(editorSession.refresh)
  const { plans, plan, failed, loading } = workspace
  const [view, setView] = useState<View>("Diagram")
  const [creating, setCreating] = useState(false)
  const [selection, setSelection] = useState<ComponentSelection>()
  const activeSelection = selection?.planId === plan?.id ? selection : undefined
  const selectedComponent = plan?.components.find(
    ({ id }) => id === activeSelection?.componentId
  )
  const addingComponent =
    activeSelection?.componentId === null && editorSession.canEdit

  function selectComponent(
    componentId: string | null,
    options?: Pick<ComponentSelection, "position" | "onMove">
  ) {
    if (plan) setSelection({ planId: plan.id, componentId, ...options })
  }

  const saveComponent: SavePlanSnapshot = (next, keepAddressConflicts) => {
    const position = activeSelection?.position
    if (!plan || !addingComponent || !position)
      return workspace.savePlan(next, keepAddressConflicts)

    const existing = new Set(plan.components.map(({ id }) => id))
    return workspace.savePlan(
      {
        ...next,
        components: next.components.map((component) =>
          existing.has(component.id) ? component : { ...component, position }
        ),
      },
      keepAddressConflicts
    )
  }

  const { icon: ViewIcon, heading, component: ActiveView } = views[view]
  return (
    <>
      <header className="flex items-center gap-3 border-b px-5 py-4 sm:px-10">
        <IconCircuitSwitchOpen
          aria-hidden="true"
          className="size-8 bg-primary p-1 text-primary-foreground"
        />
        <strong className="tracking-wide">NAMI</strong>
        <span className="hidden border-l pl-3 text-xs sm:inline">
          Network workspace
        </span>
        <EditorSessionControls session={editorSession} />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-10 sm:py-12">
        <div className="mb-6 flex flex-wrap items-end gap-3">
          {!!plans?.length && (
            <label className="flex min-w-0 flex-col gap-1 text-xs">
              Open plan
              <select
                className="min-h-11 max-w-full border border-input bg-background px-3"
                value={workspace.planId}
                onChange={(event) => workspace.selectPlan(event.target.value)}
              >
                {plans.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {editorSession.canEdit && plans && (
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setCreating(true)}
            >
              New plan
            </Button>
          )}
        </div>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <h1 className="text-3xl font-medium tracking-tight break-words sm:text-4xl">
              {plan?.name ?? "Network plan"}
            </h1>
            {plan && (
              <p className="mt-3 text-xs">
                {plan.networks.length} networks · {plan.components.length}{" "}
                components · {plan.interfaces.length} interfaces
              </p>
            )}
          </div>
          <nav aria-label="Plan views" className="flex border p-1">
            {(Object.keys(views) as View[]).map((name) => {
              const Icon = views[name].icon
              return (
                <Button
                  key={name}
                  variant={view === name ? "default" : "ghost"}
                  aria-pressed={view === name}
                  onClick={() => setView(name)}
                  className="min-h-11 gap-2 px-4"
                >
                  <Icon aria-hidden="true" />
                  {name}
                </Button>
              )
            })}
          </nav>
        </div>
        {plan && (
          <PlanNetworks
            key={plan.id}
            plan={plan}
            canEdit={editorSession.canEdit}
            savePlan={workspace.savePlan}
            diagram={view === "Diagram"}
          />
        )}
        <section aria-label={view} className="border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-4 py-2">
            <h2 className="flex items-center gap-2 py-1 text-sm font-medium">
              <ViewIcon size={18} aria-hidden="true" />
              {heading}
            </h2>
            {plan && editorSession.canEdit && (
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => selectComponent(null)}
                {...(view === "Diagram" ? diagramDragSource("component") : {})}
              >
                Add component
              </Button>
            )}
          </div>
          {plan && !failed ? (
            <ActiveView
              key={plan.id}
              plan={plan}
              canEdit={editorSession.canEdit}
              savePlan={workspace.savePlan}
              refreshPlan={workspace.refreshPlan}
              onEditorExpired={editorSession.refresh}
              onSelectComponent={(componentId, onMove) =>
                selectComponent(componentId, { onMove })
              }
              onPlaceComponent={(position) =>
                selectComponent(null, { position })
              }
            />
          ) : (
            <div className="grid min-h-[50svh] place-items-center px-5 text-center">
              {failed ? (
                <p role="alert">
                  Unable to load the plan. Reload to try again.
                </p>
              ) : loading ? (
                <p role="status">Loading plan…</p>
              ) : (
                <h3 className="bg-background p-5 text-lg font-medium">
                  No plans yet
                </h3>
              )}
            </div>
          )}
        </section>
      </main>
      {plan && (selectedComponent || addingComponent) && (
        <ComponentEditor
          key={selectedComponent?.id ?? "add-component"}
          plan={plan}
          component={selectedComponent}
          canEdit={editorSession.canEdit}
          onClose={() => setSelection(undefined)}
          onMove={activeSelection?.onMove}
          savePlan={saveComponent}
        />
      )}
      {creating && editorSession.canEdit && (
        <PlanNameDialog
          title="New plan"
          label="Plan name"
          action="Create plan"
          onSave={workspace.addPlan}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  )
}
