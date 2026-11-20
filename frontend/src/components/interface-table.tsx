import {
  IconBulb,
  IconDeviceFloppy,
  IconPencil,
  IconWand,
  IconX,
} from "@tabler/icons-react"
import { useId, useState, type FormEvent } from "react"
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconTable,
  IconSearch,
} from "@tabler/icons-react"
import { AddressAllocationDialog } from "@/components/address-allocation-dialog"
import { InventoryCommitAction } from "@/components/inventory-confirmation"
import { InventoryDialog } from "@/components/inventory-tools"
import { AddressSaveFeedback } from "@/components/ipv4-issues"
import { Button } from "@/components/ui/button"
import { Input, inputStyles } from "@/components/ui/input"
import { Dialog } from "@/components/ui/dialog"
import { AppearanceMark } from "@/components/diagram-component-label"
import { EmptyPlanView, type PlanViewProps } from "@/components/plan-view"
import type { AddressConflictApproval } from "@/lib/address-issues"
import type { PlanInterface } from "@/lib/plans"
import { cn } from "@/lib/utils"

import { columns, interfaceRows } from "@/lib/interface-rows"

type Sort = {
  key: (typeof columns)[number]["key"]
  direction: "ascending" | "descending"
}

type Addressing = Pick<PlanInterface, "networkId" | "ipv4">
type InterfaceDraft = {
  interfaceId: string
  changes: Partial<Addressing>
}

const addressFieldWidth = "w-[calc(15ch+1.5rem)]"

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
})

