import type { LinkEndpoint, LinkMedium } from "@/lib/plans"

export const linkMediumLabels: Record<LinkMedium, string> = {
  wired: "Wired",
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
