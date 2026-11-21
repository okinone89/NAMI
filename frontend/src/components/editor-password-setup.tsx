import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { FieldError, FieldGroup } from "@/components/ui/field"
import {
  EditorPasswordField,
  editorPasswordLengthHelp,
} from "@/components/editor-password-field"
import { editorSetupUrl, type EditorSession } from "@/hooks/use-editor-session"

export function EditorPasswordSetup({
  onCreated,
  onAlreadyConfigured,
}: {
  onCreated: (session: EditorSession) => void
  onAlreadyConfigured: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function createPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const password = fields.get("password")
    const confirmation = fields.get("confirmation")
    if (password !== confirmation) {
      setError("Passwords do not match.")
      return
    }

    setBusy(true)
    setError("")
    try {
      const response = await fetch(editorSetupUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
      })
      if (response.status === 409) {
        onAlreadyConfigured()
      } else if (response.status === 400) {
        const problem = await response.json()
        setError(problem.title)
      } else if (response.ok) {
        onCreated(await response.json())
      } else {
        throw new Error("Editor password setup failed")
      }
    } catch {
      setError("Unable to create the editor password. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-svh place-items-center px-4 py-8">
      <section
        aria-labelledby="setup-title"
        className="w-full max-w-md border bg-card p-6 sm:p-8"
      >
        <div className="mb-5 flex items-center gap-3">
          <img src="/nami-switch.svg" alt="" width="34" height="34" />
          <strong className="tracking-wide">NAMI</strong>
        </div>
        <h1 id="setup-title" className="text-2xl font-medium tracking-tight">
          Create editor password
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Anyone with this password can edit plans in this workspace.
        </p>
        <form onSubmit={createPassword} className="mt-6 flex flex-col gap-5">
          <FieldGroup>
            <EditorPasswordField
              name="password"
              label="Editor password"
              autoComplete="new-password"
              description={editorPasswordLengthHelp}
              disabled={busy}
              errorId={error ? "setup-error" : undefined}
            />
            <EditorPasswordField
              name="confirmation"
              label="Confirm password"
              autoComplete="new-password"
              disabled={busy}
              errorId={error ? "setup-error" : undefined}
            />
            <FieldError id="setup-error">{error}</FieldError>
          </FieldGroup>
          <Button type="submit" className="min-h-11 self-end" disabled={busy}>
            {busy ? "Creating password…" : "Create password"}
          </Button>
        </form>
      </section>
    </main>
  )
}
