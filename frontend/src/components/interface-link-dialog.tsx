import { useState } from "react"
import { AddressSaveFeedback } from "@/components/ipv4-issues"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { AddressConflictApproval } from "@/lib/address-issues"
import type { Plan, PlanInterface, SavePlanSnapshot } from "@/lib/plans"

type Props = {
  plan: Plan
  source: PlanInterface
  targetComponentId?: string
  savePlan: SavePlanSnapshot
  onClose: () => void
  onSaved: () => void
}

export function InterfaceLinkDialog({
  plan,
  source,
  targetComponentId,
  savePlan,
  onClose,
  onSaved,
}: Props) {
  const [componentId, setComponentId] = useState(targetComponentId ?? "")
  const [portId, setPortId] = useState("")
  const [networkChoice, setNetworkChoice] = useState("")
  const [newName, setNewName] = useState("")
  const [addresses, setAddresses] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>()
  const [newNetworkId] = useState(() => crypto.randomUUID())
  const targets = plan.components.filter((c) => c.id !== source.componentId)
  const ports = plan.interfaces.filter(
    (port) => port.componentId === componentId
  )
  const target =
    ports.length === 1 ? ports[0] : ports.find((p) => p.id === portId)
  const networkId = networkChoice || source.networkId || target?.networkId || ""
  const creating = networkId === newNetworkId
  const networkName = (id: string) =>
    plan.networks.find((n) => n.id === id)?.name
  const name = creating ? newName.trim() : networkName(networkId)
  const changes = [source, target].filter(
    (port): port is PlanInterface =>
      !!port?.networkId && port.networkId !== networkId
  )
  const componentName = (id: string) =>
    plan.components.find((c) => c.id === id)?.name

  async function connect(approvals?: AddressConflictApproval[]) {
    if (!target || !name || busy) return
    setBusy(true)
    setFailure(undefined)
    try {
      await savePlan(
        {
          ...plan,
          networks: creating
            ? [
                ...plan.networks,
                { id: newNetworkId, name, subnet: null, position: null },
              ]
            : plan.networks,
          interfaces: plan.interfaces.map((p) =>
            p.id === source.id || p.id === target.id
              ? {
                  ...p,
                  networkId,
                  ipv4:
                    changes.some((port) => port.id === p.id) &&
                    p.id in addresses
                      ? addresses[p.id].trim() || null
                      : p.ipv4,
                }
              : p
          ),
          links: [
            ...plan.links,
            {
              id: crypto.randomUUID(),
              source: {
                componentId: source.componentId,
                interfaceId: source.id,
              },
              target: { componentId, interfaceId: target.id },
              medium: "wired",
              protocol: null,
            },
          ],
        },
        approvals
      )
      onSaved()
    } catch (error) {
      setFailure(error)
      setBusy(false)
    }
  }
  const selectClass = "min-h-11 w-full border border-input bg-background px-2"
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Connect interface</DialogTitle>
        </DialogHeader>
        <p>
          {componentName(source.componentId)} / {source.name}
        </p>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void connect()
          }}
          onChange={() => setFailure(undefined)}
        >
          <fieldset disabled={busy} className="grid gap-3">
            <label>
              Network
              <select
                className={selectClass}
                value={networkId}
                onChange={(e) => setNetworkChoice(e.target.value)}
              >
                <option value="">Select network</option>
                {plan.networks.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
                <option value={newNetworkId}>Create network…</option>
              </select>
            </label>
            {creating && (
              <label>
                New network name
                <Input
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
            )}
            <label>
              Target component
              <select
                className={selectClass}
                required
                value={componentId}
                onChange={(e) => {
                  setComponentId(e.target.value)
                  setPortId("")
                }}
              >
                <option value="">Select component</option>
                {targets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Target interface
              <select
                className={selectClass}
                required
                value={target?.id ?? ""}
                onChange={(e) => setPortId(e.target.value)}
              >
                <option value="">Select interface</option>
                {ports.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {networkName(p.networkId ?? "") ?? "No network"}
                  </option>
                ))}
              </select>
            </label>
            {componentId && !ports.length && (
              <p>
                Add an interface to {componentName(componentId)} to connect it.
              </p>
            )}
            {name &&
              changes.map((p) => (
                <div key={p.id}>
                  <p>
                    Move {componentName(p.componentId)} / {p.name} from{" "}
                    {networkName(p.networkId!)} to {name}?
                  </p>
                  {p.ipv4 && (
                    <label>
                      IPv4 address for {componentName(p.componentId)} / {p.name}
                      <Input
                        value={addresses[p.id] ?? p.ipv4}
                        onChange={(e) =>
                          setAddresses({ ...addresses, [p.id]: e.target.value })
                        }
                      />
                    </label>
                  )}
                </div>
              ))}
            <AddressSaveFeedback
              failure={failure}
              fallback="Unable to create link."
              disabled={busy}
              onKeep={connect}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name || !target}>
                {changes.length ? "Accept change and link" : "Create link"}
              </Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}
