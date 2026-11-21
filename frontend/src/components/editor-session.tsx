import {
  IconChevronDown,
  IconEye,
  IconPencil,
  IconSettings,
  IconLockOpen,
  IconX,
} from "@tabler/icons-react"
import { Tooltip } from "@base-ui/react/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useId, useState, type ReactNode, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import {
  readOnly,
  sessionUrl,
  type EditorSession,
} from "@/hooks/use-editor-session"

export function WorkspaceMenu({
  session,
  onUnlock,
  children,
}: {
  children: ReactNode
  session: { canEdit: boolean; apply: (session: EditorSession) => void }
  onUnlock: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const modeTooltipId = useId()
  const ModeIcon = session.canEdit ? IconPencil : IconEye

  function unlockEditing() {
    setError("")
    onUnlock()
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
        <Tooltip.Root>
          <Tooltip.Trigger
            delay={300}
            render={
              <Button
                type="button"
                variant={session.canEdit ? "default" : "secondary"}
                className="min-h-11 enabled:cursor-pointer"
                aria-describedby={modeTooltipId}
                aria-haspopup={session.canEdit ? undefined : "dialog"}
                aria-live="polite"
                disabled={busy}
                onClick={session.canEdit ? signOut : unlockEditing}
              />
            }
          >
            <ModeIcon aria-hidden="true" data-icon="inline-start" />
            {session.canEdit ? "Edit mode" : "View mode"}
          </Tooltip.Trigger>
          <Tooltip.Portal keepMounted>
            <Tooltip.Positioner side="bottom" sideOffset={6} className="z-50">
              <Tooltip.Popup
                id={modeTooltipId}
                role="tooltip"
                className="bg-foreground px-2.5 py-1.5 text-xs whitespace-nowrap text-background shadow-sm"
              >
                {session.canEdit ? "Sign out" : "Unlock editing"}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" className="min-h-11" />}
          >
            <IconSettings aria-hidden="true" /> Workspace{" "}
            <IconChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {children}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {session.canEdit && error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </>
  )
}

export function EditorUnlockDialog({
  onClose,
  onUnlocked,
  onSetupRequired,
  setupCompletedElsewhere,
}: {
  onClose: () => void
  onUnlocked: (session: EditorSession) => void
  onSetupRequired: () => void
  setupCompletedElsewhere: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const password = new FormData(event.currentTarget).get("password")
    setBusy(true)
    setError("")
    try {
      const response = await fetch(sessionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (response.status === 409) {
        onSetupRequired()
        return
      }
      if (response.status === 400) {
        const problem = await response.json()
        setError(problem.title)
        return
      }
      if (!response.ok) {
        setError(
          response.status === 401
            ? "Incorrect editor password."
            : "Unable to unlock editing. Try again."
        )
        return
      }
      onUnlocked(await response.json())
    } catch {
      setError("Unable to unlock editing. Try again.")
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
          <DialogTitle>Unlock editing</DialogTitle>
          {setupCompletedElsewhere && (
            <DialogDescription>
              Another visitor created the editor password.
            </DialogDescription>
          )}
        </DialogHeader>
        <form onSubmit={unlock} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="editor-password">
                Shared editor password
              </FieldLabel>
              <Input
                id="editor-password"
                name="password"
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
              onClick={onClose}
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
  )
}
