import { hostEnclosure, type layoutDiagram } from "@/lib/diagram-layout"
import type { Plan } from "@/lib/plans"

type DiagramLayout = ReturnType<typeof layoutDiagram>

export function scopedDiagram(
  plan: Plan,
  layout: DiagramLayout,
  focusedNetworkId: string | null
) {
  const network = plan.networks.find(({ id }) => id === focusedNetworkId)
  if (!network)
    return { layout, visibleNetworks: plan.networks, focused: false }

  const visibleIds = new Set(
    plan.interfaces
      .filter(({ networkId }) => networkId === focusedNetworkId)
      .map(({ componentId }) => componentId)
  )
  for (const component of plan.components) {
    if (component.hostId && visibleIds.has(component.id)) {
      visibleIds.add(component.hostId)
    }
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
  const content = [...componentBoxes.values(), ...enclosures.values()]
  const networkBox = layout.networkBoxes.get(network.id)!
  // Place an unsaved network label above its members in the focused view.
  const networkBoxes = new Map([
    [
      network.id,
      !network.position && content.length > 0
        ? {
            ...networkBox,
            x: Math.min(...content.map(({ x }) => x)),
            y: Math.min(...content.map(({ y }) => y)) - networkBox.height - 22,
          }
        : networkBox,
    ],
  ])
  return {
    layout: {
      componentBoxes,
      networkBoxes,
      guests,
      topLevel: layout.topLevel.filter(({ id }) => visibleIds.has(id)),
      enclosures,
    },
    visibleNetworks: [network],
    focused: true,
  }
}
