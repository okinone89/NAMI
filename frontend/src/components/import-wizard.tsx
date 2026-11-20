import { useId, useState, type ReactNode } from "react"
import type {
  InventoryReview,
  InventoryReviewActions,
} from "@/components/inventory-tools"
import { PreviewValues } from "@/components/inventory-values"
import { Button } from "@/components/ui/button"
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  applyAnswer,
  correctChoice,
  decisionKey,
  importDecisions,
  skipChoice,
  type DecisionAnswer,
} from "@/lib/import-decisions"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  inventoryCsvFields,
  previewInventory,
  type InventoryImportRow,
  type InventoryPreviewRequest,
  type InventoryPreviewRow,
} from "@/lib/inventory"
import type { WithEditorAccess } from "@/lib/plans"

type WizardProps = {
  initialReview: InventoryReview
  planId: string
  close: () => void
  backToSource: (answers: Record<string, DecisionAnswer>) => void
  savedAnswers: Record<string, DecisionAnswer>
  renderActions?: (review: InventoryReviewActions) => ReactNode
  withEditorAccess: WithEditorAccess
}

export function ImportWizard({
  initialReview,
  planId,
  close,
  backToSource,
  savedAnswers,
  renderActions,
  withEditorAccess,
}: WizardProps) {
  const [review, setReview] = useState(initialReview)
  const [history, setHistory] = useState<InventoryPreviewRequest[]>([])
  const [answers, setAnswers] = useState(savedAnswers)
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const pending = importDecisions(review.preview, review.request)
  const decision = pending[0]
  const key = decision && decisionKey(decision, review.preview, review.request)
  const answer = answers[key]
  const disabled = busy || submitting
  const inputs = new Map(review.request.rows.map((row) => [row.rowNumber, row]))
  const skipped = review.preview.rows
    .filter((row) => row.match === "skipped")
    .map((row) => row.rowNumber)
  const changed = review.preview.rows.filter((row) => row.hasChanges).length

  async function preview(
    request: InventoryPreviewRequest
  ): Promise<InventoryReview> {
    return {
      request,
      preview: await withEditorAccess(previewInventory(planId, request)),
    }
  }

  function refresh(refreshed: InventoryReview["preview"]) {
    setNotice("The plan changed. Review the refreshed preview before applying.")
    setError("")
    setReview({ ...review, preview: refreshed })
  }

  async function back() {
    setError("")
    if (!history.length) return backToSource(answers)
    setBusy(true)
    try {
      // Reopen the preceding decision against the current plan, even after a stale Apply.
      for (let index = history.length - 1; index >= 0; index--) {
        const current = await preview(history[index])
        if (importDecisions(current.preview, current.request).length) {
          setHistory(history.slice(0, index))
          setReview(current)
          return
        }
      }
      backToSource(answers)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to reopen this decision."
      )
    } finally {
      setBusy(false)
    }
  }

  async function next() {
    if (!decision || !answer || disabled) return
    setBusy(true)
    setError("")
    try {
      const result = await preview(
        applyAnswer(review.request, decision, answer)
      )
      const unresolved = importDecisions(result.preview, result.request)[0]
      if (
        unresolved?.id === decision.id &&
        decisionKey(unresolved, result.preview, result.request) === key
      ) {
        setError(
          "This decision still needs a change. Correct the values or choose another option."
        )
        return
      }
      setHistory([...history, review.request])
      setReview(result)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to update the preview."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent
      className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl"
      showCloseButton={!submitting}
    >
      <DialogHeader className="pr-8">
        <DialogTitle>Import inventory</DialogTitle>
        <DialogDescription>
          {decision
            ? `Decision ${history.length + 1} of ${history.length + pending.length}`
            : "Review proposed changes before applying the import."}
        </DialogDescription>
      </DialogHeader>
      <fieldset
        key={key || "summary"}
        disabled={disabled}
        className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto p-1"
      >
        {decision ? (
          <>
            <h3 className="font-medium">{decision.title}</h3>
            <p className="whitespace-pre-line">{decision.message}</p>
            {decision.issue && (
              <ul className="list-disc pl-5">
                {decision.issue.interfaces.map((port) => (
                  <li key={port.interfaceId}>
                    {port.componentName} / {port.interfaceName}
                  </li>
                ))}
              </ul>
            )}
            <fieldset className="grid gap-1">
              <legend className="font-medium">Choose a resolution</legend>
              {[
                ...decision.choices,
                { id: correctChoice, label: "Correct values" },
                { id: skipChoice, label: "Skip affected rows" },
              ].map((choice) => (
                <label
                  key={choice.id}
                  className="flex min-h-10 cursor-pointer items-center gap-2 border px-3"
                >
                  <input
                    type="radio"
                    name="resolution"
                    checked={answer?.choice === choice.id}
                    onChange={() =>
                      setAnswers({
                        ...answers,
                        [key]: { ...answer, choice: choice.id },
                      })
                    }
                  />
                  {choice.label}
                </label>
              ))}
            </fieldset>
            {review.preview.rows
              .filter((row) => decision.rowNumbers.includes(row.rowNumber))
              .map((row) => (
                <RowDetails
                  key={row.rowNumber}
                  row={row}
                  input={inputs.get(row.rowNumber)!}
                >
                  {answer?.choice === correctChoice && (
                    <RowCorrection
                      input={{
                        ...inputs.get(row.rowNumber)!,
                        ...answer.edits?.[row.rowNumber],
                      }}
                      onEdit={(changes) =>
                        setAnswers({
                          ...answers,
                          [key]: {
                            ...answer,
                            edits: {
                              ...answer.edits,
                              [row.rowNumber]: {
                                ...answer.edits?.[row.rowNumber],
                                ...changes,
                              },
                            },
                          },
                        })
                      }
                    />
                  )}
                </RowDetails>
              ))}
          </>
        ) : (
          <>
            <h3 className="font-medium">Import summary</h3>
            <p>
              {changed
                ? `${changed} ${changed === 1 ? "row has" : "rows have"} changes.`
                : "No changes"}
            </p>
            {skipped.length > 0 && (
              <p>
                Skipped {skipped.length === 1 ? "row" : "rows"}{" "}
                {skipped.join(", ")}
              </p>
            )}
            <details>
              <summary className="cursor-pointer py-2">Review rows</summary>
              {review.preview.rows.map((row) => (
                <RowDetails
                  key={row.rowNumber}
                  row={row}
                  input={inputs.get(row.rowNumber)!}
                />
              ))}
            </details>
          </>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        {notice && (
          <p role="status" className="basis-full">
            {notice}
          </p>
        )}
        {error && <FieldError className="basis-full">{error}</FieldError>}
        <Button variant="outline" disabled={disabled} onClick={back}>
          Back
        </Button>
        <Button variant="outline" disabled={disabled} onClick={close}>
          Cancel
        </Button>
        {decision ? (
          <Button
            disabled={
              disabled ||
              !answer ||
              (answer.choice === correctChoice &&
                !Object.keys(answer.edits ?? {}).length)
            }
            onClick={() => void next()}
          >
            Next
          </Button>
        ) : (
          renderActions?.({
            ...review,
            planId,
            close,
            submitting,
            setSubmitting,
            replacePreview: refresh,
          })
        )}
      </div>
    </DialogContent>
  )
}

function RowCorrection({
  input,
  onEdit,
}: {
  input: InventoryImportRow
  onEdit: (changes: Partial<InventoryImportRow>) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {inventoryCsvFields.map(({ key, label }) => (
        <label key={key}>
          {label}
          <Input
            value={input[key] ?? ""}
            onChange={(event) => onEdit({ [key]: event.target.value })}
          />
        </label>
      ))}
      {(["network", "ipv4"] as const).map((field) => (
        <label className="flex items-center gap-2" key={field}>
          <input
            type="checkbox"
            checked={input.clear?.includes(field) ?? false}
            onChange={(event) =>
              onEdit({
                clear: event.target.checked
                  ? [...(input.clear ?? []), field]
                  : input.clear?.filter((item) => item !== field),
              })
            }
          />
          {field === "ipv4" ? "Clear IPv4 value" : "Clear network value"}
        </label>
      ))}
    </div>
  )
}

function RowDetails({
  row,
  input,
  children,
}: {
  row: InventoryPreviewRow
  input: InventoryImportRow
  children?: ReactNode
}) {
  const id = useId()
  const values = row.after ?? row.before ?? input
  return (
    <section
      aria-labelledby={id}
      className="mb-2 flex flex-col gap-2 border p-3 wrap-break-word"
    >
      <h4 id={id} className="font-medium">
        Row {row.rowNumber}
      </h4>
      <p>
        {[values.componentName, values.interfaceName]
          .filter(Boolean)
          .join(" / ") || input.networkName}
      </p>
      <p>
        {row.match === "skipped"
          ? "Skipped"
          : row.errors.length
            ? "Needs review"
            : !row.hasChanges
              ? "No changes"
              : row.addsComponent
                ? "Add component"
                : row.match === "addition"
                  ? row.componentId
                    ? "Add interface"
                    : "Add network"
                  : "Update"}
      </p>
      {row.hasChanges && (
        <div className="grid gap-2 sm:grid-cols-2">
          {row.before && <PreviewValues label="Before" values={row.before} />}
          {row.after && (
            <PreviewValues label="After" values={row.after} clear={row.clear} />
          )}
        </div>
      )}
      {row.errors.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2">
          {inventoryCsvFields
            .filter(({ key }) => input[key])
            .map(({ key, label }) => (
              <div key={key} className="contents">
                <dt>{label}</dt>
                <dd>{input[key]}</dd>
              </div>
            ))}
        </dl>
      )}
      {children}
    </section>
  )
}
