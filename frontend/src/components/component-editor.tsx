import { useId, useState, type FormEvent } from "react"
import { ComponentInterfaceFields } from "@/components/component-interface-fields"
import {
  AddressSaveFeedback,
  PersistedIpv4Issues,
} from "@/components/ipv4-issues"
import { ProtocolProfileDetails } from "@/components/protocol-profile-details"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { AddressConflictApproval } from "@/lib/address-issues"
import type {
  Component,
  Plan,
  PlanInterface,
  SavePlanSnapshot,
} from "@/lib/plans"

type Props = {
  plan: Plan
  component?: Component
  canEdit: boolean
  onClose: () => void
  savePlan: SavePlanSnapshot
}

export function ComponentEditor({
  plan,
  component,
  canEdit,
  onClose,
  savePlan,
}: Props) {
  const formId = useId()
  const [draft, setDraft] = useState<Component>(
    () =>
      component ?? {
        id: crypto.randomUUID(),
        type: "",
        name: "",
        position: null,
        hostId: null,
      }
  )
  const savedPorts = plan.interfaces.filter(
    (port) => port.componentId === draft.id
  )
  const [ports, setPorts] = useState(savedPorts)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>()
  const guests = plan.components.filter((guest) => guest.hostId === draft.id)
  const isVirtualMachine = draft.type.trim().toLowerCase() === "vm"

  function addInterface() {
    setFailure(undefined)
    setPorts((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        componentId: draft.id,
        name: "",
        networkId: null,
        ipv4: null,
      },
    ])
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void saveComponent()
  }

  async function saveComponent(approvals?: AddressConflictApproval[]) {
    if (busy) return
    const updated = {
      ...draft,
      name: draft.name.trim(),
      type: draft.type.trim(),
      hostId: isVirtualMachine ? draft.hostId : null,
    }
    if (
      !updated.name ||
      !updated.type ||
      ports.some((port) => !port.name.trim())
    ) {
      setFailure(
        new Error(
          "Enter a component name, type, and a name for each interface."
        )
      )
      return
    }

    const existingIds = new Set(savedPorts.map((port) => port.id))
    const portsById = new Map(
      ports.map((port) => [
        port.id,
        {
          ...port,
          name: port.name.trim(),
          ipv4: port.ipv4?.trim() || null,
        },
      ])
    )
    const interfaces = plan.interfaces.map(
      (port) => portsById.get(port.id) ?? port
    )
    for (const port of portsById.values()) {
      if (!existingIds.has(port.id)) interfaces.push(port)
    }
    const components = component
      ? plan.components.map((item) => (item.id === updated.id ? updated : item))
      : [...plan.components, updated]

    setBusy(true)
    try {
      await savePlan({ ...plan, components, interfaces }, approvals)
      onClose()
    } catch (error) {
      setFailure(error)
      setBusy(false)
    }
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
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle className="break-words">
            {component?.name ?? "Add component"}
          </DialogTitle>
        </DialogHeader>
        {canEdit ? (
          <form
            className="flex min-w-0 flex-col gap-4"
            onSubmit={submit}
            onChange={() => setFailure(undefined)}
          >
            <FieldSet disabled={busy} className="min-w-0">
              <FieldGroup className="gap-3 sm:grid sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`${formId}-name`}>
                    Component name
                  </FieldLabel>
                  <Input
                    id={`${formId}-name`}
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                    required
                    className="min-h-11"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${formId}-type`}>
                    Component type
                  </FieldLabel>
                  <Input
                    id={`${formId}-type`}
                    list={`${formId}-types`}
                    value={draft.type}
                    onChange={(event) =>
                      setDraft({ ...draft, type: event.target.value })
                    }
                    required
                    className="min-h-11"
                  />
                  <datalist id={`${formId}-types`}>
                    {[
                      "Server",
                      "VM",
                      "Switch",
                      "PLC",
                      "HMI",
                      "Router",
                      "Access point",
                      "Other",
                    ].map((type) => (
                      <option key={type} value={type} />
                    ))}
                  </datalist>
                </Field>
                {isVirtualMachine && (
                  <Field>
                    <FieldLabel htmlFor={`${formId}-host`}>
                      Hosted on
                    </FieldLabel>
                    <select
                      id={`${formId}-host`}
                      value={draft.hostId ?? ""}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          hostId: event.target.value || null,
                        })
                      }
                      className="min-h-11 border border-input bg-background px-2"
                    >
                      <option value="">No host</option>
                      {plan.components
                        .filter(
                          (host) =>
                            host.id !== draft.id &&
                            host.type.toLowerCase() === "server"
                        )
                        .map((host) => (
                          <option key={host.id} value={host.id}>
                            {host.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
              </FieldGroup>
              <GuestList guests={guests} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Interfaces</h3>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={addInterface}
                >
                  Add interface
                </Button>
              </div>
              {ports.map((port) => (
                <ComponentInterfaceFields
                  key={port.id}
                  port={port}
                  networks={plan.networks}
                  addressIssues={plan.addressIssues?.filter((issue) =>
                    issue.interfaces.some(
                      (item) => item.interfaceId === port.id
                    )
                  )}
                  onChange={(updated) =>
                    setPorts((current) =>
                      current.map((item) =>
                        item.id === updated.id ? updated : item
                      )
                    )
                  }
                  onDiscard={
                    savedPorts.some((saved) => saved.id === port.id)
                      ? undefined
                      : () => {
                          setFailure(undefined)
                          setPorts((current) =>
                            current.filter((item) => item.id !== port.id)
                          )
                        }
                  }
                />
              ))}
            </FieldSet>
            <AddressSaveFeedback
              failure={failure}
              fallback="Unable to save the component. Try again."
              disabled={busy}
              onKeep={(approvals) => void saveComponent(approvals)}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" className="min-h-11" disabled={busy}>
                Save component
              </Button>
            </div>
          </form>
        ) : (
          component && (
            <>
              <ComponentDetails
                component={component}
                plan={plan}
                ports={savedPorts}
                guests={guests}
              />
              <Button
                type="button"
                variant="outline"
                className="min-h-11 justify-self-end"
                onClick={onClose}
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

function GuestList({ guests }: { guests: Component[] }) {
  if (!guests.length) return null
  return (
    <section aria-label="Guests" className="min-w-0">
      <h3 className="text-sm font-medium">Guests</h3>
      <ul className="mt-1 flex flex-col gap-1">
        {guests.map((guest) => (
          <li key={guest.id} className="break-words">
            {guest.name}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ComponentDetails({
  component,
  plan,
  ports,
  guests,
}: {
  component: Component
  plan: Plan
  ports: PlanInterface[]
  guests: Component[]
}) {
  const host = plan.components.find((item) => component.hostId === item.id)
  const networks = new Map(
    plan.networks.map((network) => [network.id, network.name])
  )
  return (
    <div className="flex min-w-0 flex-col gap-4 break-words">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Component type</dt>
          <dd>{component.type}</dd>
        </div>
        {component.type.toLowerCase() === "vm" && (
          <div>
            <dt className="text-muted-foreground">Hosted on</dt>
            <dd>{host?.name ?? "No host"}</dd>
          </div>
        )}
      </dl>
      <GuestList guests={guests} />
      <section aria-label="Interfaces" className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Interfaces</h3>
        {ports.length ? (
          <ul className="flex flex-col gap-2">
            {ports.map((port) => (
              <li key={port.id} className="border p-3">
                <h4 className="mb-2 font-medium">{port.name}</h4>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Network</dt>
                    <dd>
                      {networks.get(port.networkId ?? "") ?? "No network"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">IPv4 address</dt>
                    <dd>{port.ipv4 ?? "Unassigned"}</dd>
                  </div>
                </dl>
                <PersistedIpv4Issues
                  issues={
                    plan.addressIssues?.filter((issue) =>
                      issue.interfaces.some(
                        (item) => item.interfaceId === port.id
                      )
                    ) ?? []
                  }
                />
                <ProtocolProfileDetails profiles={port.protocolProfiles} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No interfaces recorded.</p>
        )}
      </section>
    </div>
  )
}
