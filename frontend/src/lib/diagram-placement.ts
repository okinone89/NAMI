import type { DragEvent } from "react"

export const placementType = "application/x-nami-topology-item"
export type DiagramItemKind = "component" | "network"

export function diagramDragSource(kind: DiagramItemKind) {
  return {
    draggable: true,
    onDragStart(event: DragEvent<HTMLElement>) {
      event.dataTransfer.effectAllowed = "copy"
      event.dataTransfer.setData(placementType, kind)
    },
  }
}
