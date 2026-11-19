import { linkEndpointLabel, linkMediumLabels } from "@/lib/link-labels"
import type { DiagramBox } from "@/lib/diagram-layout"
import type { DiagramPosition, LinkMedium, Plan, PlanLink } from "@/lib/plans"

const strokePatterns: Record<LinkMedium, string | undefined> = {
  wired: undefined,
  wireless: "9 6",
  virtual: "1 6",
}

function center(box: DiagramBox) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function anchor(box: DiagramBox, toward: DiagramPosition) {
  const from = center(box)
  const dx = toward.x - from.x
  const dy = toward.y - from.y
  const proportion = Math.max(
    Math.abs(dx) / (box.width / 2),
    Math.abs(dy) / (box.height / 2)
  )
  return proportion
    ? { x: from.x + dx / proportion, y: from.y + dy / proportion }
    : from
}

function linkPath(
  source: DiagramBox,
  target: DiagramBox,
  lane: number,
  index: number
) {
  const from = center(source)
  const to = center(target)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)

  if (distance === 0) {
    const overhang = 35 + index * 24
    const right = source.x + source.width
    const bottom = source.y + source.height
    return {
      path: `M ${right} ${from.y} C ${right + overhang} ${from.y}, ${right + overhang} ${bottom + overhang}, ${from.x} ${bottom}`,
      midpoint: {
        x: (right + 6 * (right + overhang) + from.x) / 8,
        y: (4 * from.y + 4 * bottom + 3 * overhang) / 8,
      },
    }
  }

  const control = {
    x: (from.x + to.x) / 2 - (dy / distance) * lane,
    y: (from.y + to.y) / 2 + (dx / distance) * lane,
  }
  const start = anchor(source, control)
  const end = anchor(target, control)
  return {
    path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
    midpoint: {
      x: (start.x + 2 * control.x + end.x) / 4,
      y: (start.y + 2 * control.y + end.y) / 4,
    },
  }
}

type Props = {
  plan: Plan
  boxes: ReadonlyMap<string, DiagramBox>
  width: number
  height: number
  onSelectLink: (id: string) => void
}

export function DiagramLinks({
  plan,
  boxes,
  width,
  height,
  onSelectLink,
}: Props) {
  const components = new Map(plan.components.map(({ id, name }) => [id, name]))
  const interfaces = new Map(plan.interfaces.map(({ id, name }) => [id, name]))
  const linkGroups = new Map<string, PlanLink[]>()
  for (const link of plan.links) {
    const key = JSON.stringify(
      [link.source.componentId, link.target.componentId].sort()
    )
    const group = linkGroups.get(key)
    if (group) group.push(link)
    else linkGroups.set(key, [link])
  }

  return (
    <svg
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
    >
      {Array.from(linkGroups.values()).flatMap((links) =>
        links.map((link, index) => {
          const source = boxes.get(link.source.componentId)
          const target = boxes.get(link.target.componentId)
          if (!source || !target) return null
          const direction =
            link.source.componentId <= link.target.componentId ? 1 : -1
          const lane = (index - (links.length - 1) / 2) * 48 * direction
          const { path, midpoint } = linkPath(source, target, lane, index)
          const from = linkEndpointLabel(link.source, components, interfaces)
          const to = linkEndpointLabel(link.target, components, interfaces)
          const label = `${from} to ${to} (${linkMediumLabels[link.medium]})`
          return (
            <g
              key={link.id}
              role="button"
              aria-label={label}
              tabIndex={0}
              className="group cursor-pointer outline-none"
              onClick={() => onSelectLink(link.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onSelectLink(link.id)
                }
              }}
            >
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
                stroke="currentColor"
                strokeWidth={2}
                strokeDasharray={strokePatterns[link.medium]}
                strokeLinecap={link.medium === "virtual" ? "round" : "butt"}
                className="group-hover:stroke-4 group-focus-visible:stroke-4"
              />
            </g>
          )
        })
      )}
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
