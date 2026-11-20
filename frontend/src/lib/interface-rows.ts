import type { Plan } from "./plans"
import type { PlanFilter } from "@/hooks/use-plan-filter"
import { profileSummary } from "./protocol-profiles"

export const columns = [
  { key: "component", label: "Component" },
  { key: "type", label: "Component type" },
  { key: "interface", label: "Interface" },
  { key: "network", label: "Network" },
  { key: "ipv4", label: "IPv4 address" },
  { key: "protocol", label: "Protocols" },
] as const

export function interfaceRows(plan: Plan, { query, networkIds }: PlanFilter) {
  const components = new Map(
    plan.components.map((component) => [component.id, component])
  )
  const networks = new Map(
    plan.networks.map((network) => [network.id, network.name])
  )
  const withInterfaces = new Set(
    plan.interfaces.map((port) => port.componentId)
  )
  const withoutInterfaces = plan.components.filter(
    (component) =>
      !networkIds.length &&
      !withInterfaces.has(component.id) &&
      [component.name, component.type].some((v) =>
        v.toLowerCase().includes(query.trim().toLowerCase())
      )
  )
  const filter = query.trim().toLocaleLowerCase()
  const rows = plan.interfaces
    .filter(
      (port) =>
        !networkIds.length ||
        (port.networkId !== null && networkIds.includes(port.networkId))
    )
    .map((port) => {
      const component = components.get(port.componentId)
      return {
        port,
        component: component?.name ?? "",
        type: component?.type ?? "",
        interface: port.name,
        network: port.networkId ? (networks.get(port.networkId) ?? "") : "",
        ipv4: port.ipv4 ?? "",
        protocol: profileSummary(port.protocolProfiles),
      }
    })
    .filter((row) =>
      [
        row.component,
        row.type,
        row.interface,
        row.network,
        row.ipv4,
        row.protocol,
      ].some((value) => value.toLocaleLowerCase().includes(filter))
    )

  return { components, withoutInterfaces, rows }
}
