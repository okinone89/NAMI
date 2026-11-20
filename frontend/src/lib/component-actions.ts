import type { Component, DiagramPosition, Plan } from "./plans"

export function duplicateComponent(
  plan: Plan,
  component: Component,
  position: DiagramPosition
): Plan {
  const id = crypto.randomUUID()
  const copy = {
    ...component,
    id,
    name: component.name + " copy",
    position: { x: position.x + 32, y: position.y + 32 },
  }
  const ports = plan.interfaces.filter((p) => p.componentId === component.id)
  return {
    ...plan,
    components: [...plan.components, copy],
    interfaces: [
      ...plan.interfaces,
      ...ports.map((port) => ({
        ...port,
        id: crypto.randomUUID(),
        componentId: id,
        ipv4: null,
      })),
    ],
  }
}

export function deleteComponent(plan: Plan, id: string): Plan {
  return {
    ...plan,
    components: plan.components
      .filter((c) => c.id !== id)
      .map((c) => (c.hostId === id ? { ...c, hostId: null } : c)),
    interfaces: plan.interfaces.filter((port) => port.componentId !== id),
    links: plan.links.filter(
      (link) => link.source.componentId !== id && link.target.componentId !== id
    ),
  }
}
