import { useMemo, useState, type DragEvent } from "react"
import { IconAlertTriangle, IconNetwork, IconSchema } from "@tabler/icons-react"
import { DiagramComponentLabel } from "@/components/diagram-component-label"
import { Button } from "@/components/ui/button"
import { EmptyPlanView, type PlanViewProps } from "@/components/plan-view"
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
  const [linkSelection, setLinkSelection] = useState<string | null>()
  const [networkSelection, setNetworkSelection] = useState<NetworkSelection>()
  const link = plan.links.find(({ id }) => id === linkSelection)
  const savedLayout = useMemo(
    () => layoutDiagram(plan.components, plan.networks),
    [plan.components, plan.networks]
  )
  const { componentBoxes, networkBoxes, guests, topLevel, enclosures } =
    savedLayout
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
    ...componentBoxes.values(),
    ...networkBoxes.values(),
    ...enclosures.values(),
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

  const flaggedComponents = new Set(
    plan.addressIssues
      ?.filter((issue) => issue.code === "duplicateIpv4")
      .flatMap((issue) => issue.interfaces.map((port) => port.componentId))
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
    return (
      <Button
        key={component.id}
        variant="outline"
        aria-label={component.name}
        aria-description={
          flaggedComponents.has(component.id)
            ? "IPv4 address conflict"
            : undefined
        }
        aria-haspopup="dialog"
        className={`pointer-events-auto absolute z-20 flex-col items-start gap-1 px-4 py-3 text-left whitespace-normal transition-colors ${canEdit ? movable : ""}`}
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
        {flaggedComponents.has(component.id) && (
          <IconAlertTriangle
            role="img"
            aria-label="IPv4 address conflict"
            className="absolute -top-2 -right-2 size-5 border bg-background text-destructive"
          />
        )}
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
          {plan.networks.map((network) => {
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
