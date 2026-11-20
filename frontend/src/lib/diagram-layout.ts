import type { Component, DiagramPosition, PlanInterface } from "@/lib/plans"

export type DiagramBox = DiagramPosition & { width: number; height: number }

export const canvasWidth = 760
export const diagramPortHeight = 28
const componentWidth = 176
const baseHeight = 68
const guestColumn = 208
const guestRow = 112

export function layoutDiagram(
  components: Component[],
  interfaces: PlanInterface[]
) {
  const guests = new Map<string, Component[]>()
  for (const component of components) {
    if (!component.hostId) continue
    const group = guests.get(component.hostId)
    if (group) group.push(component)
    else guests.set(component.hostId, [component])
  }

  const componentBoxes = new Map<string, DiagramBox>()
  const portHeights = new Map<string, number>()
  for (const port of interfaces) {
    portHeights.set(
      port.componentId,
      (portHeights.get(port.componentId) ?? 0) + diagramPortHeight
    )
  }
  const heightOf = (id: string) => baseHeight + (portHeights.get(id) ?? 0)
  let left = 28
  let top = 48
  let rowHeight = 0
  const topLevel = components.filter(({ hostId }) => !hostId)
  for (const component of topLevel) {
    const members = guests.get(component.id) ?? []
    const hasTwoColumns = members.length > 1
    const offset = hasTwoColumns ? guestColumn / 2 : 0
    const width = componentWidth + (hasTwoColumns ? guestColumn : 0)
    const componentHeight = heightOf(component.id)
    let guestTop = componentHeight + 36
    let guestRowHeight = 0

    if (left + width > canvasWidth - 28) {
      left = 28
      top += rowHeight + 68
      rowHeight = 0
    }

    const host = component.position ?? { x: left + offset, y: top }
    componentBoxes.set(component.id, {
      ...host,
      width: componentWidth,
      height: componentHeight,
    })
    for (const [index, guest] of members.entries()) {
      const position = guest.position ?? {
        x: host.x - offset + (index % 2) * guestColumn,
        y: host.y + guestTop,
      }
      componentBoxes.set(guest.id, {
        ...position,
        width: componentWidth,
        height: heightOf(guest.id),
      })
      guestRowHeight = Math.max(guestRowHeight, heightOf(guest.id))
      if (index % 2 === 1 || index === members.length - 1) {
        guestTop += Math.max(guestRow, guestRowHeight + 32)
        guestRowHeight = 0
      }
    }
    left += width + 64
    rowHeight = Math.max(
      rowHeight,
      members.length ? guestTop - 32 : componentHeight
    )
  }
  const enclosures = new Map(
    Array.from(guests, ([id, members]) => [
      id,
      hostEnclosure([
        componentBoxes.get(id)!,
        ...members.map((guest) => componentBoxes.get(guest.id)!),
      ]),
    ])
  )

  return { componentBoxes, guests, topLevel, enclosures }
}

export function hostEnclosure(boxes: DiagramBox[]): DiagramBox {
  const x = Math.min(...boxes.map((box) => box.x)) - 16
  const y = Math.min(...boxes.map((box) => box.y)) - 34
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) + 16 - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) + 16 - y,
  }
}

export function moveDiagramComponents(
  layout: ReturnType<typeof layoutDiagram>,
  id: string,
  position: DiagramPosition
) {
  const initial = layout.componentBoxes.get(id)!
  const dx = position.x - initial.x
  const dy = position.y - initial.y
  const positions = new Map([[id, position]])
  for (const guest of layout.guests.get(id) ?? []) {
    const box = layout.componentBoxes.get(guest.id)!
    positions.set(guest.id, { x: box.x + dx, y: box.y + dy })
  }
  return positions
}