export function InterfaceTable({
  plan,
  canEdit,
  onSelectComponent,
  savePlan,
  refreshPlan,
  withEditorAccess,
  filter: { query, networkIds },
  updateFilter,
}: PlanViewProps) {
  const id = useId()

  const [sort, setSort] = useState<Sort>()
  const [draft, setDraft] = useState<InterfaceDraft>()
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<unknown>()
  const [allocation, setAllocation] = useState<{ interfaceId?: string }>()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [bulkSelection, setBulkSelection] = useState<string[]>()
  const selectedPorts = plan.interfaces.filter((port) => selected.has(port.id))
  const networksWithSubnets = new Set(
    plan.networks
      .filter((network) => network.subnet)
      .map((network) => network.id)
  )
  const allocationCandidates = new Set(
    plan.interfaces
      .filter(
        (port) =>
          port.ipv4 === null &&
          port.networkId &&
          networksWithSubnets.has(port.networkId)
      )
      .map((port) => port.id)
  )
  const flaggedPorts = new Set(
    plan.addressIssues
      ?.filter((issue) => issue.code === "duplicateIpv4")
      .flatMap((issue) => issue.interfaces.map((port) => port.interfaceId))
  )
  const draftPort =
    canEdit && draft
      ? plan.interfaces.find((port) => port.id === draft.interfaceId)
      : undefined
  const { components, rows, withoutInterfaces } = interfaceRows(plan, {
    query,
    networkIds,
  })
  const selectedRowCount = rows.filter(({ port }) =>
    selected.has(port.id)
  ).length

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
      <>
        <div
          className={cn(
            "flex flex-wrap items-end gap-3 border-b bg-background p-4",
            draftPort && "sticky top-0 z-10"
          )}
        >
          <div className="relative w-full max-w-sm">
            <IconSearch
              aria-hidden="true"
              className="absolute top-3.5 left-3 size-4 text-muted-foreground"
            />
            <Input
              id={`${id}-filter`}
              type="search"
              aria-label="Search component"
              placeholder="Search component"
              value={query}
              onChange={(event) => updateFilter({ query: event.target.value })}
              className="min-h-11 pl-9"
            />
          </div>
          {canEdit && plan.interfaces.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={
                  !rows.length ||
                  (selectedRowCount === rows.length &&
                    selectedPorts.length === rows.length)
                }
                onClick={() =>
                  setSelected(new Set(rows.map(({ port }) => port.id)))
                }
              >
                Select all
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={!selectedRowCount}
                onClick={() =>
                  setSelected((previous) => {
                    const next = new Set(previous)
                    for (const { port } of rows) next.delete(port.id)
                    return next
                  })
                }
              >
                Deselect all
              </Button>
            </div>
          )}
          {canEdit && selectedPorts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs">{selectedPorts.length} selected</span>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={Boolean(draftPort)}
                onClick={() =>
                  setBulkSelection(selectedPorts.map(({ id }) => id))
                }
              >
                <IconPencil aria-hidden="true" data-icon="inline-start" /> Edit
                selected interfaces
              </Button>
            </div>
          )}
          {canEdit && allocationCandidates.size > 0 && (
            <Button
              variant="outline"
              className="min-h-11"
              disabled={Boolean(draftPort)}
              onClick={() => setAllocation({})}
            >
              <IconWand aria-hidden="true" data-icon="inline-start" />{" "}
              Auto-assign IPv4
            </Button>
          )}
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
                <IconDeviceFloppy aria-hidden="true" data-icon="inline-start" />{" "}
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
                <IconX aria-hidden="true" data-icon="inline-start" /> Discard
                changes
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
        {plan.interfaces.length > 0 && (
          <div className="overflow-x-auto">
            <table
              aria-label="Interfaces"
              className="w-full border-collapse text-left text-xs"
            >
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  {canEdit && (
                    <th scope="col">
                      <span className="sr-only">Select interfaces</span>
                    </th>
                  )}
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
                {rows.map(
                  ({ port, component, type, network, ipv4, protocol }) => {
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
                        {canEdit && (
                          <td className="w-11 pl-2">
                            <label className="grid size-10 cursor-pointer place-items-center">
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                aria-label={`Select ${interfaceLabel}`}
                                checked={selected.has(port.id)}
                                onChange={(event) => {
                                  const checked = event.target.checked
                                  setSelected((previous) => {
                                    const next = new Set(previous)
                                    if (checked) next.add(port.id)
                                    else next.delete(port.id)
                                    return next
                                  })
                                }}
                              />
                            </label>
                          </td>
                        )}
                        <td className="px-2 sm:px-4">
                          <Button
                            variant="link"
                            className="min-h-11 px-0"
                            onClick={() => onSelectComponent(port.componentId)}
                          >
                            <span aria-hidden="true">
                              {components.has(port.componentId) && (
                                <AppearanceMark
                                  component={components.get(port.componentId)!}
                                />
                              )}
                            </span>
                            {component}
                          </Button>
                        </td>
                        <td className="px-2 py-2 sm:px-4">{type}</td>
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
                              className={cn(inputStyles, addressFieldWidth)}
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
                              className={addressFieldWidth}
                            />
                          ) : (
                            ipv4 || "—"
                          )}
                          {flaggedPorts.has(port.id) && (
                            <span className="mt-1 block font-medium text-destructive">
                              IPv4 address conflict
                            </span>
                          )}
                          {canEdit && allocationCandidates.has(port.id) && (
                            <Button
                              variant="ghost"
                              className="min-h-11 px-1"
                              disabled={Boolean(draftPort)}
                              aria-label={`Suggest IPv4 address for ${interfaceLabel}`}
                              onClick={() =>
                                setAllocation({ interfaceId: port.id })
                              }
                            >
                              <IconBulb
                                aria-hidden="true"
                                data-icon="inline-start"
                              />{" "}
                              Suggest IPv4
                            </Button>
                          )}
                        </td>
                        <td className="px-4 py-2">{protocol || "—"}</td>
                      </tr>
                    )
                  }
                )}
              </tbody>
            </table>
          </div>
        )}
        {plan.interfaces.length > 0 && !rows.length && (
          <p role="status" className="p-4 text-sm">
            No matching interfaces.
          </p>
        )}
      </>
      {plan.interfaces.length === 0 && (
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
                  <span aria-hidden="true">
                    <AppearanceMark component={component} />
                  </span>
                  {component.name}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {canEdit && bulkSelection && (
        <Dialog
          open
          onOpenChange={(open) => !open && setBulkSelection(undefined)}
        >
          <InventoryDialog
            planId={plan.id}
            bulk={{ interfaceIds: bulkSelection, networks: plan.networks }}
            close={() => setBulkSelection(undefined)}
            withEditorAccess={withEditorAccess}
            renderActions={(review) => (
              <InventoryCommitAction
                review={{
                  ...review,
                  close: () => {
                    setSelected(new Set())
                    review.close()
                  },
                }}
                bulkEdit
                onPlanChanged={refreshPlan}
                withEditorAccess={withEditorAccess}
              />
            )}
          />
        </Dialog>
      )}
      {canEdit && allocation && (
        <AddressAllocationDialog
          plan={plan}
          candidates={allocationCandidates}
          withEditorAccess={withEditorAccess}
          interfaceId={allocation.interfaceId}
          onClose={() => setAllocation(undefined)}
          onPlanChanged={refreshPlan}
        />
      )}
    </div>
  )
}
