import { useId, useState } from "react"
import { LinkInspector } from "@/components/link-inspector"
import type { PlanViewProps } from "@/components/plan-view"
import { Button } from "@/components/ui/button"
import { linkEndpointLabel, linkMediumLabels } from "@/lib/link-labels"
import {
  profileNames,
  type InterfaceProtocolProfiles,
} from "@/lib/protocol-profiles"

type Props = Pick<PlanViewProps, "plan" | "canEdit" | "savePlan">

export function ConnectionList({ plan, canEdit, savePlan }: Props) {
  const headingId = useId()
  const [selectedLinkId, setSelectedLinkId] = useState<string>()
  if (plan.links.length === 0) return null

  const selectedLink = plan.links.find(({ id }) => id === selectedLinkId)
  const components = new Map(plan.components.map(({ id, name }) => [id, name]))
  const interfaces = new Map(plan.interfaces.map((port) => [port.id, port]))
  const interfaceNames = new Map(
    plan.interfaces.map(({ id, name }) => [id, name])
  )

  return (
    <section className="border-t" aria-labelledby={headingId}>
      <h3 id={headingId} className="border-b px-4 py-3 text-sm font-medium">
        Connections
      </h3>
      <div className="overflow-x-auto">
        <table aria-labelledby={headingId} className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50 text-xs">
            <tr>
              <th scope="col" className="px-4 py-2">
                Endpoints
              </th>
              <th scope="col" className="px-2 py-2">
                Medium
              </th>
              <th scope="col" className="px-4 py-2">
                Protocol
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {plan.links.map((link) => {
              const source = interfaces.get(link.source.interfaceId ?? "")
              const target = interfaces.get(link.target.interfaceId ?? "")
              const sourceProfiles = profileSummary(source?.protocolProfiles)
              const targetProfiles = profileSummary(target?.protocolProfiles)

              return (
                <tr key={link.id} className="align-top">
                  <td className="px-4 py-2">
                    <Button
                      variant="link"
                      aria-haspopup="dialog"
                      className="h-auto min-h-11 w-full flex-col items-start gap-0.5 px-0 text-left text-sm wrap-anywhere whitespace-normal"
                      onClick={() => setSelectedLinkId(link.id)}
                    >
                      <span>
                        {linkEndpointLabel(
                          link.source,
                          components,
                          interfaceNames
                        )}
                      </span>
                      {!source && (
                        <span className="text-xs text-muted-foreground">
                          Port unspecified
                        </span>
                      )}
                      <span
                        aria-hidden="true"
                        className="text-muted-foreground"
                      >
                        ↓
                      </span>
                      <span className="sr-only">to</span>
                      <span>
                        {linkEndpointLabel(
                          link.target,
                          components,
                          interfaceNames
                        )}
                      </span>
                      {!target && (
                        <span className="text-xs text-muted-foreground">
                          Port unspecified
                        </span>
                      )}
                    </Button>
                  </td>
                  <td className="px-2 py-3">{linkMediumLabels[link.medium]}</td>
                  <td className="px-4 py-3 wrap-anywhere">
                    {link.protocol && <div>{link.protocol}</div>}
                    {sourceProfiles && (
                      <div>
                        <span className="mr-2 text-xs text-muted-foreground">
                          Source
                        </span>
                        {sourceProfiles}
                      </div>
                    )}
                    {targetProfiles && (
                      <div>
                        <span className="mr-2 text-xs text-muted-foreground">
                          Target
                        </span>
                        {targetProfiles}
                      </div>
                    )}
                    {!link.protocol &&
                      !sourceProfiles &&
                      !targetProfiles &&
                      "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {selectedLink && (
        <LinkInspector
          key={selectedLink.id}
          plan={plan}
          link={selectedLink}
          canEdit={canEdit}
          savePlan={savePlan}
          onClose={() => setSelectedLinkId(undefined)}
        />
      )}
    </section>
  )
}

function profileSummary(profiles?: InterfaceProtocolProfiles) {
  return (Object.keys(profileNames) as (keyof typeof profileNames)[])
    .filter((profile) => profiles?.[profile])
    .map((profile) => profileNames[profile])
    .join(", ")
}
