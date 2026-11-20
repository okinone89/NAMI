import {
  addressConflictApprovals,
  type AddressIssue,
} from "@/lib/address-issues"
import type {
  InventoryImportRow,
  InventoryPreview,
  InventoryPreviewRequest,
  InventoryPreviewRow,
} from "@/lib/inventory"

export type ImportDecision = NonNullable<
  InventoryPreview["decisions"]
>[number] & {
  issue?: AddressIssue
  serverId?: string
}
export type DecisionAnswer = {
  choice: string
  edits?: Record<number, Partial<InventoryImportRow>>
}

export const correctChoice = "edit:rows"
export const skipChoice = "skip:rows"
const keepChoice = "keep:address"

function errorTarget(
  code: string,
  row: InventoryPreviewRow,
  input: InventoryImportRow
) {
  switch (code) {
    case "repeatedTarget":
      return row.interfaceId
    case "inconsistentComponentType":
      return row.componentId
    case "unknownNetwork":
    case "ambiguousNetwork":
      return input.networkName?.trim().toLowerCase()
    default:
      return row.rowNumber
  }
}

export function importDecisions(
  preview: InventoryPreview,
  request: InventoryPreviewRequest
): ImportDecision[] {
  const decisions = new Map<string, ImportDecision>()
  const inputs = new Map(request.rows.map((row) => [row.rowNumber, row]))
  const reported = new Map<number, Set<string>>()
  for (const decision of preview.decisions ?? []) {
    for (const number of decision.rowNumbers) {
      const messages = reported.get(number) ?? new Set<string>()
      messages.add(decision.message)
      reported.set(number, messages)
    }
    decisions.set(decision.id, { ...decision, serverId: decision.id })
  }
  function add(
    row: InventoryPreviewRow,
    key: string,
    title: string,
    message: string,
    issue?: AddressIssue
  ) {
    const existing = decisions.get(key)
    if (existing) {
      existing.rowNumbers.push(row.rowNumber)
      return
    }
    decisions.set(key, {
      id: key,
      title,
      message,
      rowNumbers: [row.rowNumber],
      issue,
      choices:
        issue?.code === "duplicateIpv4"
          ? [{ id: keepChoice, label: "Keep conflict flagged" }]
          : [],
    })
  }
  for (const row of preview.rows) {
    const input = inputs.get(row.rowNumber)!
    for (const error of row.errors) {
      if (reported.get(row.rowNumber)?.has(error.message)) continue
      add(
        row,
        JSON.stringify([error.code, errorTarget(error.code, row, input)]),
        "Review inventory values",
        error.message
      )
    }
    for (const issue of row.blockingAddressIssues) {
      add(
        row,
        JSON.stringify(issue),
        issue.code === "duplicateIpv4"
          ? "Resolve address conflict"
          : "Review IPv4 address",
        issue.message,
        issue
      )
    }
  }
  return [...decisions.values()]
}

// A saved answer only applies while the editor sees the same evidence and options.
export function decisionKey(
  decision: ImportDecision,
  preview: InventoryPreview,
  request: InventoryPreviewRequest
) {
  const numbers = new Set(decision.rowNumbers)
  return JSON.stringify([
    decision,
    request.rows.filter((row) => numbers.has(row.rowNumber)),
    preview.rows
      .filter((row) => numbers.has(row.rowNumber))
      .map((row) => [row.componentId, row.interfaceId, row.before]),
  ])
}

export function applyAnswer(
  request: InventoryPreviewRequest,
  decision: ImportDecision,
  answer: DecisionAnswer
): InventoryPreviewRequest {
  if (answer.choice === keepChoice && decision.issue) {
    return {
      ...request,
      keepAddressConflicts: [
        ...(request.keepAddressConflicts ?? []),
        ...addressConflictApprovals([decision.issue]),
      ],
    }
  }
  if (answer.choice === correctChoice || answer.choice === skipChoice) {
    const selected = new Set(decision.rowNumbers)
    return {
      ...request,
      rows: request.rows.map((row) =>
        selected.has(row.rowNumber)
          ? {
              ...row,
              ...(answer.choice === skipChoice
                ? { skip: true }
                : answer.edits?.[row.rowNumber]),
            }
          : row
      ),
    }
  }
  return {
    ...request,
    answers: { ...request.answers, [decision.serverId!]: answer.choice },
  }
}
