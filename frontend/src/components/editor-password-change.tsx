import { useId, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldError, FieldGroup } from "@/components/ui/field"
import {
  EditorPasswordField,
  editorPasswordLengthHelp,
} from "@/components/editor-password-field"
import { sessionUrl, type EditorSession } from "@/hooks/use-editor-session"

export function EditorPasswordChange({
  onClose,
  onChanged,
  onSessionLost,
}: {
  onClose: () => void
  onChanged: (session: EditorSession) => void
  onSessionLost: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{
    message: string
    field?: "current" | "new"
  }>()
  const errorId = useId()

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const currentPassword = fields.get("currentPassword")
    const newPassword = fields.get("newPassword")
    const confirmation = fields.get("confirmation")
    if (newPassword !== confirmation) {
      setError({ message: "Passwords do not match.", field: "new" })
      return
    }

    setBusy(true)
    setError(undefined)
    try {
      const response = await fetch(`${sessionUrl}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmation }),
      })
      if (response.status === 401 || response.status === 409) {
        onSessionLost()
      } else if (response.status === 400 || response.status === 403) {
        const problem: { title?: string } = await response.json()
        setError({
          message: problem.title ?? "Check the passwords and try again.",
          field: response.status === 403 ? "current" : "new",
        })
      } else if (response.ok) {
        onChanged(await response.json())
      } else {
        throw new Error("Password change failed")
      }
    } catch {
      setError({ message: "Unable to change the editor password. Try again." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (busy) return details.cancel()
        if (!open) onClose()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Change editor password</DialogTitle>
          <DialogDescription>
            Other editors will need the new password to unlock editing again.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={changePassword} className="flex flex-col gap-4">
          <FieldGroup>
            <EditorPasswordField
              name="currentPassword"
              label="Current password"
              autoComplete="current-password"
              disabled={busy}
              errorId={error?.field === "current" ? errorId : undefined}
            />
            <EditorPasswordField
              name="newPassword"
              label="New password"
              autoComplete="new-password"
              description={editorPasswordLengthHelp}
              disabled={busy}
              errorId={error?.field === "new" ? errorId : undefined}
            />
            <EditorPasswordField
              name="confirmation"
              label="Confirm new password"
              autoComplete="new-password"
              disabled={busy}
              errorId={error?.field === "new" ? errorId : undefined}
            />
            <FieldError id={errorId}>{error?.message}</FieldError>
          </FieldGroup>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" className="min-h-11" disabled={busy}>
              {busy ? "Changing password…" : "Change password"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
