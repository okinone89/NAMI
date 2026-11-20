import { useId, useState, type FormEvent } from "react"
import { AddressSaveFeedback } from "@/components/ipv4-issues"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import {
  addComponentCopies,
  type ComponentCopies,
} from "@/lib/component-actions"
import type { AddressConflictApproval } from "@/lib/address-issues"
import type { Plan, PlanNetwork, SavePlanSnapshot } from "@/lib/plans"

export function DuplicateComponentsDialog({
  plan,
  copies,
  savePlan,
  onClose,
}: {
  plan: Plan
  copies: ComponentCopies
  savePlan: SavePlanSnapshot
  onClose: () => void
}) {
  const formId = useId()
  const [groups, setGroups] = useState(() =>
    Array.from(
      new Set(copies.interfaces.map((port) => port.networkId)),
      (sourceId) => ({
        sourceId,
        destinationId: sourceId ?? "",
        newId: crypto.randomUUID(),
        name: "",
        subnet: plan.networks.find(({ id }) => id === sourceId)?.subnet ?? "",
      })
    )
  )
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>()

  function updateGroup(
    index: number,
    changes: Partial<(typeof groups)[number]>
  ) {
    setGroups((current) =>
      current.map((group, i) =>
        i === index ? { ...group, ...changes } : group
      )
    )
    setFailure(undefined)
  }

  async function duplicate(approvals?: AddressConflictApproval[]) {
    if (busy) return
    const created: PlanNetwork[] = groups
      .filter((group) => group.destinationId === group.newId)
      .map((group) => ({
        id: group.newId,
        name: group.name.trim(),
        subnet: group.subnet.trim() || null,
        position: null,
      }))
    if (created.some(({ name }) => !name)) {
      setFailure(new Error("Enter a name for each new network."))
      return
    }
    const destinations = new Map(
      groups.map((group) => [group.sourceId, group.destinationId])
    )
    const next = addComponentCopies(
      { ...plan, networks: [...plan.networks, ...created] },
      {
        ...copies,
        interfaces: copies.interfaces.map((port) => ({
          ...port,
          networkId: destinations.get(port.networkId) || null,
        })),
      }
    )
    setBusy(true)
    setFailure(undefined)
    try {
      await savePlan(next, approvals)
    } catch (error) {
      setFailure(error)
      setBusy(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void duplicate()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>
            Duplicate{" "}
            {copies.components.length === 1 ? "component" : "components"}
          </DialogTitle>
          <DialogDescription>
            Choose the destination for each group of interfaces. Copied IPv4
            addresses stay with their interfaces.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <FieldGroup>
            {groups.map((group, index) => {
              const label =
                plan.networks.find(({ id }) => id === group.sourceId)?.name ??
                "No network"
              const inputId = `${formId}-${index}`
              return (
                <FieldGroup key={group.newId} className="gap-2">
                  <Field>
                    <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
                    <NativeSelect
                      id={inputId}
                      disabled={busy}
                      value={group.destinationId}
                      onChange={(event) =>
                        updateGroup(index, {
                          destinationId: event.target.value,
                        })
                      }
                    >
                      <option value={group.sourceId ?? ""}>
                        {group.sourceId
                          ? "Keep current network"
                          : "Leave unassigned"}
                      </option>
                      {plan.networks
                        .filter(({ id }) => id !== group.sourceId)
                        .map((network) => (
                          <option key={network.id} value={network.id}>
                            {network.name}
                          </option>
                        ))}
                      <option value={group.newId}>Create new network…</option>
                    </NativeSelect>
                  </Field>
                  {group.destinationId === group.newId && (
                    <>
                      <Field>
                        <FieldLabel htmlFor={`${inputId}-name`}>
                          New network name
                        </FieldLabel>
                        <Input
                          id={`${inputId}-name`}
                          disabled={busy}
                          required
                          value={group.name}
                          onChange={(event) =>
                            updateGroup(index, { name: event.target.value })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`${inputId}-subnet`}>
                          IPv4 subnet (optional)
                        </FieldLabel>
                        <Input
                          id={`${inputId}-subnet`}
                          disabled={busy}
                          placeholder="192.168.1.0/24"
                          value={group.subnet}
                          onChange={(event) =>
                            updateGroup(index, { subnet: event.target.value })
                          }
                        />
                      </Field>
                    </>
                  )}
                </FieldGroup>
              )
            })}
          </FieldGroup>
          <AddressSaveFeedback
            failure={failure}
            fallback="Could not duplicate the components."
            disabled={busy}
            onKeep={(approvals) => void duplicate(approvals)}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Duplicate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
