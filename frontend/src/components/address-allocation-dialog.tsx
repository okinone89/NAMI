import { useState } from "react"
import { AddressSaveFeedback } from "@/components/ipv4-issues"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  commitAddressAllocation,
  previewAddressAllocation,
  type AddressAllocationPreview,
  type Plan,
} from "@/lib/plans"

type Props = {
  plan: Plan
  candidates: ReadonlySet<string>
  interfaceId?: string
  onClose: () => void
  onPlanChanged?: () => void
}

export function AddressAllocationDialog({
  plan,
  candidates,
  interfaceId,
  onClose,
  onPlanChanged,
}: Props) {
  const [selected, setSelected] = useState(() =>
    interfaceId ? [interfaceId] : []
  )
  const [preview, setPreview] = useState<AddressAllocationPreview>()
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>()
  const components = new Map(plan.components.map(({ id, name }) => [id, name]))
  const networks = new Map(plan.networks.map(({ id, name }) => [id, name]))
  const ports = new Map(plan.interfaces.map((port) => [port.id, port]))

  function label(id: string, networkId?: string | null) {
    const port = ports.get(id)
    const network = networkId ? networks.get(networkId) : undefined
    return port
      ? `${components.get(port.componentId)} / ${port.name}${network ? ` · ${network}` : ""}`
      : id
  }

  function toggle(id: string, checked: boolean) {
    setSelected((previous) =>
      checked ? [...previous, id] : previous.filter((item) => item !== id)
    )
  }

  async function requestPreview() {
    setBusy(true)
    setFailure(undefined)
    try {
      setPreview(await previewAddressAllocation(plan.id, selected))
    } catch (error) {
      setFailure(error)
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!preview?.canApply) return
    setBusy(true)
    setFailure(undefined)
    try {
      const result = await commitAddressAllocation(plan.id, selected, preview)
      onPlanChanged?.()
      if (result.preview) {
        setNotice(
          "The plan changed. Review the refreshed preview before confirming."
        )
        setPreview(result.preview)
      } else {
        onClose()
      }
    } catch (error) {
      setFailure(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {interfaceId
              ? "Suggest IPv4 address"
              : "Auto-assign IPv4 addresses"}
          </DialogTitle>
        </DialogHeader>
        {preview ? (
          <div className="space-y-3" aria-live="polite">
            {notice && (
              <p role="status" className="font-medium">
                {notice}
              </p>
            )}
            {preview.assignments.some(
              ({ status }) => status === "exhausted"
            ) && (
              <p className="font-medium text-destructive">
                The allocation pool cannot satisfy the selected interfaces.
              </p>
            )}
            <dl className="divide-y border">
              {preview.assignments.map((assignment) => (
                <div
                  key={assignment.interfaceId}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 px-3 py-2"
                >
                  <dt className="break-words">
                    {label(assignment.interfaceId, assignment.networkId)}
                  </dt>
                  <dd className="font-medium">
                    {assignment.status === "proposed" && assignment.ipv4}
                    {assignment.status === "assigned" &&
                      `${assignment.ipv4} · already assigned`}
                    {assignment.status === "exhausted" &&
                      "No available address"}
                    {assignment.status === "unavailable" &&
                      "Interface or subnet unavailable"}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : interfaceId ? (
          <p>{label(interfaceId, ports.get(interfaceId)?.networkId)}</p>
        ) : (
          <fieldset className="min-w-0" disabled={busy}>
            <legend className="mb-2 font-medium">
              Select blank interfaces
            </legend>
            <div className="max-h-[50dvh] divide-y overflow-y-auto border">
              {plan.interfaces
                .filter((port) => candidates.has(port.id))
                .map((port) => (
                  <label
                    key={port.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(port.id)}
                      onChange={(event) =>
                        toggle(port.id, event.target.checked)
                      }
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span className="break-words">
                      {label(port.id, port.networkId)}
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
        )}
        <AddressSaveFeedback
          failure={failure}
          fallback="Unable to allocate IPv4 addresses. Try again."
          disabled={busy}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          {preview ? (
            <>
              {!interfaceId && (
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => {
                    setPreview(undefined)
                    setNotice("")
                    setFailure(undefined)
                    setSelected((previous) =>
                      previous.filter((id) => candidates.has(id))
                    )
                  }}
                >
                  Change selection
                </Button>
              )}
              <Button
                className="min-h-11"
                disabled={busy || !preview.canApply}
                onClick={() => void confirm()}
              >
                {interfaceId ? "Accept suggestion" : "Assign addresses"}
              </Button>
            </>
          ) : (
            <Button
              className="min-h-11"
              disabled={busy || !selected.length}
              onClick={() => void requestPreview()}
            >
              {interfaceId ? "Preview suggestion" : "Preview assignment"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
