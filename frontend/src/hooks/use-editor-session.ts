import { useCallback, useEffect, useRef, useState } from "react"

export const sessionUrl = "/api/editor-session"
type EditorSession = { canEdit: boolean; expiresAt: string | null }
export const readOnly: EditorSession = { canEdit: false, expiresAt: null }

export function useEditorSession() {
  const [session, setSession] = useState(readOnly)
  const activeCheck = useRef<AbortController | null>(null)

  const refresh = useCallback(() => {
    activeCheck.current?.abort()
    const check = new AbortController()
    activeCheck.current = check
    return fetch(sessionUrl, { signal: check.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : readOnly))
      .then((current) => {
        if (!check.signal.aborted) setSession(current)
      })
      .catch(() => {
        if (!check.signal.aborted) setSession(readOnly)
      })
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    return () => {
      activeCheck.current?.abort()
      window.removeEventListener("focus", onFocus)
    }
  }, [refresh])

  useEffect(() => {
    if (!session.expiresAt) return
    const remaining = Date.parse(session.expiresAt) - Date.now()
    const timer = window.setTimeout(
      () => void refresh(),
      Math.max(1_000, remaining)
    )
    return () => window.clearTimeout(timer)
  }, [session, refresh])

  function apply(next: EditorSession) {
    activeCheck.current?.abort()
    setSession(next)
  }

  return { canEdit: session.canEdit, apply, refresh }
}
