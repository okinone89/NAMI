import {
  elbowRoute,
  drawRoute,
  laneSpacing,
  segments,
  type Segment,
} from "@/lib/link-routing"
import type { Ref } from "react"
import { networkColor } from "@/lib/network-color"
import { linkEndpointLabel, linkMediumLabels } from "@/lib/link-labels"
import type { DiagramBox } from "@/lib/diagram-layout"
import type { LinkMedium, Plan, PlanLink } from "@/lib/plans"

const strokePatterns: Record<LinkMedium, string | undefined> = {
  wired: undefined,
  wireless: "9 6",
  virtual: "1 6",
}

type Props = {
  forExport?: boolean
  layerRef: Ref<SVGSVGElement>
  plan: Plan
  focusedNetworkId: string | null
  boxes: ReadonlyMap<string, DiagramBox>
  hostEnclosures: ReadonlyMap<string, DiagramBox>
  width: number
  height: number
  onContextLink?: (link: PlanLink, x: number, y: number) => void
  onSelectLink: (id: string) => void
}

export function DiagramLinks({
  layerRef,
  forExport,
  plan,
  boxes,
  hostEnclosures,
  focusedNetworkId,
  width,
  height,
  onSelectLink,
  onContextLink,
}: Props) {
  const components = new Map(plan.components.map(({ id, name }) => [id, name]))
  const interfaces = new Map(plan.interfaces.map(({ id, name }) => [id, name]))
  const ports = new Map(plan.interfaces.map((p) => [p.id, p]))
  const networks = new Map(plan.networks.map((n) => [n.id, n.name]))
  const componentBoxes = Array.from(boxes.values())
  const enclosures = Array.from(hostEnclosures)
  const owner = new Map(plan.components.map((c) => [c.id, c.hostId ?? c.id]))

  const routes = plan.links.flatMap((link) => {
    const source = boxes.get(link.source.componentId),
      target = boxes.get(link.target.componentId)
    if (!source || !target) return []
    const networkIds = [
      ...new Set(
        [link.source, link.target]
          .map((end) => ports.get(end.interfaceId ?? "")?.networkId)
          .filter((id): id is string => !!id)
      ),
    ]
    if (
      focusedNetworkId &&
      networkIds.length &&
      !networkIds.includes(focusedNetworkId)
    )
      return []
    return [{ link, networkIds, source, target }]
  })
  const incident = new Map<string, string[]>()
  for (const { link } of routes) {
    for (const id of new Set([
      link.source.componentId,
      link.target.componentId,
    ])) {
      const ids = incident.get(id)
      if (ids) ids.push(link.id)
      else incident.set(id, [link.id])
    }
  }
  function endpointLane(componentId: string, linkId: string) {
    const ids = incident.get(componentId)!
    const box = boxes.get(componentId)!
    // Spread ports around the edge center, compressing only when the card is full.
    const step = Math.min(
      laneSpacing / (0.36 * Math.min(box.width, box.height)),
      2 / Math.max(1, ids.length - 1)
    )
    return (ids.indexOf(linkId) - (ids.length - 1) / 2) * step
  }
  const occupied: Segment[] = []
  const routed = routes.map(({ link, networkIds, source, target }) => {
    const points = elbowRoute(
      source,
      target,
      [
        ...componentBoxes,
        ...enclosures
          .filter(
            ([hostId]) =>
              hostId !== owner.get(link.source.componentId) &&
              hostId !== owner.get(link.target.componentId)
          )
          .map(([, bounds]) => bounds),
      ],
      endpointLane(link.source.componentId, link.id),
      endpointLane(link.target.componentId, link.id),
      occupied
    )
    const { path, midpoint, bridges } = drawRoute(points, occupied)
    occupied.push(...segments(points))
    return { link, networkIds, path, midpoint, bridges }
  })
  const links = routed.map(({ link, networkIds, path, midpoint, bridges }) => {
    const from = linkEndpointLabel(link.source, components, interfaces)
    const to = linkEndpointLabel(link.target, components, interfaces)
    const networkLabel =
      networkIds.map((id) => networks.get(id)).join(" / ") || "Unassigned"
    const color =
      networkIds.length === 1 ? networkColor(networkIds[0]) : "currentColor"
    const label = `${from} to ${to} (${linkMediumLabels[link.medium]})`
    return (
      <g
        key={link.id}
        role="button"
        aria-label={label}
        tabIndex={0}
        className="group cursor-pointer outline-none"
        onContextMenu={(event) => {
          if (!onContextLink) return
          event.preventDefault()
          onContextLink(link, event.clientX, event.clientY)
        }}
        onClick={() => onSelectLink(link.id)}
        onKeyDown={(event) => {
          if (
            onContextLink &&
            (event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10"))
          ) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            onContextLink(
              link,
              rect.left + rect.width / 2,
              rect.top + rect.height / 2
            )
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onSelectLink(link.id)
          }
        }}
      >
        {bridges.map((d, index) => (
          <path
            key={index}
            d={d}
            fill="none"
            stroke={forExport ? "white" : "var(--background)"}
            strokeWidth={6}
          />
        ))}
        <circle
          cx={midpoint.x}
          cy={midpoint.y}
          r={10}
          fill="transparent"
          pointerEvents="fill"
        />
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={18}
          pointerEvents="stroke"
        />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray={strokePatterns[link.medium]}
          strokeLinecap={link.medium === "virtual" ? "round" : "butt"}
          className="group-hover:stroke-4 group-focus-visible:stroke-4"
        />
        <text
          x={midpoint.x}
          y={midpoint.y - 5}
          textAnchor="middle"
          fontSize="11"
          fill={color}
          stroke={forExport ? "none" : "var(--background)"}
          strokeWidth="3"
          paintOrder="stroke"
          pointerEvents="all"
        >
          {networkLabel}
        </text>
      </g>
    )
  })
  if (forExport) return <g>{links}</g>
  return (
    <svg
      ref={layerRef}
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
    >
      {links}
    </svg>
  )
}

export function LinkLegend() {
  return (
    <ul
      aria-label="Link media"
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
    >
      {(Object.entries(linkMediumLabels) as [LinkMedium, string][]).map(
        ([medium, label]) => (
          <li key={medium} className="flex items-center gap-2">
            <svg width="28" height="10" aria-hidden="true">
              <path
                d="M 1 5 H 27"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeDasharray={strokePatterns[medium]}
                strokeLinecap={medium === "virtual" ? "round" : "butt"}
              />
            </svg>
            {label}
          </li>
        )
      )}
    </ul>
  )
}
