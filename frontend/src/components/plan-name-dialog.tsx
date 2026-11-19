import { useId, useState, type FormEvent, type ReactNode } from "react"
import { AddressSaveFeedback } from "@/components/ipv4-issues"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type Props = {
  title: string
  label: string
  action: string
  name?: string
  children?: ReactNode
  onClose: () => void
  onSave: (name: string, fields: FormData) => Promise<void>
}

export function PlanNameDialog({
  title,
  label,
  action,
  name,
  children,
  onClose,
  onSave,
}: Props) {
  const fieldId = useId()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const value = String(fields.get("name")).trim()
    if (!value) {
      setFailure(new Error(`Enter a ${label.toLowerCase()}.`))
      return
    }

    setFailure(undefined)
    setBusy(true)
    try {
      await onSave(value, fields)
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
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={submit}
          onChange={() => setFailure(undefined)}
        >
          <FieldGroup>
            <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
              <Field>
                <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
                <Input
                  id={fieldId}
                  name="name"
                  defaultValue={name}
                  required
                  className="min-h-11"
                />
              </Field>
              {children}
            </fieldset>
          </FieldGroup>
          <AddressSaveFeedback
            failure={failure}
            fallback="Unable to save. Try again."
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
              {action}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
