import {
  IconClipboard,
  IconEye,
  IconFlag,
  IconPencil,
  IconRefresh,
} from "@tabler/icons-react"
import { useId, useRef, useState, type ReactNode } from "react"
import type { DecisionAnswer } from "@/lib/import-decisions"
import { ImportWizard } from "@/components/import-wizard"
import { PreviewValues } from "@/components/inventory-values"
import { Ipv4IssueList } from "@/components/ipv4-issues"
import { Button } from "@/components/ui/button"
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  addressConflictApprovals,
  type AddressConflictApproval,
} from "@/lib/address-issues"
import {
  defaultInventoryMapping,
  inventoryFields,
  mapInventoryRows,
  parseInventory,
  previewInventory,
  type InventoryClearField,
  type InventoryImportRow,
  type InventoryPreview,
  type InventoryPreviewRequest,
  type InventoryPreviewRow,
} from "@/lib/inventory"
import type { PlanNetwork, WithEditorAccess } from "@/lib/plans"

export type InventoryReview = {
  request: InventoryPreviewRequest
  preview: InventoryPreview
}

export type InventoryReviewActions = InventoryReview & {
  planId: string
  close: () => void
  replacePreview: (preview: InventoryPreview) => void
  submitting: boolean
  setSubmitting: (submitting: boolean) => void
}

type BulkSelection = {
  interfaceIds: string[]
  networks: PlanNetwork[]
  automaticIpAssignment?: boolean
}

