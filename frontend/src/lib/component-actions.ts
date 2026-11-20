import {
  diagramBounds,
  diagramBoxesTouch,
  hostEnclosure,
  type layoutDiagram,
} from "./diagram-layout"
import type { LinkEndpoint, Plan } from "./plans"

export function duplicateComponents(
  plan: Plan,
  selection: ReadonlySet<string>,
  layout: ReturnType<typeof layoutDiagram>,
  automaticIpAssignment: boolean
) {
  const selected = plan.components.filter(({ id }) => selection.has(id))
  const componentIds = new Map(
    selected.map(({ id }) => [id, crypto.randomUUID()])
  )
  const existingNames = new Set(
    plan.components.map((item) => item.name.trim().toUpperCase())
  )
  const footprint = selected.map(({ id }) => {
    const box = layout.componentBoxes.get(id)!
    const guests = layout.guests
      .get(id)
      ?.filter((guest) => selection.has(guest.id))
    return guests?.length
      ? hostEnclosure([
          box,
          ...guests.map((guest) => layout.componentBoxes.get(guest.id)!),
        ])
      : box
  })
  const bounds = diagramBounds(footprint)
  const obstacles = [
    ...layout.componentBoxes.values(),
    ...layout.enclosures.values(),
  ]
  const gap = 48
  const destination = { ...bounds, x: bounds.x + bounds.width + gap }
  if (obstacles.some((box) => diagramBoxesTouch(destination, box))) {
    destination.x = bounds.x
    destination.y = bounds.y + bounds.height + gap
    for (const box of obstacles.toSorted((a, b) => a.y - b.y)) {
      if (diagramBoxesTouch(destination, box))
        destination.y = box.y + box.height + gap
    }
  }
  const copies = selected.map((component) => {
    const original = component.name.trim()
    const numbered = /^(.+)_(\d+)$/s.exec(original)
    const baseName = numbered?.[1] ?? original
    let suffix = numbered ? BigInt(numbered[2]) + 1n : 1n
    let name = `${baseName}_${suffix}`
    while (existingNames.has(name.toUpperCase())) {
      suffix++
      name = `${baseName}_${suffix}`
    }
    existingNames.add(name.toUpperCase())
    const box = layout.componentBoxes.get(component.id)!
    return {
      ...component,
      id: componentIds.get(component.id)!,
      name,
      hostId: component.hostId
        ? (componentIds.get(component.hostId) ?? null)
        : null,
      position: {
        x: box.x + destination.x - bounds.x,
        y: box.y + destination.y - bounds.y,
      },
    }
  })
  const interfaceIds = new Map<string, string>()
  const interfaces = plan.interfaces.flatMap((port) => {
    const componentId = componentIds.get(port.componentId)
    if (!componentId) return []
    const id = crypto.randomUUID()
    interfaceIds.set(port.id, id)
    return [
      {
        ...port,
        id,
        componentId,
        ipv4: automaticIpAssignment ? null : port.ipv4,
      },
    ]
  })
  const copyEndpoint = (endpoint: LinkEndpoint): LinkEndpoint => ({
    componentId: componentIds.get(endpoint.componentId)!,
    interfaceId: endpoint.interfaceId
      ? interfaceIds.get(endpoint.interfaceId)!
      : null,
  })
  const links = plan.links
    .filter(
      ({ source, target }) =>
        selection.has(source.componentId) && selection.has(target.componentId)
    )
    .map((link) => ({
      ...link,
      id: crypto.randomUUID(),
      source: copyEndpoint(link.source),
      target: copyEndpoint(link.target),
    }))
  return {
    components: copies,
    interfaces,
    links,
  }
}

export type ComponentCopies = ReturnType<typeof duplicateComponents>

export function addComponentCopies(plan: Plan, copies: ComponentCopies): Plan {
  return {
    ...plan,
    components: [...plan.components, ...copies.components],
    interfaces: [...plan.interfaces, ...copies.interfaces],
    links: [...plan.links, ...copies.links],
  }
}

export function deleteComponents(
  plan: Plan,
  selection: ReadonlySet<string>
): Plan {
  return {
    ...plan,
    components: plan.components
      .filter((c) => !selection.has(c.id))
      .map((c) =>
        c.hostId && selection.has(c.hostId) ? { ...c, hostId: null } : c
      ),
    interfaces: plan.interfaces.filter(
      (port) => !selection.has(port.componentId)
    ),
    links: plan.links.filter(
      ({ source, target }) =>
        !selection.has(source.componentId) && !selection.has(target.componentId)
    ),
  }
}
