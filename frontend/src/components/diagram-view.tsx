import {
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react"
import { IconNetwork, IconSchema } from "@tabler/icons-react"
import { DiagramComponentLabel } from "@/components/diagram-component-label"
import { Button } from "@/components/ui/button"
import { EmptyPlanView, type PlanViewProps } from "@/components/plan-view"
import { DiagramSearch } from "@/components/diagram-search"
import { DiagramLinks, LinkLegend } from "@/components/diagram-links"
import { LinkInspector } from "@/components/link-inspector"
import { NetworkDialog } from "@/components/network-dialog"
import { useTopologyDrag } from "@/hooks/use-topology-drag"
import {
  canvasWidth,
  hostEnclosure,
  layoutDiagram,
  moveDiagramComponents,
  type DiagramBox,
} from "@/lib/diagram-layout"
import { placementType } from "@/lib/diagram-placement"
import { scopedDiagram } from "@/lib/diagram-scope"
import { searchDiagram, type DiagramSearchResult } from "@/lib/diagram-search"
import { cn } from "@/lib/utils"
import type { Component, DiagramPosition, PlanNetwork } from "@/lib/plans"

type Props = PlanViewProps & {
  onPlaceComponent: (position: DiagramPosition) => void
}

type NetworkSelection = { network: PlanNetwork } | { position: DiagramPosition }

const defaultHeight = 400
const movable = "touch-none cursor-grab active:cursor-grabbing"

export function DiagramView({
  plan,
  canEdit,
  onSelectComponent,
  onPlaceComponent,
  savePlan,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("")
  const [focusedNetworkId, setFocusedNetworkId] = useState<string | null>(null)
  const [highlightedResult, setHighlightedResult] =
    useState<DiagramSearchResult>()
  const canvasRef = useRef<HTMLDivElement>(null)
  const highlightedNode = useRef<HTMLButtonElement>(null)
  const searchResults = useMemo(
    () => searchDiagram(plan, searchQuery),
    [plan, searchQuery]
  )
  const matchIds = useMemo(
    () => new Set(searchResults.map(({ componentId }) => componentId)),
    [searchResults]
  )
  const highlightedComponentId = searchResults.find(
    ({ componentId, networkId }) =>
      componentId === highlightedResult?.componentId &&
      networkId === highlightedResult.networkId
  )?.componentId

  const [linkSelection, setLinkSelection] = useState<string | null>()
  const [networkSelection, setNetworkSelection] = useState<NetworkSelection>()
  const link = plan.links.find(({ id }) => id === linkSelection)
  const savedLayout = useMemo(
    () => layoutDiagram(plan.components, plan.networks),
    [plan.components, plan.networks]
  )
  const scope = useMemo(
    () => scopedDiagram(plan, savedLayout, focusedNetworkId),
    [plan, savedLayout, focusedNetworkId]
  )
  const { componentBoxes, networkBoxes, guests, topLevel, enclosures } =
    scope.layout
  const { bind, preview, error } = useTopologyDrag(
    canEdit,
    async ({ id, kind, position }) => {
      if (kind === "network") {
        await savePlan({
          ...plan,
          networks: plan.networks.map((network) =>
            network.id === id ? { ...network, position } : network
          ),
        })
      } else {
        const positions = moveDiagramComponents(savedLayout, id, position)
        await savePlan({
          ...plan,
          components: plan.components.map((component) => {
            const moved = positions.get(component.id)
            return moved ? { ...component, position: moved } : component
          }),
        })
      }
    }
  )
  const savedBoxes = [
    ...savedLayout.componentBoxes.values(),
    ...savedLayout.networkBoxes.values(),
    ...savedLayout.enclosures.values(),
    ...networkBoxes.values(),
  ]
  const origin = {
    x: Math.min(0, ...savedBoxes.map(({ x }) => x)),
    y: Math.min(0, ...savedBoxes.map(({ y }) => y)),
  }
  const toCanvasBox = (box: DiagramBox) => ({
    ...box,
    x: box.x - origin.x,
    y: box.y - origin.y,
  })
  const movedComponents =
    preview?.kind === "component"
      ? moveDiagramComponents(savedLayout, preview.id, preview.position)
      : undefined
  const components = new Map(
    Array.from(componentBoxes, ([id, box]) => [
      id,
      toCanvasBox({ ...box, ...movedComponents?.get(id) }),
    ])
  )
  const networks = new Map(
    Array.from(networkBoxes, ([id, box]) => [
      id,
      toCanvasBox(
        preview?.kind === "network" && preview.id === id
          ? { ...box, ...preview.position }
          : box
      ),
    ])
  )
  const showNetwork = useEffectEvent(() => {
    const box = focusedNetworkId ? networks.get(focusedNetworkId) : undefined
    canvasRef.current?.scrollTo(box ? box.x - 24 : 0, box ? box.y - 24 : 0)
  })
  useLayoutEffect(() => {
    showNetwork()
  }, [focusedNetworkId, scope.focused])
  useLayoutEffect(() => {
    const node = highlightedNode.current
    node?.focus({ preventScroll: true })
    node?.scrollIntoView({ block: "nearest", inline: "center" })
  }, [highlightedComponentId, highlightedResult])

  const hostGroups = new Map(
    Array.from(guests, ([id, members]) => [
      id,
      hostEnclosure([
        components.get(id)!,
        ...members.map((guest) => components.get(guest.id)!),
      ]),
    ])
  )
  const boxes = [
    ...components.values(),
    ...networks.values(),
    ...hostGroups.values(),
  ]
  const width = Math.max(
    canvasWidth,
    ...boxes.map(({ x, width }) => x + width + 72)
  )
  const height = Math.max(
    defaultHeight,
    ...boxes.map(({ y, height }) => y + height + 72)
  )

  function renderComponent(component: Component, enclosure?: DiagramBox) {
    const box = components.get(component.id)!
    const initial = componentBoxes.get(component.id)!
    const hostBounds = enclosures.get(component.id)
    const minimum = hostBounds
      ? {
          x: origin.x + initial.x - hostBounds.x,
          y: origin.y + initial.y - hostBounds.y,
        }
      : component.hostId
        ? { x: origin.x + 16, y: origin.y + 34 }
        : origin
    const highlighted = component.id === highlightedComponentId
    const dimmed = searchQuery.trim() && !matchIds.has(component.id)
    return (
      <Button
        key={component.id}
        ref={highlighted ? highlightedNode : undefined}
        variant="outline"
        aria-label={component.name}
        aria-haspopup="dialog"
        aria-current={highlighted || undefined}
        className={cn(
          "pointer-events-auto absolute z-20 flex-col items-start gap-1 px-4 py-3 text-left whitespace-normal transition-colors",
          canEdit && movable,
          dimmed && "opacity-40",
          highlighted &&
            "z-30 ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
        style={{
          left: box.x - (enclosure?.x ?? 0),
          top: box.y - (enclosure?.y ?? 0),
          width: box.width,
          height: box.height,
        }}
        title={component.name}
        {...bind(
          { id: component.id, kind: "component", position: initial },
          minimum,
          () => onSelectComponent(component.id)
        )}
      >
        <DiagramComponentLabel component={component} />
      </Button>
    )
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    if (!canEdit) return
    const type = event.dataTransfer.getData(placementType)
    if (type !== "network" && type !== "component") return
    event.preventDefault()
    const frame = event.currentTarget.getBoundingClientRect()
    const position = {
      x: Math.round(event.clientX - frame.left + origin.x),
      y: Math.round(event.clientY - frame.top + origin.y),
    }
    if (type === "component") onPlaceComponent(position)
    else setNetworkSelection({ position })
  }

  return (
    <>
      {plan.networks.length > 0 && (
        <div className="border-b px-4 py-3">
          <label className="flex min-w-0 flex-col gap-1 text-xs">
            Topology network
            <select
              className="min-h-11 w-full border border-input bg-background px-3 sm:max-w-xs"
              value={scope.focused ? (focusedNetworkId ?? "") : ""}
              onChange={(event) => {
                setFocusedNetworkId(event.target.value || null)
                setHighlightedResult(undefined)
              }}
            >
              <option value="">Full topology</option>
              {plan.networks.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <DiagramSearch
        query={searchQuery}
        results={searchResults}
        onQueryChange={(query) => {
          setSearchQuery(query)
          setHighlightedResult(undefined)
        }}
        onSelectResult={(result) => {
          setFocusedNetworkId(result.networkId)
          setHighlightedResult({ ...result })
        }}
      />
      {(canEdit || plan.links.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
          {canEdit && (
            <p className="text-xs text-muted-foreground">
              Drag Add component or Add network onto the canvas to place it.
            </p>
          )}
          {plan.links.length > 0 && <LinkLegend />}
          {canEdit && plan.components.length > 0 && (
            <Button
              variant="outline"
              className="ml-auto min-h-11"
              onClick={() => setLinkSelection(null)}
            >
              Add link
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="border-b px-4 py-2 text-destructive">
          {error}
        </p>
      )}
      <div
        className="diagram-grid max-h-[70svh] min-h-[50svh] overflow-auto"
        role="region"
        aria-label="Topology canvas"
        tabIndex={0}
        ref={canvasRef}
      >
        <div
          className="relative min-h-[50svh] min-w-full"
          style={boxes.length ? { width, height } : undefined}
          onDragOver={(event) => {
            if (canEdit && event.dataTransfer.types.includes(placementType)) {
              event.preventDefault()
              event.dataTransfer.dropEffect = "copy"
            }
          }}
          onDrop={drop}
        >
          {boxes.length === 0 && (
            <EmptyPlanView
              icon={IconSchema}
              title="No components yet"
              description="Components and links will appear on this diagram."
            />
          )}
          {plan.links.length > 0 && (
            <DiagramLinks
              plan={plan}
              boxes={components}
              width={width}
              height={height}
              onSelectLink={setLinkSelection}
            />
          )}
          {scope.visibleNetworks.map((network) => {
            const box = networks.get(network.id)!
            const style = {
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
            }
            const label = (
              <>
                <IconNetwork aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 truncate">{network.name}</span>
              </>
            )
            const className =
              "absolute z-20 flex items-center justify-start gap-2 border bg-secondary px-3 text-xs transition-colors"
            return canEdit ? (
              <Button
                key={network.id}
                variant="outline"
                title={network.name}
                aria-label={network.name}
                aria-haspopup="dialog"
                className={`${className} ${movable}`}
                style={style}
                {...bind(
                  {
                    id: network.id,
                    kind: "network",
                    position: networkBoxes.get(network.id)!,
                  },
                  origin,
                  () => setNetworkSelection({ network })
                )}
              >
                {label}
              </Button>
            ) : (
              <div
                key={network.id}
                title={network.name}
                className={className}
                style={style}
              >
                {label}
              </div>
            )
          })}
          {topLevel.map((component) => {
            const bounds = hostGroups.get(component.id)
            if (!bounds) return renderComponent(component)
            const members = guests.get(component.id)!
            return (
              <div
                key={component.id}
                role="group"
                aria-label={`${component.name} host enclosure`}
                className="pointer-events-none absolute bg-muted/75 ring-1 ring-muted-foreground/40 ring-inset"
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
        </div>
      </div>
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
      {networkSelection && canEdit && (
        <NetworkDialog
          plan={plan}
          network={
            "network" in networkSelection ? networkSelection.network : undefined
          }
          position={
            "position" in networkSelection
              ? networkSelection.position
              : undefined
          }
          savePlan={savePlan}
          onClose={() => setNetworkSelection(undefined)}
        />
      )}
    </>
  )
}
