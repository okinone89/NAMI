import { IconTable } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { EmptyPlanView, type PlanViewProps } from "@/components/plan-view"

export function InterfaceTable({ plan, onSelectComponent }: PlanViewProps) {
  const components = new Map(
    plan.components.map((component) => [component.id, component])
  )
  const networks = new Map(
    plan.networks.map((network) => [network.id, network.name])
  )
  const withInterfaces = new Set(
    plan.interfaces.map((port) => port.componentId)
  )
  const withoutInterfaces = plan.components.filter(
    (component) => !withInterfaces.has(component.id)
  )

  return (
    <div className="min-h-[50svh]">
      {plan.interfaces.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Component
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Interface
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Network
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  IPv4 address
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.interfaces.map((port) => (
                <tr key={port.id} className="border-b">
                  <td className="px-4 py-2">
                    <Button
                      variant="link"
                      className="min-h-11 px-0"
                      onClick={() => onSelectComponent(port.componentId)}
                    >
                      {components.get(port.componentId)?.name}
                    </Button>
                  </td>
                  <td className="px-4 py-2">{port.name}</td>
                  <td className="px-4 py-2">
                    {networks.get(port.networkId ?? "") ?? "—"}
                  </td>
                  <td className="px-4 py-2">{port.ipv4 ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyPlanView
          icon={IconTable}
          title="No interfaces yet"
          description="Each interface will have its own row in this table."
        />
      )}
      {!!withoutInterfaces.length && (
        <section
          aria-label="Components without interfaces"
          className="border-t p-4"
        >
          <h3 className="text-sm font-medium">Components without interfaces</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {withoutInterfaces.map((component) => (
              <li key={component.id}>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => onSelectComponent(component.id)}
                >
                  {component.name}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
