import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import {
  readOnly,
  sessionUrl,
  type useEditorSession,
} from "@/hooks/use-editor-session"

export function EditorSessionControls({
  session,
}: {
  session: ReturnType<typeof useEditorSession>
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const passphrase = new FormData(event.currentTarget).get("passphrase")
    setBusy(true)
    setError("")
    try {
      const response = await fetch(sessionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      })
      if (!response.ok) {
        setError(
          response.status === 401
            ? "Incorrect editor passphrase."
            : response.status === 503
              ? "Editing is unavailable on this deployment."
              : "Unable to unlock editing. Try again."
        )
        return
      }
      session.apply(await response.json())
      setDialogOpen(false)
    } catch {
      setError("Unable to unlock editing. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    setError("")
    try {
      const response = await fetch(sessionUrl, { method: "DELETE" })
      if (!response.ok) throw new Error("Sign-out failed")
      session.apply(readOnly)
    } catch {
      setError("Unable to sign out. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return session.canEdit ? (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs">
      <span>Editing unlocked</span>
      <Button
        variant="outline"
        className="min-h-11"
        disabled={busy}
        onClick={signOut}
      >
        Sign out
      </Button>
      {error && (
        <p role="alert" className="basis-full text-right text-destructive">
          {error}
        </p>
      )}
    </div>
  ) : (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open, details) => {
        if (busy) {
          details.cancel()
          return
        }
        setError("")
        setDialogOpen(open)
      }}
    >
      <DialogTrigger
        render={<Button variant="outline" className="ml-auto min-h-11" />}
      >
        Unlock editing
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Unlock editing</DialogTitle>
        </DialogHeader>
        <form onSubmit={unlock} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="editor-passphrase">
                Shared editor passphrase
              </FieldLabel>
              <Input
                id="editor-passphrase"
                name="passphrase"
                type="password"
                autoComplete="current-password"
                required
                disabled={busy}
                aria-invalid={!!error}
                aria-describedby={error ? "editor-session-error" : undefined}
                className="min-h-11"
              />
              {error && (
                <p
                  id="editor-session-error"
                  role="alert"
                  className="text-destructive"
                >
                  {error}
                </p>
              )}
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="min-h-11" disabled={busy}>
              Unlock editing
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
