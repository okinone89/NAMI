import { useState } from "react"
import { Button } from "./ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
import type { PlanFilter } from "@/hooks/use-plan-filter"
import type { Plan } from "@/lib/plans"
import type { ReportView } from "@/lib/pdf-report"

export function PdfExport({
  plan,
  view,
  filter,
}: {
  plan: Plan
  view: "Diagram" | "Table"
  filter: PlanFilter
}) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState<ReportView>(view)
  const storageKey = "nami:pdf-scope:v1:" + plan.id
  const [selectedScope, setScope] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? "current"
    } catch {
      return "current"
    }
  })
  const networksKey = "nami:pdf-networks:v1:" + plan.id
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(networksKey) ?? "[]"
      )
      return Array.isArray(saved)
        ? saved.filter((id) => typeof id === "string")
        : []
    } catch {
      return []
    }
  })
  function toggleNetwork(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((value) => value !== id)
      : [...selectedIds, id]
    setSelectedIds(next)
    try {
      localStorage.setItem(networksKey, JSON.stringify(next))
    } catch {
      // Keep the in-memory selection when storage is unavailable.
    }
  }
  const scope =
    selectedScope === "all" ||
    ((selectedScope === "separate" || selectedScope === "selected") &&
      plan.networks.length > 0) ||
    plan.networks.some((n) => selectedScope === "network:" + n.id)
      ? selectedScope
      : "current"
  function changeScope(value: string) {
    setScope(value)
    try {
      localStorage.setItem(storageKey, value)
    } catch {
      // The current session can still use the selected scope.
    }
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function download() {
    setBusy(true)
    setError(false)
    try {
      const { exportReport } = await import("@/lib/pdf-report")
      await exportReport(plan, content, scope, filter, selectedIds)
      setOpen(false)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  const selectedNetwork = plan.networks.find((n) => n.id === filter.networkId)
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setContent(view)
          setError(false)
          setOpen(true)
        }}
      >
        Export PDF
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          showCloseButton={!busy}
        >
          <DialogTitle>Export PDF</DialogTitle>
          <DialogDescription>{plan.name}</DialogDescription>
          <label className="grid gap-1">
            Include
            <select
              className="h-11 border bg-background px-2"
              value={content}
              disabled={busy}
              onChange={(e) => setContent(e.target.value as ReportView)}
            >
              <option>Diagram</option>
              <option>Table</option>
              <option value="Both">Diagram and table</option>
            </select>
          </label>
          <label className="grid gap-1">
            Export scope
            <select
              className="h-11 min-w-0 border bg-background px-2"
              value={scope}
              disabled={busy}
              onChange={(e) => changeScope(e.target.value)}
            >
              <option value="current">Current filters</option>
              <option value="all">Whole plan</option>
              {!!plan.networks.length && (
                <>
                  <option value="selected">Selected networks in one PDF</option>
                  <option value="separate">One PDF per network (ZIP)</option>
                </>
              )}
              <optgroup label="Individual network">
                {plan.networks.map((n) => (
                  <option key={n.id} value={"network:" + n.id}>
                    {n.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          {scope === "selected" && (
            <fieldset disabled={busy} className="grid gap-2">
              <legend>Choose networks</legend>
              <p>Each network starts on a new page, in the order shown.</p>
              <div className="max-h-48 overflow-auto border p-2">
                {plan.networks.map((n) => (
                  <label key={n.id} className="flex items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(n.id)}
                      onChange={() => toggleNetwork(n.id)}
                    />
                    {n.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {scope === "current" && (
            <p>
              {selectedNetwork?.name ?? "All networks"}
              {filter.query.trim() && " · Search “" + filter.query.trim() + "”"}
            </p>
          )}
          {scope === "separate" && (
            <p>
              Includes all named networks. Choose Whole plan to include
              unassigned inventory.
            </p>
          )}
          {error && <p role="alert">Could not create the export. Try again.</p>}
          <Button
            disabled={
              busy ||
              (scope === "selected" &&
                !plan.networks.some((n) => selectedIds.includes(n.id)))
            }
            onClick={download}
          >
            {busy
              ? "Preparing export…"
              : scope === "separate"
                ? "Download ZIP"
                : "Download PDF"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
