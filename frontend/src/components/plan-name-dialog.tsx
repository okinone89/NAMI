import { useId, useState, type FormEvent } from "react"
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
  onClose: () => void
  onSave: (name: string) => Promise<void>
}

export function PlanNameDialog({
  title,
  label,
  action,
  name,
  onClose,
  onSave,
}: Props) {
  const fieldId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = String(new FormData(event.currentTarget).get("name")).trim()
    if (!value) {
      setError(`Enter a ${label.toLowerCase()}.`)
      return
    }

    setError("")
    setBusy(true)
    try {
      await onSave(value)
      onClose()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to save. Try again."
      )
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
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
              <Input
                id={fieldId}
                name="name"
                defaultValue={name}
                required
                disabled={busy}
                className="min-h-11"
              />
            </Field>
          </FieldGroup>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
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
