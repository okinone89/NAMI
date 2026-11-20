import { IconCopy, IconPencil, IconTrash, IconX } from "@tabler/icons-react"
import {
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react"
import { flushSync } from "react-dom"
import {
  IconAlertTriangle,
  IconSchema,
  IconChevronDown,
  IconPlus,
  IconLink,
  IconBox,
  IconLibrary,
  IconZoomIn,
  IconZoomOut,
  IconMaximize,
  IconArrowsMove,
  IconBoxMultiple,
} from "@tabler/icons-react"
import { ComponentLibrary } from "@/components/component-library"
import { DiagramComponentLabel } from "@/components/diagram-component-label"
import { Button } from "@/components/ui/button"
import { EmptyPlanView, type PlanViewProps } from "@/components/plan-view"
import { DiagramSearch } from "@/components/diagram-search"
import { DiagramLinks, LinkLegend } from "@/components/diagram-links"
import { LinkInspector } from "@/components/link-inspector"
import { DuplicateComponentsDialog } from "@/components/duplicate-components-dialog"
import { EditSelectedComponents } from "@/components/edit-selected-components"
import { InterfaceLinkDialog } from "./interface-link-dialog"
import { builtInSymbols } from "@/lib/component-appearance"
import {
  addComponentCopies,
  duplicateComponents,
  deleteComponents,
  type ComponentCopies,
} from "@/lib/component-actions"
import { confirmLinkRemoval } from "@/lib/link-labels"
import { interfaceAddressLabel } from "@/lib/ipv4-subnet"
import { networkColor } from "@/lib/network-color"
import { useTopologyDrag, type ComponentMove } from "@/hooks/use-topology-drag"
import {
  canvasWidth,
  diagramBounds,
  diagramBoxesTouch,
  hostEnclosure,
  layoutDiagram,
  moveDiagramComponents,
  type DiagramBox,
} from "@/lib/diagram-layout"
import { Slider } from "@/components/ui/slider"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { placementType, diagramDragSource } from "@/lib/diagram-placement"
import { scopedDiagram } from "@/lib/diagram-scope"
import { searchDiagram, type DiagramSearchResult } from "@/lib/diagram-search"
import { cn } from "@/lib/utils"
import type {
  Component,
  DiagramPosition,
  PlanInterface,
  PlanLink,
  Plan,
} from "@/lib/plans"

type Props = PlanViewProps & {
  onAddComponent: (options: {
    position?: DiagramPosition
    initialType?: string
    onAdded: () => void
  }) => void
}

const defaultHeight = 400
const movable = "touch-none cursor-grab active:cursor-grabbing"
const missingIpv4Label = "No IPv4 address assigned"
const ipv4ConflictLabel = "IPv4 address conflict"

type CanvasGesture = {
  id: number
  client: DiagramPosition
  start: DiagramPosition
  scroll: DiagramPosition
  selecting: boolean
  moved: boolean
}

export function DiagramView({
  plan,
  canEdit,
  automaticIpAssignment = false,
  onSelectComponent,
  onAddComponent,
  savePlan,
  filter,
  updateFilter,
}: Props) {
  const { query: searchQuery, networkIds } = filter
  const networkScope = JSON.stringify(networkIds)
  const [zoom, setZoom] = useState(1)
  const [fitInset, setFitInset] = useState({ x: 0, y: 0 })
  const [retainedViewport, setRetainedViewport] = useState<DiagramBox>()
  const preservePanOnFilterClear = useRef(false)
  const linkLayer = useRef<SVGSVGElement>(null)
  const [library, setLibrary] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selection, setSelection] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [editing, setEditing] = useState<ReadonlySet<string>>()
  const [duplicating, setDuplicating] = useState<ComponentCopies>()
  const [copiesToSelect, setCopiesToSelect] = useState<string[]>()
  const [copiesToReveal, setCopiesToReveal] = useState<string[]>()
  const revealedCopies = useRef<string[]>(undefined)
  const [hiddenCopies, setHiddenCopies] = useState<string[]>()
  type MenuTarget = { component: Component } | { link: PlanLink }
  const [menu, setMenu] = useState<MenuTarget & { x: number; y: number }>()
  function openMenu(target: MenuTarget, x: number, y: number) {
    if (!canEdit || savingAction) return
    setMenu({
      ...target,
      x: Math.max(0, Math.min(x, window.innerWidth - 248)),
      y: Math.max(
        0,
        Math.min(y, window.innerHeight - ("link" in target ? 94 : 300))
      ),
    })
  }
  const [source, setSource] = useState<PlanInterface>()
  const [target, setTarget] = useState<string>()
  const [actionError, setActionError] = useState("")
  const [savingAction, setSavingAction] = useState(false)
  async function applyAction(next: Plan, onSaved?: () => void) {
    setMenu(undefined)
    setSavingAction(true)
    setActionError("")
    try {
      await savePlan(next)
      onSaved?.()
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not save the plan."
      )
    } finally {
      setSavingAction(false)
    }
  }
  const [highlightedResult, setHighlightedResult] =
    useState<DiagramSearchResult>()
  const [pendingMove, setPendingMove] = useState<ComponentMove>()
  const canvasRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<CanvasGesture | null>(null)
  const ignoreCanvasClick = useRef(false)
  const [marquee, setMarquee] = useState<DiagramBox>()
  const movePrompt = useRef<HTMLDivElement>(null)
  const highlightedNode = useRef<HTMLButtonElement>(null)
  const searchResults = useMemo(
    () => searchDiagram(plan, searchQuery),
    [plan, searchQuery]
  )
  const matchIds = useMemo(
    () =>
      new Set(
        searchResults
          .filter(
            (result) =>
              !networkIds.length ||
              (result.networkId !== null &&
                networkIds.includes(result.networkId))
          )
          .map((result) => result.componentId)
      ),
    [searchResults, networkIds]
  )
  const highlightedComponentId = searchResults.find(
    ({ componentId, networkId }) =>
      componentId === highlightedResult?.componentId &&
      networkId === highlightedResult.networkId
  )?.componentId

  const [linkSelection, setLinkSelection] = useState<string | null>()

  const link = plan.links.find(({ id }) => id === linkSelection)
  const savedLayout = useMemo(
    () => layoutDiagram(plan.components, plan.interfaces),
    [plan.components, plan.interfaces]
  )
  const scope = useMemo(
    () =>
      scopedDiagram(
        plan,
        savedLayout,
        networkIds,
        searchQuery.trim() ? matchIds : undefined
      ),
    [plan, savedLayout, networkIds, searchQuery, matchIds]
  )
  const { componentBoxes, guests, topLevel } = scope.layout
  if (hiddenCopies?.some((id) => componentBoxes.has(id)))
    setHiddenCopies(undefined)
  const move =
    canEdit && pendingMove?.componentIds.every((id) => componentBoxes.has(id))
      ? pendingMove
      : undefined
  if (pendingMove && !move) setPendingMove(undefined)
  const selected = useMemo(
    () =>
      new Set(
        canEdit
          ? Array.from(selection).filter((id) => componentBoxes.has(id))
          : []
      ),
    [canEdit, componentBoxes, selection]
  )
  if (selected.size !== selection.size) setSelection(selected)
  if (!canEdit) {
    if (selectionMode) setSelectionMode(false)
    if (editing) setEditing(undefined)
    if (duplicating) setDuplicating(undefined)
    if (copiesToSelect) setCopiesToSelect(undefined)
  }
  if (
    canEdit &&
    copiesToSelect?.every((id) => savedLayout.componentBoxes.has(id))
  ) {
    const visible = copiesToSelect.filter((id) => componentBoxes.has(id))
    setCopiesToSelect(undefined)
    setSelection(new Set(visible))
    setCopiesToReveal(visible.length ? visible : undefined)
    setHiddenCopies(visible.length ? undefined : copiesToSelect)
  }
  const savedBoxes = [
    ...savedLayout.componentBoxes.values(),
    ...savedLayout.enclosures.values(),
  ]
  const minX = Math.min(
    retainedViewport?.x ?? 0,
    ...savedBoxes.map(({ x }) => x)
  )
  const minY = Math.min(
    retainedViewport?.y ?? 0,
    ...savedBoxes.map(({ y }) => y)
  )
  const origin = { x: minX - fitInset.x, y: minY - fitInset.y }
  function retainViewport() {
    const frame = canvasRef.current
    if (!frame) return
    // Keep enough canvas for the current pan when the outermost card moves in.
    setRetainedViewport({
      x: minX,
      y: minY,
      width: (frame.scrollLeft + frame.clientWidth) / zoom,
      height: (frame.scrollTop + frame.clientHeight) / zoom,
    })
  }
  const { bind, place, preview, saving, error } = useTopologyDrag(
    canEdit && !move && !source && !savingAction,
    zoom,
    retainViewport,
    async ({ componentIds, id, position }) => {
      const positions = moveDiagramComponents(
        savedLayout,
        componentIds,
        id,
        position
      )
      await savePlan({
        ...plan,
        components: plan.components.map((component) => {
          const moved = positions.get(component.id)
          return moved ? { ...component, position: moved } : component
        }),
      })
    }
  )
  const toCanvasBox = (box: DiagramBox) => ({
    ...box,
    x: box.x - origin.x,
    y: box.y - origin.y,
  })
  const moving = preview ?? move
  const movedComponents = moving
    ? moveDiagramComponents(
        savedLayout,
        moving.componentIds,
        moving.id,
        moving.position
      )
    : undefined
  const components = new Map(
    Array.from(componentBoxes, ([id, box]) => [
      id,
      toCanvasBox({ ...box, ...movedComponents?.get(id) }),
    ])
  )
  const scrollToScope = useEffectEvent(() => {
    if (preservePanOnFilterClear.current) {
      preservePanOnFilterClear.current = false
      if (!networkIds.length) return
    }
    const box = networkIds.length ? components.values().next().value : undefined
    canvasRef.current?.scrollTo(
      box ? (box.x - 24) * zoom : 0,
      box ? (box.y - 24) * zoom : 0
    )
  })
  useLayoutEffect(() => {
    scrollToScope()
  }, [networkScope])
  const revealCopies = useEffectEvent(() => {
    const frame = canvasRef.current
    if (!frame || !copiesToReveal || revealedCopies.current === copiesToReveal)
      return
    const visible = copiesToReveal.flatMap((id) => {
      const box = components.get(id)
      return box ? [box] : []
    })
    if (!visible.length) return
    const bounds = diagramBounds(visible)
    const scale = Math.max(
      0.01,
      Math.min(
        zoom,
        (frame.clientWidth - 32) / bounds.width,
        (frame.clientHeight - 48) / bounds.height
      )
    )
    if (scale < zoom) {
      setZoom(scale)
      return
    }
    revealedCopies.current = copiesToReveal
    frame.scrollTo(
      (bounds.x + bounds.width / 2) * zoom - frame.clientWidth / 2,
      (bounds.y + bounds.height / 2) * zoom - frame.clientHeight / 2
    )
    frame.scrollIntoView({ block: "nearest" })
  })
  useLayoutEffect(() => {
    revealCopies()
  }, [copiesToReveal, zoom])
  useLayoutEffect(() => {
    const node = highlightedNode.current
    node?.focus({ preventScroll: true })
    node?.scrollIntoView({ block: "nearest", inline: "center" })
  }, [highlightedComponentId, highlightedResult])
  const isMoving = move !== undefined
  const retainViewportForMove = useEffectEvent(retainViewport)
  useLayoutEffect(() => {
    if (isMoving) {
      retainViewportForMove()
      movePrompt.current?.scrollIntoView({ block: "nearest" })
      canvasRef.current?.focus({ preventScroll: true })
    }
  }, [isMoving])

  const hostGroups = new Map(
    Array.from(guests, ([id, members]) => [
      id,
      hostEnclosure([
        components.get(id)!,
        ...members.map((guest) => components.get(guest.id)!),
      ]),
    ])
  )
  const boxes = [...components.values(), ...hostGroups.values()]
  const width = Math.max(
    canvasWidth,
    retainedViewport?.width ?? 0,
    ...boxes.map(({ x, width }) => x + width + 72)
  )
  const height = Math.max(
    defaultHeight,
    retainedViewport?.height ?? 0,
    ...boxes.map(({ y, height }) => y + height + 72)
  )
  const canvasSize = { width, height, zoom }

  function fitToView() {
    const frame = canvasRef.current
    if (!frame || !boxes.length) return
    const bounds = [...boxes]
    if (linkLayer.current?.childElementCount) {
      // At overview zoom, browser font rounding can hide the width of SVG labels.
      // Measure them at normal size before fitting the selected network.
      if (zoom !== 1) flushSync(() => setZoom(1))
      bounds.push(linkLayer.current.getBBox())
    }
    const left = Math.min(...bounds.map((box) => box.x))
    const top = Math.min(...bounds.map((box) => box.y))
    const right = Math.max(...bounds.map((box) => box.x + box.width))
    const bottom = Math.max(...bounds.map((box) => box.y + box.height))
    const padding = 16
    const scale = Math.min(
      3,
      Math.max(1, frame.clientWidth - 2 * padding) / (right - left),
      Math.max(1, frame.clientHeight - 2 * padding) / (bottom - top)
    )
    // Curved links and their labels can extend beyond the canvas origin.
    const x = Math.max(0, fitInset.x - left + padding / scale)
    const y = Math.max(0, fitInset.y - top + padding / scale)
    flushSync(() => {
      setFitInset({ x, y })
      setZoom(scale)
    })
    frame.scrollTo(
      ((left + right) / 2 + x - fitInset.x) * scale - frame.clientWidth / 2,
      ((top + bottom) / 2 + y - fitInset.y) * scale - frame.clientHeight / 2
    )
  }

  const flaggedComponents = new Set(
    plan.addressIssues
      ?.filter((issue) => issue.code === "duplicateIpv4")
      .flatMap((issue) => issue.interfaces.map((port) => port.componentId))
  )
  const portsByComponent = useMemo(() => {
    const groups = new Map<string, PlanInterface[]>()
    for (const port of plan.interfaces) {
      const ports = groups.get(port.componentId)
      if (ports) ports.push(port)
      else groups.set(port.componentId, [port])
    }
    return groups
  }, [plan.interfaces])
  const componentsById = useMemo(
    () =>
      new Map(plan.components.map((component) => [component.id, component])),
    [plan.components]
  )
  const selectedMinimum = minimumTranslation(selected)
  const selectedIds = [...selected]

  function componentMinimum({ id, hostId }: Component) {
    const hostBounds = savedLayout.enclosures.get(id)
    const initial = savedLayout.componentBoxes.get(id)!
    return hostBounds
      ? {
          x: origin.x + initial.x - hostBounds.x,
          y: origin.y + initial.y - hostBounds.y,
        }
      : hostId
        ? { x: origin.x + 16, y: origin.y + 34 }
        : origin
  }

  function minimumTranslation(ids: ReadonlySet<string>) {
    const minimum = { x: -Infinity, y: -Infinity }
    for (const id of ids) {
      const component = componentsById.get(id)!
      if (component.hostId && ids.has(component.hostId)) continue
      const box = savedLayout.componentBoxes.get(id)!
      const limit = componentMinimum(component)
      minimum.x = Math.max(minimum.x, limit.x - box.x)
      minimum.y = Math.max(minimum.y, limit.y - box.y)
    }
    return minimum
  }

  function toggleSelected(id: string) {
    setHiddenCopies(undefined)
    setSelection((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearSelection() {
    if (selection.size) setSelection(new Set())
  }

  function startMove(componentIds: readonly string[]) {
    if (saving || savingAction) return
    const id = componentIds[0]
    setMenu(undefined)
    setPendingMove({
      id,
      componentIds,
      position: savedLayout.componentBoxes.get(id)!,
    })
  }

  function editSelection() {
    setMenu(undefined)
    setEditing(selected)
  }

  function duplicationSaved(copies: ComponentCopies) {
    setDuplicating(undefined)
    setCopiesToSelect(copies.components.map(({ id }) => id))
  }

  function startDuplicate(ids: ReadonlySet<string>) {
    if (saving || savingAction) return
    const copies = duplicateComponents(
      plan,
      ids,
      savedLayout,
      automaticIpAssignment
    )
    setMenu(undefined)
    setHiddenCopies(undefined)
    setActionError("")
    if (!automaticIpAssignment && copies.interfaces.length)
      setDuplicating(copies)
    else
      void applyAction(addComponentCopies(plan, copies), () =>
        duplicationSaved(copies)
      )
  }

  function confirmDelete(ids: ReadonlySet<string>, description: string) {
    if (saving || savingAction) return
    setMenu(undefined)
    const leavesGuests = plan.components.some(
      ({ id, hostId }) => !ids.has(id) && hostId && ids.has(hostId)
    )
    const guests = leavesGuests
      ? " Any unselected hosted VMs will become unhosted."
      : ""
    if (
      window.confirm(
        `Delete ${description} and remove all associated interfaces and connected links?${guests}`
      )
    ) {
      void applyAction(deleteComponents(plan, ids))
    }
  }

  function selectionActions(inMenu = false) {
    const disabled = saving || savingAction || isMoving || !!source
    return (
      <>
        <Button
          autoFocus={inMenu}
          variant="outline"
          disabled={disabled}
          onClick={() => startMove(selectedIds)}
        >
          <IconArrowsMove aria-hidden="true" data-icon="inline-start" /> Move
          selected
        </Button>
        <Button variant="outline" disabled={disabled} onClick={editSelection}>
          <IconPencil aria-hidden="true" data-icon="inline-start" /> Edit
          selected
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => startDuplicate(selected)}
        >
          <IconCopy aria-hidden="true" data-icon="inline-start" /> Duplicate
          selected
        </Button>
        <Button
          variant="destructive"
          disabled={disabled}
          onClick={() =>
            confirmDelete(
              selected,
              `the ${selected.size} selected ${selected.size === 1 ? "component" : "components"}`
            )
          }
        >
          <IconTrash aria-hidden="true" data-icon="inline-start" /> Delete
          selected
        </Button>
      </>
    )
  }

  function renderComponent(component: Component, enclosure?: DiagramBox) {
    const box = components.get(component.id)!
    const initial = componentBoxes.get(component.id)!
    const highlighted = component.id === highlightedComponentId
    const ports = portsByComponent.get(component.id) ?? []
    const warning = flaggedComponents.has(component.id)
      ? ipv4ConflictLabel
      : ports.some((port) => port.networkId) && !ports.some((port) => port.ipv4)
        ? missingIpv4Label
        : undefined
    const isSelected = selected.has(component.id)
    const dragIds = isSelected ? selectedIds : [component.id]
    return (
      <Button
        key={component.id}
        ref={highlighted ? highlightedNode : undefined}
        variant="outline"
        aria-label={component.name}
        aria-description={warning}
        aria-haspopup={selectionMode ? undefined : "dialog"}
        aria-pressed={selectionMode || selected.size ? isSelected : undefined}
        aria-current={highlighted || undefined}
        className={cn(
          "pointer-events-auto absolute z-20 flex-col items-start gap-1 px-4 py-3 text-left whitespace-normal transition-colors dark:bg-background dark:hover:bg-muted",
          canEdit && movable,
          isSelected &&
            "z-30 border-primary ring-2 ring-primary ring-offset-1 ring-offset-background",

          highlighted &&
            "z-30 ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
        style={{
          left: box.x - (enclosure?.x ?? 0),
          top: box.y - (enclosure?.y ?? 0),
          width: box.width,
          height: box.height,
        }}
        onContextMenu={(event) => {
          if (canEdit) {
            event.preventDefault()
            openMenu({ component }, event.clientX, event.clientY)
          }
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            openMenu({ component }, rect.left, rect.bottom)
          }
        }}
        title={component.name}
        {...bind(
          { id: component.id, componentIds: dragIds, position: initial },
          isSelected
            ? {
                x: initial.x + selectedMinimum.x,
                y: initial.y + selectedMinimum.y,
              }
            : componentMinimum(component),
          (event) => {
            if (source && canEdit) {
              if (component.id !== source.componentId) setTarget(component.id)
            } else if (canEdit && (selectionMode || event.shiftKey)) {
              toggleSelected(component.id)
            } else {
              onSelectComponent(component.id, () => startMove([component.id]))
            }
          }
        )}
      >
        <DiagramComponentLabel component={component} />
        {ports.map((port) => {
          const network = plan.networks.find((n) => n.id === port.networkId)
          return (
            <span
              key={port.id}
              title={[port.name, network?.name, port.ipv4]
                .filter(Boolean)
                .join(" · ")}
              className="block w-full border-l-[3px] pl-1 text-[10px] leading-3"
              style={{
                borderColor: network ? networkColor(network) : undefined,
              }}
            >
              <span className="block truncate">
                {network?.name ?? "No network"}
              </span>
              <span className="block">
                {interfaceAddressLabel(port.ipv4, network?.subnet)}
              </span>
            </span>
          )
        })}

        {warning && (
          <IconAlertTriangle
            role="img"
            aria-label={warning}
            className={cn(
              "absolute -top-2 -right-2 size-5 border bg-background",
              warning === ipv4ConflictLabel
                ? "text-destructive"
                : "text-warning"
            )}
          />
        )}
      </Button>
    )
  }

  function canvasPosition(event: MouseEvent<HTMLDivElement>) {
    const frame = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.round((event.clientX - frame.left) / zoom + origin.x),
      y: Math.round((event.clientY - frame.top) / zoom + origin.y),
    }
  }

  function clearFiltersAfterAdding() {
    preservePanOnFilterClear.current = networkIds.length > 0
    setHighlightedResult(undefined)
    updateFilter({ networkIds: [], query: "" })
  }

  function addComponent(position?: DiagramPosition, initialType?: string) {
    onAddComponent({ position, initialType, onAdded: clearFiltersAfterAdding })
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    if (!canEdit || move) return
    const type = event.dataTransfer.getData(placementType)
    const initialType = Object.entries(builtInSymbols).find(
      ([key]) => key === type
    )?.[1]
    if (!initialType && type !== "component") return
    event.preventDefault()
    addComponent(canvasPosition(event), type === "vm" ? "VM" : initialType)
  }

  function clampMove(move: ComponentMove, position: DiagramPosition) {
    const anchor = savedLayout.componentBoxes.get(move.id)!
    const minimum = minimumTranslation(new Set(move.componentIds))
    return {
      x: Math.max(anchor.x + minimum.x, position.x),
      y: Math.max(anchor.y + minimum.y, position.y),
    }
  }

  function finishMove(destination: DiagramPosition) {
    if (!move || saving) return
    const position = clampMove(move, destination)
    setPendingMove(undefined)
    void place({ ...move, position })
  }

  function handleDiagramKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      if (move) setPendingMove(undefined)
      else clearSelection()
      return
    }
    if (!move || event.target !== canvasRef.current) return
    if (event.key === "Enter") {
      event.preventDefault()
      finishMove(move.position)
      return
    }
    const step = 10
    const arrowOffsets: Record<string, DiagramPosition> = {
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
    }
    const offset = arrowOffsets[event.key]
    if (!offset) return
    event.preventDefault()
    const position = clampMove(move, {
      x: move.position.x + offset.x,
      y: move.position.y + offset.y,
    })
    setPendingMove({ ...move, position })
  }

  function gesturePosition(
    event: PointerEvent<HTMLDivElement>
  ): DiagramPosition {
    const frame = event.currentTarget
    const rect = frame.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left + frame.scrollLeft) / zoom,
      y: (event.clientY - rect.top + frame.scrollTop) / zoom,
    }
  }

  function selectionRectangle(
    start: DiagramPosition,
    end: DiagramPosition
  ): DiagramBox {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(start.x - end.x),
      height: Math.abs(start.y - end.y),
    }
  }

  function startCanvasGesture(event: PointerEvent<HTMLDivElement>) {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      isMoving ||
      (event.target as Element).closest('button, [role="button"]')
    )
      return
    ignoreCanvasClick.current = false
    if (event.pointerType === "touch") return
    const frame = event.currentTarget
    gesture.current = {
      id: event.pointerId,
      client: { x: event.clientX, y: event.clientY },
      start: gesturePosition(event),
      scroll: { x: frame.scrollLeft, y: frame.scrollTop },
      selecting: canEdit && !source && (selectionMode || event.shiftKey),
      moved: false,
    }
    frame.setPointerCapture(event.pointerId)
  }

  function updateCanvasGesture(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (active?.id !== event.pointerId) return
    const dx = event.clientX - active.client.x
    const dy = event.clientY - active.client.y
    if (!active.moved && Math.hypot(dx, dy) < 5) return
    active.moved = true
    if (active.selecting)
      setMarquee(selectionRectangle(active.start, gesturePosition(event)))
    else
      event.currentTarget.scrollTo(active.scroll.x - dx, active.scroll.y - dy)
  }

  function endCanvasGesture(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (active?.id !== event.pointerId) return
    gesture.current = null
    ignoreCanvasClick.current = active.moved
    setMarquee(undefined)
    if (!canEdit || !active.selecting || !active.moved) return
    const rectangle = selectionRectangle(active.start, gesturePosition(event))
    const hitIds = Array.from(components)
      .filter(([, box]) => diagramBoxesTouch(rectangle, box))
      .map(([id]) => id)
    setSelection((current) => new Set([...current, ...hitIds]))
  }

  return (
    <>
      <DiagramSearch
        query={searchQuery}
        results={searchResults}
        onQueryChange={(query) => {
          updateFilter({ query })
          setHighlightedResult(undefined)
        }}
        onSelectResult={(result) => {
          if (!result.networkId || !networkIds.includes(result.networkId))
            updateFilter({
              networkIds: result.networkId ? [result.networkId] : [],
            })
          setHighlightedResult({ ...result })
          setPendingMove(undefined)
        }}
      >
        {plan.links.length > 0 && <LinkLegend />}
      </DiagramSearch>
      <div
        className="flex flex-wrap items-center gap-2 border-b px-4 py-2"
        onKeyDown={handleDiagramKey}
      >
        {canEdit && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={<Button variant="outline" />}
              {...diagramDragSource("component")}
            >
              <IconPlus aria-hidden="true" /> Add{" "}
              <IconChevronDown aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => addComponent()}
                  {...diagramDragSource("component")}
                >
                  <IconBox aria-hidden="true" />
                  Add component
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!plan.components.length}
                  onClick={() => setLinkSelection(null)}
                >
                  <IconLink aria-hidden="true" />
                  Add link
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {canEdit && (
          <Button
            variant="outline"
            aria-expanded={library}
            onClick={() => setLibrary(!library)}
          >
            <IconLibrary aria-hidden="true" /> Component library
          </Button>
        )}
        {canEdit && (
          <Button
            variant={selectionMode ? "default" : "outline"}
            aria-pressed={selectionMode}
            disabled={isMoving || !!source}
            onClick={() => {
              if (selectionMode) clearSelection()
              setSelectionMode(!selectionMode)
            }}
          >
            <IconBoxMultiple aria-hidden="true" /> Select components
          </Button>
        )}
        <div
          role="group"
          aria-label="Diagram zoom"
          className="ml-auto flex max-w-full items-center gap-1"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Zoom out"
            disabled={zoom <= 0.01}
            onClick={() => setZoom(Math.max(0.01, zoom - 0.25))}
          >
            <IconZoomOut aria-hidden="true" />
          </Button>
          <div className="w-20 sm:w-32">
            <Slider
              thumbLabel="Diagram zoom"
              min={1}
              max={300}
              step={1}
              value={Math.max(1, Math.round(zoom * 100))}
              onValueChange={(percent) => setZoom(percent / 100)}
            />
          </div>
          <Button
            variant="ghost"
            title="Reset to 100%"
            aria-label="Reset zoom"
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Zoom in"
            disabled={zoom >= 3}
            onClick={() => setZoom(Math.min(3, zoom + 0.25))}
          >
            <IconZoomIn aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            onClick={fitToView}
            disabled={!boxes.length}
          >
            <IconMaximize aria-hidden="true" /> Fit to view
          </Button>
        </div>
      </div>
      {selected.size > 0 && (
        <div
          role="group"
          aria-label="Selected components"
          className="flex flex-wrap items-center gap-2 border-b px-4 py-2"
          onKeyDown={handleDiagramKey}
        >
          <span role="status" className="mr-2 text-xs font-medium">
            {selected.size} selected
          </span>
          {selectionActions()}
        </div>
      )}
      {hiddenCopies && (
        <p role="status" className="border-b px-4 py-2 text-xs">
          Duplicated successfully. The copies are hidden by the current filters.
        </p>
      )}
      {source && canEdit && (
        <div className="flex items-center gap-3 border-b p-3">
          <p role="status">Select the component to connect to {source.name}.</p>
          <Button variant="outline" onClick={() => setSource(undefined)}>
            <IconX aria-hidden="true" data-icon="inline-start" /> Cancel link
          </Button>
        </div>
      )}
      {actionError && (
        <p role="alert" className="p-3 text-destructive">
          {actionError}
        </p>
      )}
      {move && (
        <div
          ref={movePrompt}
          className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-4 py-2"
        >
          <p role="status" className="text-xs">
            {move.componentIds.length === 1
              ? `Tap or click the destination for ${plan.components.find(({ id }) => id === move.id)?.name}.`
              : `Tap or click the destination for ${move.componentIds.length} selected components.`}{" "}
            Use arrow keys to move and Enter to save.
          </p>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => setPendingMove(undefined)}
          >
            <IconX aria-hidden="true" data-icon="inline-start" /> Cancel move
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="border-b px-4 py-2 text-destructive">
          {error}
        </p>
      )}
      <div className="flex">
        {library && canEdit && (
          <ComponentLibrary
            onChoose={(key) =>
              addComponent(
                {
                  x:
                    Math.round((canvasRef.current?.scrollLeft ?? 0) / zoom) +
                    origin.x +
                    32,
                  y:
                    Math.round((canvasRef.current?.scrollTop ?? 0) / zoom) +
                    origin.y +
                    32,
                },
                key === "vm" ? "VM" : builtInSymbols[key]
              )
            }
          />
        )}
        <div
          className={cn(
            "diagram-grid relative max-h-[70svh] min-h-[50svh] min-w-0 flex-1 overflow-auto select-none",
            selectionMode
              ? "cursor-crosshair"
              : "cursor-grab active:cursor-grabbing"
          )}
          role="region"
          aria-label="Topology canvas"
          tabIndex={0}
          ref={canvasRef}
          onPointerDown={startCanvasGesture}
          onPointerMove={updateCanvasGesture}
          onPointerUp={endCanvasGesture}
          onLostPointerCapture={(event) => {
            if (gesture.current?.id !== event.pointerId) return
            gesture.current = null
            setMarquee(undefined)
          }}
          onClick={(event) => {
            if (ignoreCanvasClick.current) {
              ignoreCanvasClick.current = false
              return
            }
            if (
              !isMoving &&
              !(event.target as Element).closest('button, [role="button"]')
            )
              clearSelection()
          }}
          onKeyDown={handleDiagramKey}
        >
          <div
            className="relative isolate min-h-[50svh] min-w-full"
            style={canvasSize}
            inert={isMoving}
            onDragOver={(event) => {
              if (
                canEdit &&
                !isMoving &&
                event.dataTransfer.types.includes(placementType)
              ) {
                event.preventDefault()
                event.dataTransfer.dropEffect = "copy"
              }
            }}
            onDrop={drop}
          >
            {boxes.length === 0 && (
              <EmptyPlanView
                icon={IconSchema}
                title={
                  plan.components.length
                    ? "No matching components"
                    : "No components yet"
                }
                description="Components and links will appear on this diagram."
              />
            )}
            {Array.from(hostGroups, ([id, bounds]) => (
              <div
                key={id}
                aria-hidden="true"
                className="pointer-events-none absolute z-0 bg-muted/75 ring-1 ring-muted-foreground/40 ring-inset"
                style={{
                  left: bounds.x,
                  top: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                }}
              />
            ))}
            {plan.links.length > 0 && (
              <DiagramLinks
                layerRef={linkLayer}
                plan={plan}
                focusedNetworkIds={networkIds}
                boxes={components}
                hostEnclosures={hostGroups}
                width={width}
                height={height}
                onContextLink={
                  canEdit ? (link, x, y) => openMenu({ link }, x, y) : undefined
                }
                onSelectLink={setLinkSelection}
              />
            )}
            {topLevel.map((component) => {
              const bounds = hostGroups.get(component.id)
              if (!bounds) return renderComponent(component)
              const members = guests.get(component.id)!
              return (
                <div
                  key={component.id}
                  role="group"
                  aria-label={`${component.name} host enclosure`}
                  className="pointer-events-none absolute z-20"
                  style={{
                    left: bounds.x,
                    top: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                  }}
                >
                  <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">
                    Hosted VMs
                  </p>
                  {renderComponent(component, bounds)}
                  {members.map((guest) => renderComponent(guest, bounds))}
                </div>
              )
            })}
            {marquee && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-40 border border-primary bg-primary/10"
                style={{
                  left: marquee.x,
                  top: marquee.y,
                  width: marquee.width,
                  height: marquee.height,
                }}
              />
            )}
          </div>
          {move && (
            <div
              aria-hidden="true"
              className="absolute top-0 left-0 z-40 min-h-[50svh] min-w-full cursor-crosshair"
              style={canvasSize}
              onClick={(event) => finishMove(canvasPosition(event))}
            />
          )}
        </div>
      </div>
      {editing && canEdit && (
        <EditSelectedComponents
          plan={plan}
          selection={editing}
          savePlan={savePlan}
          onClose={() => setEditing(undefined)}
        />
      )}
      {duplicating && canEdit && (
        <DuplicateComponentsDialog
          plan={plan}
          copies={duplicating}
          onClose={() => setDuplicating(undefined)}
          savePlan={async (next, approvals) => {
            await savePlan(next, approvals)
            duplicationSaved(duplicating)
          }}
        />
      )}
      {(link || (linkSelection === null && canEdit)) && (
        <LinkInspector
          key={link?.id ?? "new"}
          plan={plan}
          link={link}
          canEdit={canEdit}
          savePlan={savePlan}
          onClose={() => setLinkSelection(undefined)}
        />
      )}
      {menu && canEdit && (
        <div
          className="fixed inset-0 z-50"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setMenu(undefined)
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMenu(undefined)
          }}
        >
          <div
            role="group"
            aria-label={
              "link" in menu
                ? "Connection actions"
                : selected.has(menu.component.id)
                  ? "Selection actions"
                  : menu.component.name + " actions"
            }
            className="fixed flex max-h-[min(300px,100dvh)] w-60 flex-col gap-1 overflow-auto border bg-background p-2 shadow-md"
            style={{ left: menu.x, top: menu.y }}
          >
            {"link" in menu ? (
              <>
                <Button
                  autoFocus
                  variant="outline"
                  onClick={() => {
                    setLinkSelection(menu.link.id)
                    setMenu(undefined)
                  }}
                >
                  <IconPencil aria-hidden="true" data-icon="inline-start" />{" "}
                  Edit link
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    const links = confirmLinkRemoval(plan, menu.link)
                    setMenu(undefined)
                    if (links) void applyAction({ ...plan, links })
                  }}
                >
                  <IconTrash aria-hidden="true" data-icon="inline-start" />{" "}
                  Remove link
                </Button>
              </>
            ) : (
              <>
                {selected.has(menu.component.id) ? (
                  selectionActions(true)
                ) : (
                  <Button
                    autoFocus
                    variant="outline"
                    onClick={() => startDuplicate(new Set([menu.component.id]))}
                  >
                    <IconCopy aria-hidden="true" data-icon="inline-start" />{" "}
                    Duplicate
                  </Button>
                )}
                {(!selected.has(menu.component.id) || selected.size === 1) && (
                  <>
                    {plan.interfaces
                      .filter((p) => p.componentId === menu.component.id)
                      .map((port) => (
                        <Button
                          key={port.id}
                          variant="outline"
                          onClick={() => {
                            setSource(port)
                            setTarget(undefined)
                            setMenu(undefined)
                          }}
                        >
                          <IconLink
                            aria-hidden="true"
                            data-icon="inline-start"
                          />{" "}
                          Link from {port.name}
                        </Button>
                      ))}
                    {!selected.has(menu.component.id) && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          confirmDelete(
                            new Set([menu.component.id]),
                            menu.component.name
                          )
                        }
                      >
                        <IconTrash
                          aria-hidden="true"
                          data-icon="inline-start"
                        />{" "}
                        Delete
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {source && target && canEdit && (
        <InterfaceLinkDialog
          plan={plan}
          source={source}
          targetComponentId={target}
          savePlan={savePlan}
          onClose={() => {
            setSource(undefined)
            setTarget(undefined)
          }}
          onSaved={() => {
            setSource(undefined)
            setTarget(undefined)
          }}
        />
      )}
    </>
  )
}
