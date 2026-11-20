import { useRef, useState, type MouseEvent, type PointerEvent } from "react"
import type { DiagramPosition } from "@/lib/plans"

export type ComponentMove = {
  id: string
  componentIds: readonly string[]
  position: DiagramPosition
}

type Drag = {
  item: ComponentMove
  pointerId: number
  startX: number
  startY: number
  minimum: DiagramPosition
  moved: boolean
}

export function useTopologyDrag(
  enabled: boolean,
  zoom: number,
  onDragStart: () => void,
  savePosition: (item: ComponentMove) => Promise<void>
) {
  const active = useRef<Drag | undefined>(undefined)
  const ignoreClick = useRef(false)
  const [preview, setPreview] = useState<ComponentMove>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  function start(
    event: PointerEvent<HTMLButtonElement>,
    item: ComponentMove,
    minimum: DiagramPosition
  ) {
    if (!enabled || saving || !event.isPrimary || event.button !== 0) return
    ignoreClick.current = false
    if (event.shiftKey) return
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
    if (!drag.moved) {
      if (Math.hypot(x, y) < 5) return
      drag.moved = true
      onDragStart()
    }
    return {
      ...drag.item,
      position: {
        x: Math.max(
          drag.minimum.x,
          Math.round(drag.item.position.x + x / zoom)
        ),
        y: Math.max(
          drag.minimum.y,
          Math.round(drag.item.position.y + y / zoom)
        ),
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
    await place(item)
  }

  async function place(item: ComponentMove) {
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
    item: ComponentMove,
    minimum: DiagramPosition,
    select: (event: MouseEvent<HTMLButtonElement>) => void
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
        if (!ignoreClick.current || event.detail === 0) select(event)
        ignoreClick.current = false
      },
    }
  }

  return { bind, place, preview, saving, error }
}
