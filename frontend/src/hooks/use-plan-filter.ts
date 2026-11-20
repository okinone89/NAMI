import { useState } from "react"

export type PlanFilter = { query: string; networkId: string | null }

function read(key: string): PlanFilter {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null")
    if (
      typeof saved?.query === "string" &&
      (saved.networkId === null || typeof saved.networkId === "string")
    )
      return saved
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  return { query: "", networkId: null }
}

export function usePlanFilter(planId?: string) {
  const key = `nami:plan-filter:v1:${planId ?? ""}`
  const [state, setState] = useState(() => ({ key, value: read(key) }))
  const value = state.key === key ? state.value : read(key)
  if (state.key !== key) setState({ key, value })
  function update(changes: Partial<PlanFilter>) {
    const next = { ...value, ...changes }
    setState({ key, value: next })
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      /* Keep the in-memory filter. */
    }
  }
  return { value, update }
}
