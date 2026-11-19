import { useId, useState, type FormEvent } from "react"
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconTable,
} from "@tabler/icons-react"
import { AddressSaveFeedback } from "@/components/ipv4-issues"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { ConnectionList } from "@/components/connection-list"
import { EmptyPlanView, type PlanViewProps } from "@/components/plan-view"
import type { AddressConflictApproval } from "@/lib/address-issues"
import type { PlanInterface } from "@/lib/plans"
import { cn } from "@/lib/utils"

const columns = [
  { key: "component", label: "Component" },
  { key: "interface", label: "Interface" },
  { key: "network", label: "Network" },
  { key: "ipv4", label: "IPv4 address" },
] as const

type Sort = {
  key: (typeof columns)[number]["key"]
  direction: "ascending" | "descending"
}

type Addressing = Pick<PlanInterface, "networkId" | "ipv4">
type InterfaceDraft = {
  interfaceId: string
  changes: Partial<Addressing>
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
})

export function InterfaceTable({
  plan,
  canEdit,
  onSelectComponent,
  savePlan,
}: PlanViewProps) {
  const id = useId()
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<Sort>()
  const [draft, setDraft] = useState<InterfaceDraft>()
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<unknown>()
  const flaggedPorts = new Set(
    plan.addressIssues
      ?.filter((issue) => issue.code === "duplicateIpv4")
      .flatMap((issue) => issue.interfaces.map((port) => port.interfaceId))
  )
  const draftPort =
    canEdit && draft
      ? plan.interfaces.find((port) => port.id === draft.interfaceId)
      : undefined
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
    (component) => !withInterfaces.has(component.id)
  )
  const filter = query.trim().toLocaleLowerCase()
  const rows = plan.interfaces
    .map((port) => {
      const component = components.get(port.componentId)
      return {
        port,
        component: component?.name ?? "",
        type: component?.type ?? "",
        interface: port.name,
        network: port.networkId ? (networks.get(port.networkId) ?? "") : "",
        ipv4: port.ipv4 ?? "",
      }
    })
    .filter((row) =>
      [row.component, row.type, row.interface, row.network, row.ipv4].some(
        (value) => value.toLocaleLowerCase().includes(filter)
      )
    )

  if (sort) {
    const direction = sort.direction === "ascending" ? 1 : -1
    rows.sort((a, b) => collator.compare(a[sort.key], b[sort.key]) * direction)
  }

  function editInterface(interfaceId: string, changes: Partial<Addressing>) {
    setFailure(undefined)
    setDraft((previous) => ({
      interfaceId,
      changes: {
        ...(previous?.interfaceId === interfaceId ? previous.changes : {}),
        ...changes,
      },
    }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void saveInterface()
  }

  async function saveInterface(approvals?: AddressConflictApproval[]) {
    if (!draft || !draftPort || saving) return

    const changes = { ...draft.changes }
    if (changes.ipv4 !== undefined) changes.ipv4 = changes.ipv4?.trim() || null

    setSaving(true)
    try {
      await savePlan(
        {
          ...plan,
          interfaces: plan.interfaces.map((port) =>
            port.id === draft.interfaceId ? { ...port, ...changes } : port
          ),
        },
        approvals
      )
      setDraft(undefined)
      setFailure(undefined)
    } catch (error) {
      setFailure(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-[50svh]">
      {plan.interfaces.length ? (
        <>
          <div
            className={cn(
              "flex flex-wrap items-end gap-3 border-b bg-background p-4",
              draftPort && "sticky top-0 z-10"
            )}
          >
            <Field className="max-w-sm">
              <FieldLabel htmlFor={`${id}-filter`}>
                Filter interfaces
              </FieldLabel>
              <Input
                id={`${id}-filter`}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-h-11"
              />
            </Field>
            {draftPort && (
              <form
                id={`${id}-save`}
                onSubmit={submit}
                className="flex max-w-full flex-wrap items-center gap-2"
              >
                <span role="status" className="text-xs break-words">
                  Editing {components.get(draftPort.componentId)?.name} /{" "}
                  {draftPort.name}
                </span>
                <Button type="submit" disabled={saving} className="min-h-11">
                  {saving ? "Saving…" : "Save interface"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  className="min-h-11"
                  onClick={() => {
                    setDraft(undefined)
                    setFailure(undefined)
                  }}
                >
                  Discard changes
                </Button>
                <AddressSaveFeedback
                  failure={failure}
                  fallback="Unable to save the interface. Try again."
                  disabled={saving}
                  onKeep={(approvals) => void saveInterface(approvals)}
                />
              </form>
            )}
          </div>
          <div className="overflow-x-auto">
            <table
              aria-label="Interfaces"
              className="w-full border-collapse text-left text-xs"
            >
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  {columns.map(({ key, label }) => {
                    const direction =
                      sort?.key === key ? sort.direction : undefined
                    const Icon =
                      direction === "ascending"
                        ? IconArrowUp
                        : direction === "descending"
                          ? IconArrowDown
                          : IconArrowsSort
                    return (
                      <th
                        key={key}
                        scope="col"
                        aria-sort={direction}
                        className="px-2 sm:px-4"
                      >
                        <Button
                          variant="ghost"
                          className="min-h-11 gap-1 px-0 has-data-[icon=inline-end]:pr-0"
                          onClick={() =>
                            setSort({
                              key,
                              direction:
                                direction === "ascending"
                                  ? "descending"
                                  : "ascending",
                            })
                          }
                        >
                          {label}
                          <Icon
                            data-icon="inline-end"
                            aria-hidden="true"
                            className={cn(!direction && "hidden sm:block")}
                          />
                        </Button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ port, component, type, network, ipv4 }) => {
                  const addressing =
                    draftPort?.id === port.id
                      ? { ...port, ...draft?.changes }
                      : port
                  const disabled =
                    saving ||
                    (draftPort !== undefined && draftPort.id !== port.id)
                  const interfaceLabel = `${component} / ${port.name}`
                  return (
                    <tr key={port.id} className="border-b">
                      <td className="px-2 sm:px-4">
                        <Button
                          variant="link"
                          className="min-h-11 px-0"
                          onClick={() => onSelectComponent(port.componentId)}
                        >
                          {component}
                        </Button>
                        <span className="-mt-2 block pb-2 text-muted-foreground">
                          {type}
                        </span>
                      </td>
                      <td className="px-2 py-2 sm:px-4">{port.name}</td>
                      <td className="px-2 py-2 sm:px-4">
                        {canEdit ? (
                          <select
                            aria-label={`Network for ${interfaceLabel}`}
                            value={addressing.networkId ?? ""}
                            disabled={disabled}
                            onChange={(event) =>
                              editInterface(port.id, {
                                networkId: event.target.value || null,
                              })
                            }
                            className="min-h-11 w-full min-w-28 border border-input bg-background px-2 disabled:opacity-50"
                          >
                            <option value="">No network</option>
                            {plan.networks.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          network || "—"
                        )}
                      </td>
                      <td className="px-2 py-2 sm:px-4">
                        {canEdit ? (
                          <Input
                            aria-label={`IPv4 address for ${interfaceLabel}`}
                            value={addressing.ipv4 ?? ""}
                            form={`${id}-save`}
                            disabled={disabled}
                            spellCheck={false}
                            autoComplete="off"
                            onChange={(event) =>
                              editInterface(port.id, {
                                ipv4: event.target.value,
                              })
                            }
                            className="min-h-11 min-w-32"
                          />
                        ) : (
                          ipv4 || "—"
                        )}
                        {flaggedPorts.has(port.id) && (
                          <span className="mt-1 block font-medium text-destructive">
                            IPv4 address conflict
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <p role="status" className="p-4 text-sm">
              No matching interfaces.
            </p>
          )}
        </>
      ) : (
        <EmptyPlanView
          icon={IconTable}
          title="No interfaces yet"
          description="Each interface will have its own row in this table."
        />
      )}
      {!!withoutInterfaces.length && (
        <section
          aria-label="Components without interfaces"
          className="border-t p-4"
        >
          <h3 className="text-sm font-medium">Components without interfaces</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {withoutInterfaces.map((component) => (
              <li key={component.id}>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => onSelectComponent(component.id)}
                >
                  {component.name}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ConnectionList plan={plan} canEdit={canEdit} savePlan={savePlan} />
    </div>
  )
}
