import { hostEnclosure, type layoutDiagram } from "@/lib/diagram-layout"
import type { Plan } from "@/lib/plans"

type DiagramLayout = ReturnType<typeof layoutDiagram>

export function scopedDiagram(
  plan: Plan,
  layout: DiagramLayout,
  focusedNetworkId: string | null,
  matches?: Set<string>
) {
  const network = plan.networks.find(({ id }) => id === focusedNetworkId)
  if (!network && !matches) return { layout, focused: false }

  const directMembers = new Set<string>()
  const networkedComponents = new Set<string>()
  for (const { componentId, networkId } of plan.interfaces) {
    if (networkId !== null) networkedComponents.add(componentId)
    if (networkId === focusedNetworkId) directMembers.add(componentId)
  }

  if (!network)
    for (const component of plan.components) directMembers.add(component.id)
  if (matches)
    for (const id of directMembers) {
      if (!matches.has(id)) directMembers.delete(id)
    }
  const visibleIds = new Set(directMembers)
  for (const { id, hostId } of plan.components) {
    if (!hostId) continue
    if (directMembers.has(id)) visibleIds.add(hostId)
    if (!matches && directMembers.has(hostId) && !networkedComponents.has(id))
      visibleIds.add(id)
  }

  const componentBoxes = new Map(
    Array.from(layout.componentBoxes).filter(([id]) => visibleIds.has(id))
  )
  const guests = new Map(
    Array.from(
      layout.guests,
      ([id, members]) =>
        [id, members.filter(({ id }) => visibleIds.has(id))] as const
    ).filter(([, members]) => members.length > 0)
  )
  const enclosures = new Map(
    Array.from(guests, ([id, members]) => [
      id,
      hostEnclosure([
        componentBoxes.get(id)!,
        ...members.map(({ id }) => componentBoxes.get(id)!),
      ]),
    ])
  )
  return {
    layout: {
      componentBoxes,

      guests,
      topLevel: layout.topLevel.filter(({ id }) => visibleIds.has(id)),
      enclosures,
    },
    focused: !!network,
  }
}
