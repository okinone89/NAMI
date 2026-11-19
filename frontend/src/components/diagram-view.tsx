import { IconSchema } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { EmptyPlanView, type PlanViewProps } from "@/components/plan-view"

export function DiagramView({ plan, onSelectComponent }: PlanViewProps) {
  return (
    <div className="diagram-grid min-h-[50svh]">
      {plan.components.length ? (
        <ul className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {plan.components.map((component) => (
            <li key={component.id} className="min-w-0">
              <Button
                variant="outline"
                aria-label={component.name}
                className="h-auto min-h-20 w-full flex-col items-start gap-1 px-4 py-3 text-left whitespace-normal"
                onClick={() => onSelectComponent(component.id)}
              >
                <span className="max-w-full break-words">{component.name}</span>
                <span className="max-w-full break-words text-muted-foreground">
                  {component.type}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyPlanView
          icon={IconSchema}
          title="No components yet"
          description="Components and links will appear on this diagram."
        />
      )}
    </div>
  )
}