export function InventoryDialog({
  planId,
  close,
  renderActions,
  withEditorAccess,
  bulk,
}: {
  planId: string
  close: () => void
  renderActions?: (review: InventoryReviewActions) => ReactNode
  withEditorAccess: WithEditorAccess
  bulk?: BulkSelection
}) {
  const id = useId()
  const [pasted, setPasted] = useState("")
  const [sheet, setSheet] = useState<ReturnType<typeof parseInventory>>()
  const [savedAnswers, setSavedAnswers] = useState<
    Record<string, DecisionAnswer>
  >({})
  const [review, setReview] = useState<InventoryReview>()
  const [edits, setEdits] = useState<
    Record<number, Partial<InventoryImportRow>>
  >({})
  const [busy, setBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const body = useRef<HTMLFieldSetElement>(null)
  const dirty = Object.keys(edits).length > 0
  const inputs = new Map(
    review?.request.rows.map((row) => [row.rowNumber, row])
  )

  function load(source: string) {
    setReview(undefined)
    setEdits({})
    setError("")
    try {
      const parsed = parseInventory(source)
      setSheet(parsed)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to read the spreadsheet."
      )
      setSheet(undefined)
    }
  }

  async function loadFile(file?: File) {
    if (!file) return
    setBusy(true)
    try {
      load(await file.text())
    } catch {
      setError("Unable to open the CSV file.")
    } finally {
      setBusy(false)
    }
  }

  async function preview(request: InventoryPreviewRequest) {
    if (bulk?.automaticIpAssignment)
      request = { ...request, automaticIpAssignment: true }
    setBusy(true)
    setError("")
    try {
      setReview({
        request,
        preview: await withEditorAccess(previewInventory(planId, request)),
      })
      setEdits({})
      if (!review) body.current?.scrollTo(0, 0)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to preview the inventory."
      )
    } finally {
      setBusy(false)
    }
  }

  if (!bulk && review) {
    return (
      <ImportWizard
        initialReview={review}
        planId={planId}
        close={close}
        savedAnswers={savedAnswers}
        backToSource={(answers) => {
          setSavedAnswers(answers)
          setReview(undefined)
        }}
        renderActions={renderActions}
        withEditorAccess={withEditorAccess}
      />
    )
  }

  return (
    <DialogContent
      className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl"
      showCloseButton={!submitting}
    >
      <DialogHeader className="pr-8">
        <DialogTitle>
          {bulk ? "Bulk edit interfaces" : "Import inventory"}
        </DialogTitle>
        <DialogDescription>
          {bulk
            ? `Review changes to ${bulk.interfaceIds.length} selected interfaces before applying them.`
            : "Upload an exported inventory CSV or paste its rows with the headers. Blank cells keep existing values."}
        </DialogDescription>
      </DialogHeader>
      <fieldset
        ref={body}
        disabled={busy || submitting}
        className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain p-1"
      >
        {bulk && (
          <BulkInventoryFields
            selection={bulk}
            hidden={Boolean(review)}
            onPreview={(rows) => void preview({ rows })}
          />
        )}
        {!bulk && !review && (
          <>
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor={`${id}-file`}>CSV file</FieldLabel>
                <Input
                  id={`${id}-file`}
                  type="file"
                  accept=".csv,text/csv"
                  className="min-h-11"
                  onChange={(event) => {
                    void loadFile(event.currentTarget.files?.[0])
                    event.currentTarget.value = ""
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-paste`}>
                  Spreadsheet rows
                </FieldLabel>
                <textarea
                  id={`${id}-paste`}
                  rows={3}
                  className="min-h-11 resize-y border bg-background p-2"
                  value={pasted}
                  onChange={(event) => {
                    setPasted(event.target.value)
                    setSheet(undefined)
                    setError("")
                  }}
                />
              </Field>
            </FieldGroup>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 self-start"
              disabled={!pasted.trim()}
              onClick={() => load(pasted)}
            >
              <IconClipboard aria-hidden="true" data-icon="inline-start" /> Load
              pasted rows
            </Button>
            {sheet && (
              <div className="flex min-w-0 flex-col gap-3 border-t pt-4">
                <p>
                  {sheet.rows.length} source{" "}
                  {sheet.rows.length === 1 ? "row" : "rows"} loaded
                </p>
                <Button
                  type="button"
                  className="min-h-11 self-start"
                  onClick={() =>
                    void preview({
                      rows: mapInventoryRows(
                        sheet,
                        defaultInventoryMapping(sheet.headings)
                      ),
                    })
                  }
                >
                  <IconEye aria-hidden="true" data-icon="inline-start" />{" "}
                  {busy ? "Loading…" : "Preview import"}
                </Button>
              </div>
            )}
          </>
        )}
        {review && (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">Bulk edit preview</h3>
            {review.preview.unassignedIpv4Count && (
              <p role="status">
                The allocation pool ran out of addresses.{" "}
                {review.preview.unassignedIpv4Count}{" "}
                {review.preview.unassignedIpv4Count === 1
                  ? "interface will"
                  : "interfaces will"}{" "}
                be saved without IPv4.
              </p>
            )}
            {review.preview.rows.map((row) => (
              <PreviewRow
                key={row.rowNumber}
                row={row}
                draft={{
                  ...inputs.get(row.rowNumber),
                  ...edits[row.rowNumber],
                  rowNumber: row.rowNumber,
                }}
                canKeep={!dirty && !busy && !submitting}
                onEdit={(changes) =>
                  setEdits((previous) => ({
                    ...previous,
                    [row.rowNumber]: { ...previous[row.rowNumber], ...changes },
                  }))
                }
                onKeep={(approval) =>
                  void preview({
                    ...review.request,
                    keepAddressConflicts: [
                      ...(review.request.keepAddressConflicts ?? []),
                      approval,
                    ],
                  })
                }
              />
            ))}
          </div>
        )}
      </fieldset>
      {(review || error) && (
        <div className="flex flex-wrap items-center gap-2">
          {error && <FieldError className="basis-full">{error}</FieldError>}
          {review && (
            <>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy || submitting}
                onClick={() => {
                  setReview(undefined)
                  setEdits({})
                  setError("")
                }}
              >
                <IconPencil aria-hidden="true" data-icon="inline-start" />{" "}
                Change bulk values
              </Button>
              {dirty && (
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() =>
                    void preview({
                      rows: review.request.rows.map((row) => ({
                        ...row,
                        ...edits[row.rowNumber],
                      })),
                    })
                  }
                >
                  <IconRefresh aria-hidden="true" data-icon="inline-start" />{" "}
                  {busy ? "Updating…" : "Update preview"}
                </Button>
              )}
              {!busy &&
                !dirty &&
                renderActions?.({
                  ...review,
                  planId,
                  close,
                  submitting,
                  setSubmitting,
                  replacePreview: (next) =>
                    setReview({ ...review, preview: next }),
                })}
            </>
          )}
        </div>
      )}
    </DialogContent>
  )
}

function BulkInventoryFields({
  selection,
  hidden,
  onPreview,
}: {
  selection: BulkSelection
  hidden: boolean
  onPreview: (rows: InventoryImportRow[]) => void
}) {
  const id = useId()
  const [network, setNetwork] = useState("")
  const [ipv4, setIpv4] = useState("")
  const [clearIpv4, setClearIpv4] = useState(false)

  function preview() {
    const clear: InventoryClearField[] = []
    if (network === "clear") clear.push("network")
    if (clearIpv4) clear.push("ipv4")
    onPreview(
      selection.interfaceIds.map((interfaceId, index) => ({
        rowNumber: index + 1,
        interfaceId,
        networkId: network.startsWith("id:") ? network.slice(3) : undefined,
        ipv4: clearIpv4 ? undefined : ipv4.trim(),
        clear,
      }))
    )
  }

  if (hidden) return null
  return (
    <FieldGroup className="gap-3">
      <Field>
        <FieldLabel htmlFor={`${id}-network`}>Network membership</FieldLabel>
        <select
          id={`${id}-network`}
          className="min-h-11 border bg-background px-2"
          value={network}
          onChange={(event) => setNetwork(event.target.value)}
        >
          <option value="">Keep current network</option>
          <option value="clear">Clear network membership</option>
          {selection.networks.map((item) => (
            <option key={item.id} value={`id:${item.id}`}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-ipv4`}>IPv4 address</FieldLabel>
        <Input
          id={`${id}-ipv4`}
          className="min-h-11"
          placeholder="Keep current IPv4 addresses"
          value={ipv4}
          disabled={clearIpv4}
          onChange={(event) => setIpv4(event.target.value)}
        />
      </Field>
      <FieldLabel className="min-h-11 items-center">
        <input
          type="checkbox"
          checked={clearIpv4}
          onChange={(event) => setClearIpv4(event.target.checked)}
        />
        Clear IPv4 addresses
      </FieldLabel>
      <Button
        type="button"
        className="min-h-11 self-start"
        onClick={preview}
        disabled={!network && !ipv4.trim() && !clearIpv4}
      >
        <IconEye aria-hidden="true" data-icon="inline-start" /> Preview changes
      </Button>
    </FieldGroup>
  )
}

function PreviewRow({
  row,
  draft,
  canKeep,
  onEdit,
  onKeep,
}: {
  row: InventoryPreviewRow
  draft: InventoryImportRow
  canKeep: boolean
  onEdit: (changes: Partial<InventoryImportRow>) => void
  onKeep: (approval: AddressConflictApproval) => void
}) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const values = row.after ?? row.before
  const labels = {
    id: "Matched by ID",
    name: "Matched by name",
    addition: row.addsComponent
      ? "Add component and interface"
      : "Add interface",
    unresolved: "Match needs review",
    skipped: "Skipped",
  }
  function toggleClear(field: InventoryClearField, checked: boolean) {
    const clear = draft.clear ?? []
    onEdit({
      clear: checked
        ? [...clear, field]
        : clear.filter((item) => item !== field),
    })
  }
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-2 border p-3 wrap-break-word"
    >
      <div>
        <h4 id={id} className="font-medium">
          Row {row.rowNumber}
        </h4>
        {values && (
          <p>
            {values.componentName} / {values.interfaceName}
          </p>
        )}
        {!values && (draft.componentName || draft.interfaceName) && (
          <p>
            {[draft.componentName, draft.interfaceName]
              .filter(Boolean)
              .join(" / ")}
          </p>
        )}
        <p className="text-muted-foreground">{labels[row.match]}</p>
        {!row.hasChanges && !row.errors.length && row.match !== "skipped" && (
          <p>No changes</p>
        )}
      </div>
      {values &&
        (row.hasChanges ||
          row.clear.length > 0 ||
          row.errors.length > 0 ||
          row.addressIssues.length > 0) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {row.before && <PreviewValues label="Before" values={row.before} />}
            {row.after && (
              <PreviewValues
                label="After"
                values={row.after}
                clear={row.clear}
              />
            )}
          </div>
        )}
      {row.errors.map((error) => (
        <FieldError key={error.code}>{error.message}</FieldError>
      ))}
      {row.addressIssues.map((issue) => {
        const blocked = row.blockingAddressIssues.some(
          (problem) =>
            issue.code === problem.code &&
            issue.networkId === problem.networkId &&
            issue.ipv4 === problem.ipv4
        )
        const [approval] = addressConflictApprovals([issue])
        return (
          <div
            key={issue.code}
            className="flex flex-col gap-2 text-destructive"
          >
            <Ipv4IssueList issues={[issue]} />
            {approval &&
              (blocked ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 self-start"
                  disabled={!canKeep || draft.skip}
                  onClick={() => onKeep(approval)}
                >
                  <IconFlag aria-hidden="true" data-icon="inline-start" /> Keep
                  conflict flagged
                </Button>
              ) : (
                <p>Conflict kept and flagged</p>
              ))}
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-3">
        {!draft.skip && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            aria-expanded={editing}
            onClick={() => setEditing(!editing)}
          >
            <IconPencil aria-hidden="true" data-icon="inline-start" />{" "}
            {editing ? "Hide row fields" : "Correct row"}
          </Button>
        )}
        <FieldLabel className="min-h-11 items-center">
          <input
            type="checkbox"
            checked={draft.skip ?? false}
            onChange={(event) => onEdit({ skip: event.target.checked })}
          />
          Skip row
        </FieldLabel>
      </div>
      {editing && !draft.skip && (
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          {inventoryFields
            .filter(
              ({ key }) =>
                key === "networkId" || key === "networkName" || key === "ipv4"
            )
            .map(({ key, label }) => (
              <Field key={key}>
                <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
                <Input
                  id={`${id}-${key}`}
                  className="min-h-11"
                  value={draft[key] ?? ""}
                  onChange={(event) => onEdit({ [key]: event.target.value })}
                />
              </Field>
            ))}
          <FieldLabel className="min-h-11 items-center">
            <input
              type="checkbox"
              checked={draft.clear?.includes("network") ?? false}
              onChange={(event) => toggleClear("network", event.target.checked)}
            />
            Clear network value
          </FieldLabel>
          <FieldLabel className="min-h-11 items-center">
            <input
              type="checkbox"
              checked={draft.clear?.includes("ipv4") ?? false}
              onChange={(event) => toggleClear("ipv4", event.target.checked)}
            />
            Clear IPv4 value
          </FieldLabel>
        </FieldGroup>
      )}
    </section>
  )
}
