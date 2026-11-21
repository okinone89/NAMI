import { useCallback, useEffect, useRef, useState } from "react"

export const sessionUrl = "/api/editor-session"
export const editorSetupUrl = `${sessionUrl}/setup`
export type EditorSession = {
  canEdit: boolean
  expiresAt: string | null
  setupRequired: boolean
}
export const readOnly: EditorSession = {
  canEdit: false,
  expiresAt: null,
  setupRequired: false,
}

export function useEditorSession() {
  const [session, setSession] = useState<EditorSession | null>(null)
  const [checkFailed, setCheckFailed] = useState(false)
  const activeCheck = useRef<AbortController | null>(null)

  const refresh = useCallback(() => {
    activeCheck.current?.abort()
    const check = new AbortController()
    activeCheck.current = check
    return fetch(sessionUrl, { signal: check.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Editor session check failed")
        return response.json() as Promise<EditorSession>
      })
      .then((current) => {
        if (check.signal.aborted) return
        setCheckFailed(false)
        setSession(current)
      })
      .catch(() => {
        if (check.signal.aborted) return
        setCheckFailed(true)
        setSession((previous) =>
          previous?.canEdit
            ? { ...previous, canEdit: false, expiresAt: null }
            : previous
        )
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
    if (!session?.expiresAt) return
    const remaining = Date.parse(session.expiresAt) - Date.now()
    const timer = window.setTimeout(
      () => void refresh(),
      Math.max(1_000, remaining)
    )
    return () => window.clearTimeout(timer)
  }, [session, refresh])

  function apply(next: EditorSession) {
    activeCheck.current?.abort()
    setCheckFailed(false)
    setSession(next)
  }

  return {
    session,
    canEdit: session?.canEdit ?? false,
    checkFailed,
    apply,
    refresh,
  }
}
