import { useRef, useState, type MouseEvent, type PointerEvent } from "react"
import type { DiagramItemKind } from "@/lib/diagram-placement"
import type { DiagramPosition } from "@/lib/plans"

export type DiagramItem = { id: string; kind: DiagramItemKind }
type DraggedItem = DiagramItem & { position: DiagramPosition }

type Drag = {
  item: DraggedItem
  pointerId: number
  startX: number
  startY: number
  minimum: DiagramPosition
  moved: boolean
}

export function useTopologyDrag(
  enabled: boolean,
  savePosition: (item: DraggedItem) => Promise<void>
) {
  const active = useRef<Drag | undefined>(undefined)
  const ignoreClick = useRef(false)
  const [preview, setPreview] = useState<DraggedItem>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  function start(
    event: PointerEvent<HTMLButtonElement>,
    item: DraggedItem,
    minimum: DiagramPosition
  ) {
    if (!enabled || saving || !event.isPrimary || event.button !== 0) return
    ignoreClick.current = false
    active.current = {
      item,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      minimum,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function update(event: PointerEvent<HTMLButtonElement>) {
    const drag = active.current
    if (!drag || event.pointerId !== drag.pointerId) return

    const x = event.clientX - drag.startX
    const y = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(x, y) < 5) return
    drag.moved = true
    return {
      ...drag.item,
      position: {
        x: Math.max(drag.minimum.x, Math.round(drag.item.position.x + x)),
        y: Math.max(drag.minimum.y, Math.round(drag.item.position.y + y)),
      },
    }
  }

  async function finish(event: PointerEvent<HTMLButtonElement>) {
    if (active.current?.pointerId !== event.pointerId) return
    const item = enabled && update(event)
    if (!enabled) setPreview(undefined)
    active.current = undefined
    if (!item) return

    ignoreClick.current = true
    setPreview(item)
    setSaving(true)
    setError("")
    try {
      await savePosition(item)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to save the position."
      )
    } finally {
      setSaving(false)
      setPreview(undefined)
    }
  }

  function cancel() {
    if (!active.current) return
    active.current = undefined
    setPreview(undefined)
  }

  function bind(
    item: DraggedItem,
    minimum: DiagramPosition,
    select: () => void
  ) {
    return {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) =>
        start(event, item, minimum),
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const next = update(event)
        if (next) setPreview(next)
      },
      onPointerUp: finish,
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        if (!ignoreClick.current || event.detail === 0) select()
        ignoreClick.current = false
      },
    }
  }

  return { bind, preview, error }
}
