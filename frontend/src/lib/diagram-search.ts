import { profileSummary } from "./protocol-profiles"
import type { Plan, PlanInterface } from "@/lib/plans"

export type DiagramSearchResult = {
  componentId: string
  componentName: string
  networkId: string | null
  networkName: string
}

export function searchDiagram(
  plan: Plan,
  query: string
): DiagramSearchResult[] {
  const term = query.trim().toLowerCase()
  if (!term) return []

  const networkNames = new Map(plan.networks.map(({ id, name }) => [id, name]))
  const interfaces = new Map<string, PlanInterface[]>()
  for (const port of plan.interfaces) {
    const current = interfaces.get(port.componentId)
    if (current) current.push(port)
    else interfaces.set(port.componentId, [port])
  }
  return plan.components.flatMap((component) => {
    const ports = interfaces.get(component.id) ?? []
    const matchesType = [component.type, component.name].some((value) =>
      value.toLowerCase().includes(term)
    )
    const matches = matchesType
      ? ports
      : ports.filter((port) =>
          [
            port.name,
            port.ipv4,
            networkNames.get(port.networkId ?? ""),
            profileSummary(port.protocolProfiles),
          ].some((value) => value?.toLowerCase().includes(term))
        )
    const networkIds = new Set(matches.map(({ networkId }) => networkId))
    if (matchesType && networkIds.size === 0) networkIds.add(null)
    return Array.from(networkIds, (networkId) => ({
      componentId: component.id,
      componentName: component.name,
      networkId,
      networkName: networkNames.get(networkId ?? "") ?? "No network assigned",
    }))
  })
}
