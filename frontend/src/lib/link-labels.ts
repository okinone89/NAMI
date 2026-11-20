import type { LinkEndpoint, LinkMedium, Plan, PlanLink } from "@/lib/plans"

export const linkMediumLabels: Record<LinkMedium, string> = {
  wired: "Wired",
  fiberOptic: "Fiber optic",
  wireless: "Wireless",
  virtual: "Virtual",
}

export function linkEndpointLabel(
  endpoint: LinkEndpoint,
  components: ReadonlyMap<string, string>,
  interfaces: ReadonlyMap<string, string>
) {
  const component = components.get(endpoint.componentId)
  const port = endpoint.interfaceId && interfaces.get(endpoint.interfaceId)
  return port ? `${component} / ${port}` : component
}

export function confirmLinkRemoval(plan: Plan, link: PlanLink) {
  const components = new Map(plan.components.map(({ id, name }) => [id, name]))
  const ports = new Map(plan.interfaces.map(({ id, name }) => [id, name]))
  const from = linkEndpointLabel(link.source, components, ports)
  const to = linkEndpointLabel(link.target, components, ports)
  if (window.confirm(`Remove the link from ${from} to ${to}?`)) {
    return plan.links.filter(({ id }) => id !== link.id)
  }
}
