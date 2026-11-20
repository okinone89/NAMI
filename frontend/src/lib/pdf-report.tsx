import { jsPDF } from "jspdf"
import { autoTable } from "jspdf-autotable"
import "svg2pdf.js"
import { zipSync } from "fflate"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { DiagramLinks } from "@/components/diagram-links"
import { AppearanceMark } from "@/components/diagram-component-label"
import type { PlanFilter } from "@/hooks/use-plan-filter"
import { layoutDiagram } from "./diagram-layout"
import { scopedDiagram } from "./diagram-scope"
import { searchDiagram } from "./diagram-search"
import { columns, interfaceRows } from "./interface-rows"
import { subnetMask } from "./ipv4-subnet"
import { networkColor } from "./network-color"
import type { Plan } from "./plans"

export type ReportView = "Diagram" | "Table" | "Both"
const margin = 32

async function addDiagram(
  doc: jsPDF,
  plan: Plan,
  filter: PlanFilter,
  top: number
) {
  const matches = searchDiagram(plan, filter.query).filter(
    (r) =>
      !filter.networkIds.length ||
      (r.networkId !== null && filter.networkIds.includes(r.networkId))
  )
  const { layout } = scopedDiagram(
    plan,
    layoutDiagram(plan.components, plan.interfaces, plan.networks),
    filter.networkIds,
    filter.query.trim() ? new Set(matches.map((r) => r.componentId)) : undefined
  )
  if (!layout.componentBoxes.size) {
    doc.text("No matching components", margin, top + 12)
    return
  }
  const networks = new Map(plan.networks.map((n) => [n.id, n]))
  const byId = new Map(plan.components.map((c) => [c.id, c]))
  const frame = document.createElement("div")
  frame.style.cssText =
    "position:fixed;left:-100000px;top:0;pointer-events:none;background:white;color:black"
  frame.setAttribute("aria-hidden", "true")
  document.body.append(frame)
  const root = createRoot(frame)
  try {
    flushSync(() =>
      root.render(
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fontFamily="Helvetica"
          fontSize={12}
          fill="#202830"
        >
          <g>
            {Array.from(layout.enclosures, ([id, box]) => (
              <g key={id}>
                <rect {...box} fill="#f0f2f4" stroke="#9ca3af" />
                <text x={box.x + 8} y={box.y + 18}>
                  Hosted VMs
                </text>
              </g>
            ))}
            <DiagramLinks
              forExport
              plan={plan}
              focusedNetworkIds={filter.networkIds}
              layerRef={null}
              boxes={layout.componentBoxes}
              hostEnclosures={layout.enclosures}
              width={0}
              height={0}
              onSelectLink={() => {}}
            />
            {Array.from(layout.componentBoxes, ([id, box]) => {
              const component = byId.get(id)!
              const ports = plan.interfaces.filter(
                (p) =>
                  p.componentId === id &&
                  (!filter.networkIds.length ||
                    (p.networkId !== null &&
                      filter.networkIds.includes(p.networkId)))
              )
              let portY = 54
              const appearance = component.appearance
              return (
                <g key={id} transform={`translate(${box.x} ${box.y})`}>
                  <rect
                    width={box.width}
                    height={box.height}
                    fill="white"
                    stroke="#52606d"
                  />
                  <svg x={8} y={10} width={25} height={25} viewBox="0 0 24 24">
                    {appearance?.kind === "custom" ? (
                      <image
                        href={appearance.imageData}
                        width={24}
                        height={24}
                      />
                    ) : (
                      <AppearanceMark component={component} />
                    )}
                  </svg>
                  <text x={40} y={20} fontSize={13}>
                    {fit(component.name, box.width - 48, 13)}
                  </text>
                  <text x={40} y={39} fill="#475569">
                    {fit(
                      (appearance?.kind === "shape" && appearance.label) ||
                        component.type,
                      box.width - 48,
                      12
                    )}
                  </text>
                  {ports.map((p) => {
                    const network = networks.get(p.networkId ?? "")
                    const mask = subnetMask(network?.subnet)
                    const y = portY
                    portY += mask ? 40 : 28
                    return (
                      <g key={p.id} transform={`translate(8 ${y})`}>
                        <rect
                          width={3}
                          height={mask ? 36 : 24}
                          fill={
                            p.networkId ? networkColor(p.networkId) : "#94a3b8"
                          }
                        />
                        <text x={8} y={10} fontSize={11}>
                          {fit(
                            network?.name ?? "No network",
                            box.width - 24,
                            11
                          )}
                        </text>
                        <text x={8} y={23} fontSize={11}>
                          {p.ipv4 ?? "Unassigned"}
                        </text>
                        {mask && (
                          <text x={8} y={35} fontSize={11}>
                            Mask {mask}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </g>
        </svg>
      )
    )
    const svg = frame.querySelector("svg")!
    // svg2pdf accepts hex colors but drops the CSS HSL used by the canvas.
    const colors = document.createElement("canvas").getContext("2d")!
    for (const attribute of ["stroke", "fill"]) {
      for (const element of svg.querySelectorAll(`[${attribute}^="hsl("]`)) {
        colors.fillStyle = element.getAttribute(attribute)!
        element.setAttribute(attribute, colors.fillStyle)
      }
    }
    const b = svg.getBBox()
    const w = b.width + 12,
      h = b.height + 12
    svg.setAttribute("viewBox", [b.x - 6, b.y - 6, w, h].join(" "))
    const scale = Math.min(
      (doc.internal.pageSize.width - 2 * margin) / w,
      (doc.internal.pageSize.height - top - margin) / h,
      1
    )
    svg.setAttribute("width", String(w * scale))
    svg.setAttribute("height", String(h * scale))
    await doc.svg(svg, { x: margin, y: top })
  } finally {
    root.unmount()
    frame.remove()
  }

  function fit(value: string, width: number, size: number) {
    doc.setFontSize(size)
    if (doc.getTextWidth(value) <= width) return value
    const first = String(
      doc.splitTextToSize(value, width - doc.getTextWidth("..."))[0]
    )
    return first + "..."
  }
}

async function report(plan: Plan, view: ReportView, filters: PlanFilter[]) {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
    compress: true,
  })
  doc.setProperties({ title: plan.name })
  for (const [index, filter] of filters.entries()) {
    if (index > 0) doc.addPage()
    await addSection(doc, plan, view, filter)
  }
  return new Uint8Array(doc.output("arraybuffer"))
}

async function addSection(
  doc: jsPDF,
  plan: Plan,
  view: ReportView,
  filter: PlanFilter
) {
  const scope =
    plan.networks
      .filter((n) => filter.networkIds.includes(n.id))
      .map((n) => n.name)
      .join(", ") || "All networks"
  function heading(section: string) {
    doc.setFontSize(17)
    const title = doc.splitTextToSize(
      plan.name,
      doc.internal.pageSize.width - 2 * margin
    )
    doc.text(title, margin, margin + 12)
    doc.setFontSize(11)
    const y = margin + 20 * title.length + 10
    const lines = doc.splitTextToSize(
      [section, scope, filter.query.trim() && "Search: " + filter.query.trim()]
        .filter(Boolean)
        .join("  /  "),
      doc.internal.pageSize.width - 2 * margin
    )
    doc.text(lines, margin, y)
    return y + 14 * lines.length + 8
  }
  if (view !== "Table")
    await addDiagram(doc, plan, filter, heading("Network diagram"))
  if (view !== "Diagram") {
    if (view === "Both") doc.addPage()
    const top = heading("Interface table")
    const { rows, withoutInterfaces } = interfaceRows(plan, filter)
    const body = rows.map((row) => columns.map((c) => row[c.key] || "—"))
    for (const c of withoutInterfaces)
      body.push([c.name, c.type, "No interfaces", "—", "—", "—"])
    if (body.length)
      autoTable(doc, {
        startY: top,
        margin,
        head: [columns.map((c) => c.label)],
        body,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [45, 62, 76] },
        rowPageBreak: "avoid",
      })
    else doc.text("No matching interfaces or components", margin, top + 12)
  }
}

function fileName(value: string) {
  return (
    value
      .replace(/[^\p{L}\p{N} _.-]+/gu, "-")
      .slice(0, 100)
      .trim()
      .replace(/[. ]+$/, "") || "Plan"
  )
}

export async function exportReport(
  plan: Plan,
  view: ReportView,
  scope: string,
  filter: PlanFilter,
  selectedIds: string[]
) {
  let blob: Blob
  let name = fileName(plan.name)
  if (scope === "separate") {
    const files: Record<string, Uint8Array> = {}
    for (const [i, network] of plan.networks.entries()) {
      files[i + 1 + "-" + fileName(network.name) + ".pdf"] = await report(
        plan,
        view,
        [{ networkIds: [network.id], query: "" }]
      )
    }
    blob = new Blob([new Uint8Array(zipSync(files, { level: 0 }))], {
      type: "application/zip",
    })
    name += "-networks.zip"
  } else if (scope === "selected") {
    const filters = plan.networks
      .filter((n) => selectedIds.includes(n.id))
      .map((n) => ({ networkIds: [n.id], query: "" }))
    if (!filters.length) throw new Error("Choose at least one network.")
    blob = new Blob([await report(plan, view, filters)], {
      type: "application/pdf",
    })
    name += "-selected-networks.pdf"
  } else {
    const applied =
      scope === "current"
        ? filter
        : {
            query: "",
            networkIds: scope.startsWith("network:") ? [scope.slice(8)] : [],
          }
    const network = plan.networks.find(
      (n) => applied.networkIds.length === 1 && n.id === applied.networkIds[0]
    )
    if (network) name += "-" + fileName(network.name)
    blob = new Blob([await report(plan, view, [applied])], {
      type: "application/pdf",
    })
    name += ".pdf"
  }
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
