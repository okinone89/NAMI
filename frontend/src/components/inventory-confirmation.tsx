import { IconArrowBackUp, IconCheck } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import type { InventoryReviewActions } from "@/components/inventory-tools"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import {
  commitInventory,
  getInventoryUndo,
  undoInventory,
  type InventoryUndoStatus,
} from "@/lib/inventory"
import type { WithEditorAccess } from "@/lib/plans"

type ChangeCallbacks = {
  onPlanChanged?: () => void
  withEditorAccess: WithEditorAccess
}

export function InventoryCommitAction({
  review,
  bulkEdit = false,
  onImported,
  onPlanChanged,
  withEditorAccess,
}: ChangeCallbacks & {
  review: InventoryReviewActions
  onImported?: (id: string) => void
  bulkEdit?: boolean
}) {
  const { planId, request, preview, submitting, setSubmitting } = review
  const [failure, setFailure] = useState("")
  const [notice, setNotice] = useState("")
  const { canApply } = preview

  async function confirm() {
    if (submitting || !canApply) return
    setSubmitting(true)
    setFailure("")
    setNotice("")
    try {
      const result = await withEditorAccess(
        commitInventory(planId, request, preview.stateToken, bulkEdit)
      )
      onPlanChanged?.()
      if ("preview" in result) {
        review.replacePreview(result.preview)
        setNotice(
          "The plan changed. Review the refreshed preview before confirming."
        )
      } else {
        if (result.undo) onImported?.(result.undo.importId)
        review.close()
      }
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Unable to apply the changes."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {notice && (
        <p role="status" className="order-first basis-full">
          {notice}
        </p>
      )}
      {failure && (
        <FieldError className="order-first basis-full">{failure}</FieldError>
      )}
      <Button
        type="button"
        className="min-h-11"
        disabled={submitting || !canApply}
        onClick={() => void confirm()}
      >
        <IconCheck aria-hidden="true" data-icon="inline-start" />{" "}
        {submitting
          ? "Applying…"
          : bulkEdit
            ? "Apply bulk changes"
            : "Apply import"}
      </Button>
    </>
  )
}

export function InventoryUndoControl({
  planId,
  revision,
  sessionImportId,
  onPlanChanged,
  withEditorAccess,
}: ChangeCallbacks & {
  planId: string
  sessionImportId?: string
  revision: number
}) {
  const [status, setStatus] = useState<InventoryUndoStatus>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState("")
  const [readVersion, setReadVersion] = useState(0)

  useEffect(() => {
    const read = new AbortController()
    void getInventoryUndo(planId, read.signal)
      .then((available) => {
        if (!read.signal.aborted) setStatus(available)
      })
      .catch(() => {
        if (!read.signal.aborted) setStatus(undefined)
      })
    return () => read.abort()
  }, [planId, revision, readVersion])

  async function undo() {
    if (!status?.canUndo || busy) return
    setBusy(true)
    setFailure("")
    try {
      await withEditorAccess(undoInventory(planId, status.importId))
      setStatus(undefined)
      onPlanChanged?.()
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Unable to undo the import."
      )
      setReadVersion((version) => version + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {status?.canUndo && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={busy}
          onClick={() => void undo()}
        >
          <IconArrowBackUp aria-hidden="true" data-icon="inline-start" />{" "}
          {busy ? "Undoing…" : "Undo import"}
        </Button>
      )}
      {status && status.importId === sessionImportId && !status.canUndo ? (
        <p role="status" className="text-xs">
          Undo unavailable. {status.reason}
        </p>
      ) : (
        failure && <FieldError>{failure}</FieldError>
      )}
    </>
  )
}
