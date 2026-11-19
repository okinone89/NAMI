import { useId, useState, type FormEvent } from "react"
import { AddressSaveFeedback } from "@/components/ipv4-issues"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { PlanSummary } from "@/lib/plans"

type Props = {
  plan?: PlanSummary
  onExport: (id: string) => Promise<Blob>
  onImport: (file: File) => Promise<void>
}

export function PlanPackageControls({ plan, onExport, onImport }: Props) {
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<unknown>()

  async function download() {
    if (!plan) return
    setExportError(undefined)
    setExporting(true)
    try {
      const url = URL.createObjectURL(await onExport(plan.id))
      const link = document.createElement("a")
      link.href = url
      link.download = `${plan.name}.nami.json`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (error) {
      setExportError(error)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      {plan && (
        <Button
          variant="outline"
          className="min-h-11"
          disabled={exporting}
          onClick={download}
        >
          {exporting ? "Exporting…" : "Export plan"}
        </Button>
      )}
      <Button
        variant="outline"
        className="min-h-11"
        onClick={() => setImporting(true)}
      >
        Import plan
      </Button>
      <AddressSaveFeedback
        failure={exportError}
        fallback="Unable to export the plan. Try again."
        disabled={exporting}
      />
      {importing && (
        <PlanPackageImport
          onImport={onImport}
          onClose={() => setImporting(false)}
        />
      )}
    </>
  )
}

function PlanPackageImport({
  onImport,
  onClose,
}: {
  onImport: Props["onImport"]
  onClose: () => void
}) {
  const fieldId = useId()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = new FormData(event.currentTarget).get("package")
    if (!(file instanceof File) || !file.size) {
      setFailure(new Error("Choose a NAMI plan package."))
      return
    }

    setFailure(undefined)
    setBusy(true)
    try {
      await onImport(file)
      onClose()
    } catch (error) {
      setFailure(error)
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Import plan</DialogTitle>
          <DialogDescription>
            Choose a NAMI package to create a new copy of the plan.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor={fieldId}>Plan package</FieldLabel>
            <Input
              id={fieldId}
              name="package"
              type="file"
              accept=".json,application/json"
              className="min-h-11"
              required
              disabled={busy}
              onChange={() => setFailure(undefined)}
            />
          </Field>
          <AddressSaveFeedback
            failure={failure}
            fallback="Unable to import the plan. Try again."
            disabled={busy}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
              className="min-h-11"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="min-h-11">
              {busy ? "Importing…" : "Import plan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
