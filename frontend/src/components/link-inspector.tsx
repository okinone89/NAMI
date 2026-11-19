import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { linkEndpointLabel, linkMediumLabels } from "@/lib/link-labels"
import type { LinkEndpoint, LinkMedium, Plan, PlanLink } from "@/lib/plans"

type Props = {
  plan: Plan
  link?: PlanLink
  canEdit: boolean
  onClose: () => void
  savePlan: (plan: Plan) => Promise<void>
}

const emptyEndpoint: LinkEndpoint = { componentId: "", interfaceId: null }

export function LinkInspector({
  plan,
  link,
  canEdit,
  onClose,
  savePlan,
}: Props) {
  const [source, setSource] = useState(link?.source ?? emptyEndpoint)
  const [target, setTarget] = useState(link?.target ?? emptyEndpoint)
  const [medium, setMedium] = useState<LinkMedium>(link?.medium ?? "wired")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setBusy(true)
    const nextLink: PlanLink = {
      id: link?.id ?? crypto.randomUUID(),
      source,
      target,
      medium,
      protocol: link?.protocol ?? null,
    }
    const links = link
      ? plan.links.map((current) =>
          current.id === link.id ? nextLink : current
        )
      : [...plan.links, nextLink]

    try {
      await savePlan({ ...plan, links })
      onClose()
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to save the link."
      )
      setBusy(false)
    }
  }

  function endpointLabel(endpoint: LinkEndpoint) {
    return linkEndpointLabel(
      endpoint,
      new Map(plan.components.map(({ id, name }) => [id, name])),
      new Map(plan.interfaces.map(({ id, name }) => [id, name]))
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{link ? "Link details" : "Add link"}</DialogTitle>
        </DialogHeader>
        {canEdit ? (
          <form className="grid gap-4" onSubmit={submit}>
            <EndpointField
              label="Source"
              endpoint={source}
              plan={plan}
              disabled={busy}
              onChange={setSource}
            />
            <EndpointField
              label="Target"
              endpoint={target}
              plan={plan}
              disabled={busy}
              onChange={setTarget}
            />
            <label className="grid gap-1 text-sm">
              Medium
              <select
                className="min-h-11 w-full border border-input bg-background px-3"
                value={medium}
                disabled={busy}
                onChange={(event) =>
                  setMedium(event.target.value as LinkMedium)
                }
              >
                {Object.entries(linkMediumLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {link?.protocol && (
              <p className="text-sm">Protocol · {link.protocol}</p>
            )}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
                className="min-h-11"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="min-h-11">
                Save link
              </Button>
            </div>
          </form>
        ) : (
          link && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Source</dt>
                <dd className="min-w-0 wrap-break-word">
                  {endpointLabel(link.source)}
                </dd>
                <dt className="text-muted-foreground">Target</dt>
                <dd className="min-w-0 wrap-break-word">
                  {endpointLabel(link.target)}
                </dd>
                <dt className="text-muted-foreground">Medium</dt>
                <dd>{linkMediumLabels[link.medium]}</dd>
                {link.protocol && (
                  <>
                    <dt className="text-muted-foreground">Protocol</dt>
                    <dd className="min-w-0 wrap-break-word">{link.protocol}</dd>
                  </>
                )}
              </dl>
              <Button
                variant="outline"
                onClick={onClose}
                className="min-h-11 justify-self-end"
              >
                Close
              </Button>
            </>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}

function EndpointField({
  label,
  endpoint,
  plan,
  disabled,
  onChange,
}: {
  label: string
  endpoint: LinkEndpoint
  plan: Plan
  disabled: boolean
  onChange: (endpoint: LinkEndpoint) => void
}) {
  const interfaces = plan.interfaces.filter(
    ({ componentId }) => componentId === endpoint.componentId
  )
  return (
    <fieldset
      className="grid min-w-0 gap-2 border px-3 pb-3"
      disabled={disabled}
    >
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <label className="grid gap-1 text-xs">
        Component
        <select
          className="min-h-11 w-full border border-input bg-background px-3 text-sm"
          value={endpoint.componentId}
          onChange={(event) =>
            onChange({ componentId: event.target.value, interfaceId: null })
          }
          required
        >
          <option value="" disabled>
            Choose a component
          </option>
          {plan.components.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        Interface
        <select
          className="min-h-11 w-full border border-input bg-background px-3 text-sm"
          value={endpoint.interfaceId ?? ""}
          disabled={!interfaces.length}
          onChange={(event) =>
            onChange({ ...endpoint, interfaceId: event.target.value || null })
          }
        >
          <option value="">Port unspecified</option>
          {interfaces.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  )
}
