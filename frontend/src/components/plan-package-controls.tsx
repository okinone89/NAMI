import { IconUpload, IconX } from "@tabler/icons-react"
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
export function PlanPackageImport({
  onImport,
  onClose,
}: {
  onImport: (file: File) => Promise<void>
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
              <IconX aria-hidden="true" data-icon="inline-start" /> Cancel
            </Button>
            <Button type="submit" disabled={busy} className="min-h-11">
              <IconUpload aria-hidden="true" data-icon="inline-start" />{" "}
              {busy ? "Importing…" : "Import plan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
