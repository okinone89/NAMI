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

  const directMembers = new Set<string>()
  const networkedComponents = new Set<string>()
  for (const { componentId, networkId } of plan.interfaces) {
    if (networkId !== null) networkedComponents.add(componentId)
    if (networkId === focusedNetworkId) directMembers.add(componentId)
  }

  const visibleIds = new Set(directMembers)
  for (const { id, hostId } of plan.components) {
    if (!hostId) continue
    if (directMembers.has(id)) visibleIds.add(hostId)
    if (directMembers.has(hostId) && !networkedComponents.has(id))
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
