import { useId, useState } from "react"
import {
  IconCheck,
  IconChevronDown,
  IconPencil,
  IconPlus,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { NetworkDialog } from "@/components/network-dialog"
import { linkMediumLabels } from "@/lib/link-labels"
import { subnetMask } from "@/lib/ipv4-subnet"
import { networkColor } from "@/lib/network-color"
import type { Plan, PlanNetwork } from "@/lib/plans"

type Props = {
  plan: Plan
  canEdit: boolean
  selected: string[]
  onToggle: (id: string) => void
  savePlan: (plan: Plan) => Promise<void>
}

export function PlanNetworks({
  plan,
  canEdit,
  savePlan,
  selected,
  onToggle,
}: Props) {
  const [editing, setEditing] = useState<PlanNetwork | "new">()

  const [expanded, setExpanded] = useState(true)
  const listId = useId()
  const activeNetworks = plan.networks.filter((network) =>
    selected.includes(network.id)
  )

  if (!canEdit && !plan.networks.length) return null

  return (
    <section aria-label="Networks" className="mb-4 border">
      <div className="flex flex-wrap items-center gap-2 bg-muted px-3 py-1">
        <h2 className="text-sm font-medium">
          {plan.networks.length ? (
            <Button
              variant="ghost"
              className="gap-2 px-1 text-sm"
              aria-expanded={expanded}
              aria-controls={listId}
              aria-label={expanded ? "Collapse networks" : "Expand networks"}
              onClick={() => setExpanded(!expanded)}
            >
              <IconChevronDown
                aria-hidden="true"
                className={expanded ? "" : "-rotate-90"}
              />
              Networks
            </Button>
          ) : (
            "Networks"
          )}
        </h2>
        {!expanded &&
          activeNetworks.map((activeNetwork) => (
            <span
              key={activeNetwork.id}
              className="flex max-w-full min-w-0 items-center gap-2 border bg-background px-2 py-1 text-xs"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: networkColor(activeNetwork.id) }}
              />
              <span className="wrap-anywhere">
                <span className="sr-only">Active network filter: </span>
                {activeNetwork.name}
              </span>
            </span>
          ))}
        {canEdit && (
          <Button
            variant="outline"
            className="ml-auto"
            onClick={() => setEditing("new")}
          >
            <IconPlus aria-hidden="true" /> Add network
          </Button>
        )}
      </div>
      {!!plan.networks.length && (
        <ul
          id={listId}
          hidden={!expanded}
          className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-2 overflow-y-auto border-t p-2 [&[hidden]]:hidden"
        >
          {plan.networks.map((network) => (
            <li
              key={network.id}
              className={`flex min-w-0 items-center border border-l-4 ${selected.includes(network.id) ? "border-primary bg-muted" : "border-border"}`}
              style={{ borderLeftColor: networkColor(network.id) }}
            >
              <Button
                variant="ghost"
                aria-label={network.name}
                aria-pressed={selected.includes(network.id)}
                className="h-auto min-h-11 min-w-0 flex-1 flex-col items-start gap-0 px-3 py-1 text-left"
                onClick={() => onToggle(network.id)}
              >
                <span className="flex w-full items-center gap-1">
                  <span className="truncate" title={network.name}>
                    {network.name}
                  </span>
                  {selected.includes(network.id) && (
                    <IconCheck aria-hidden="true" className="ml-auto" />
                  )}
                </span>
                {network.medium && (
                  <span className="text-xs text-muted-foreground">
                    {linkMediumLabels[network.medium]}
                  </span>
                )}
                {network.subnet && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {network.subnet}
                    <span className="block">
                      Mask {subnetMask(network.subnet)}
                    </span>
                  </span>
                )}
              </Button>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="mr-1"
                  aria-label={`Edit network ${network.name}`}
                  onClick={() => setEditing(network)}
                >
                  <IconPencil aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && canEdit && (
        <NetworkDialog
          plan={plan}
          network={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          savePlan={savePlan}
        />
      )}
    </section>
  )
}
