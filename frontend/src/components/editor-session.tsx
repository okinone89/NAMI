import {
  IconChevronDown,
  IconLogin,
  IconLogout,
  IconSettings,
  IconLockOpen,
  IconX,
} from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { useState, type ReactNode, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import {
  readOnly,
  sessionUrl,
  type useEditorSession,
} from "@/hooks/use-editor-session"

export function WorkspaceMenu({
  session,
  children,
}: {
  children: ReactNode
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

  return (
    <>
      <div className="ml-auto flex items-center gap-3">
        {session.canEdit && (
          <span className="text-xs text-muted-foreground">
            Editing unlocked
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" className="min-h-11" />}
          >
            <IconSettings aria-hidden="true" /> Workspace{" "}
            <IconChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {children}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {session.canEdit ? (
                <DropdownMenuItem disabled={busy} onClick={signOut}>
                  <IconLogout aria-hidden="true" /> Sign out
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => {
                    setError("")
                    setDialogOpen(true)
                  }}
                >
                  <IconLogin aria-hidden="true" /> Unlock editing
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {session.canEdit && error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open, details) => {
          if (busy) return details.cancel()
          setDialogOpen(open)
        }}
      >
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
                <IconX aria-hidden="true" /> Cancel
              </Button>
              <Button type="submit" className="min-h-11" disabled={busy}>
                <IconLockOpen aria-hidden="true" /> Unlock editing
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
