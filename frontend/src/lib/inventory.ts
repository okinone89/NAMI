import type {
  AddressConflictApproval,
  AddressIssue,
} from "@/lib/address-issues"
import { PlanRequestError, type Plan } from "@/lib/plans"

export const inventoryLinkFields = [
  { key: "linkPartner", label: "Link partner" },
  { key: "partnerPort", label: "Partner port" },
  { key: "connectionType", label: "Connection type" },
  { key: "linkProtocol", label: "Link protocol" },
] as const

export const inventoryCsvFields = [
  { key: "componentName", label: "Component" },
  { key: "interfaceName", label: "Interface" },
  { key: "componentType", label: "Component type" },
  { key: "networkName", label: "Network" },
  { key: "networkSubnet", label: "Network subnet" },
  { key: "ipv4", label: "IPv4" },
  ...inventoryLinkFields,
] as const

const inventoryIdFields = [
  { key: "componentId", label: "Component ID" },
  { key: "interfaceId", label: "Interface ID" },
  { key: "networkId", label: "Network ID" },
] as const

export const inventoryFields = [
  ...inventoryCsvFields,
  ...inventoryIdFields,
] as const

export type InventoryField = (typeof inventoryFields)[number]["key"]
export type InventoryClearField = "network" | "ipv4"
export type InventoryImportRow = Partial<Record<InventoryField, string>> & {
  rowNumber: number
  clear?: InventoryClearField[]
  removeLinkIds?: string[]
  skip?: boolean
  skipConnection?: boolean
}
export type InventoryPreviewRequest = {
  rows: InventoryImportRow[]
  answers?: Record<string, string>
  keepAddressConflicts?: AddressConflictApproval[]
}
export type InventoryValues = {
  componentName: string
  componentType: string
  interfaceName: string
  networkId: string | null
  networkName: string | null
  networkSubnet: string | null
  ipv4: string | null
}
export type InventoryPreviewRow = {
  rowNumber: number
  match: "id" | "name" | "addition" | "unresolved" | "skipped"
  componentId: string | null
  interfaceId: string | null
  before: InventoryValues | null
  after: InventoryValues | null
  clear: InventoryClearField[]
  addsComponent: boolean
  hasChanges: boolean
  canApply: boolean
  errors: { code: string; message: string }[]
  addressIssues: AddressIssue[]
  blockingAddressIssues: AddressIssue[]
  connections?: { id: string; label: string }[]
}
export type InventoryPreview = {
  links?: { rowNumbers: number[]; summary: string | null }[]
  decisions?: {
    id: string
    title: string
    message: string
    rowNumbers: number[]
    scope?: "connection" | null
    choices: { id: string; label: string }[]
  }[]
  rows: InventoryPreviewRow[]
  stateToken: string
  canApply: boolean
}
export type InventoryUndoStatus = {
  importId: string
  canUndo: boolean
  reason: string | null
}
type InventoryCommitResult =
  | { preview: InventoryPreview }
  | { plan: Plan; undo: InventoryUndoStatus | null }
export type InventoryMapping = (InventoryField | "")[]
type SpreadsheetRow = { rowNumber: number; cells: string[] }
type Spreadsheet = { headings: string[]; rows: SpreadsheetRow[] }

export function inventoryPath(planId: string) {
  return `/api/plans/${encodeURIComponent(planId)}/inventory`
}

export async function previewInventory(
  planId: string,
  request: InventoryPreviewRequest
) {
  const response = await fetch(`${inventoryPath(planId)}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  })
  if (response.ok) return (await response.json()) as InventoryPreview
  throw await inventoryError(
    response,
    "Unable to preview the inventory. Try again."
  )
}

export async function commitInventory(
  planId: string,
  request: InventoryPreviewRequest,
  stateToken: string,
  bulkEdit: boolean
): Promise<InventoryCommitResult> {
  const response = await fetch(`${inventoryPath(planId)}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, stateToken, bulkEdit }),
  })
  if (response.status === 409) return { preview: await response.json() }
  if (response.ok) return await response.json()
  throw await inventoryError(
    response,
    "Unable to apply the changes. Try again."
  )
}

export async function getInventoryUndo(planId: string, signal: AbortSignal) {
  const response = await fetch(`${inventoryPath(planId)}/undo`, {
    signal,
    cache: "no-store",
  })
  if (response.status === 204) return undefined
  if (response.ok) return (await response.json()) as InventoryUndoStatus
  throw await inventoryError(
    response,
    "Unable to check whether the import can be undone."
  )
}

export async function undoInventory(planId: string, importId: string) {
  const response = await fetch(`${inventoryPath(planId)}/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ importId }),
  })
  if (!response.ok)
    throw await inventoryError(
      response,
      "Unable to undo the import. Try again."
    )
}

async function inventoryError(response: Response, fallback: string) {
  const problem = await response.json().catch(() => null)
  return new PlanRequestError(response.status, problem?.title ?? fallback)
}

export function defaultInventoryMapping(headings: string[]): InventoryMapping {
  return headings.map(
    (heading) =>
      inventoryCsvFields.find((field) => field.label === heading)?.key ?? ""
  )
}

export function mapInventoryRows(
  sheet: Spreadsheet,
  mapping: InventoryMapping
): InventoryImportRow[] {
  return sheet.rows.map(({ cells, rowNumber }) => {
    const row: InventoryImportRow = { rowNumber }
    mapping.forEach((field, index) => {
      if (field && cells[index] !== undefined) row[field] = cells[index]
    })
    return row
  })
}

function sheetDelimiter(source: string) {
  let quoted = false
  for (const character of source.replace(/^(?:[ \t]*(?:\r\n|[\r\n]))+/, "")) {
    if (character === '"') quoted = !quoted
    if (quoted) continue
    if (character === "\t") return "\t"
    if (character === "\n" || character === "\r") break
  }
  return ","
}

export function parseInventory(input: string): Spreadsheet {
  const source = input.replace(/^\uFEFF/, "")
  const separator = sheetDelimiter(source)
  const records: SpreadsheetRow[] = []
  let cells: string[] = []
  let value = ""
  let quoted = false
  let closedQuote = false
  let rowNumber = 1
  let lineNumber = 1

  function finishRow() {
    cells.push(value)
    if (cells.some((cell) => cell.trim())) records.push({ rowNumber, cells })
    cells = []
    value = ""
    closedQuote = false
  }

  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    const lineBreak = character === "\r" || character === "\n"
    const crlf = character === "\r" && source[index + 1] === "\n"
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"'
        index++
      } else if (character === '"') {
        quoted = false
        closedQuote = true
      } else if (lineBreak) {
        value += crlf ? "\r\n" : character
        if (crlf) index++
        lineNumber++
      } else {
        value += character
      }
      continue
    }

    if (lineBreak) {
      finishRow()
      if (crlf) index++
      rowNumber = ++lineNumber
    } else if (character === separator) {
      cells.push(value)
      value = ""
      closedQuote = false
    } else if (!closedQuote && character === '"' && !value) {
      quoted = true
    } else if (closedQuote || character === '"') {
      throw new Error(`Check the quotes in spreadsheet row ${rowNumber}.`)
    } else {
      value += character
    }
  }

  if (quoted)
    throw new Error(`Close the quoted value in spreadsheet row ${rowNumber}.`)
  finishRow()
  const [header, ...rows] = records
  if (
    header?.cells.some((heading) =>
      inventoryIdFields.some(
        (field) => field.label.toLowerCase() === heading.trim().toLowerCase()
      )
    )
  ) {
    throw new Error(
      "This file contains legacy ID headers. Choose Export inventory CSV to obtain the current format."
    )
  }
  const headings = header?.cells.map((heading) => heading.trim()) ?? []
  if (
    headings.length !== inventoryCsvFields.length ||
    !inventoryCsvFields.every((field) => headings.includes(field.label))
  ) {
    throw new Error(
      "Use all ten current headers exactly once. Choose Export inventory CSV to obtain the current format."
    )
  }
  if (
    rows.some((row) =>
      row.cells.slice(headings.length).some((cell) => cell.trim())
    )
  ) {
    throw new Error(
      "Some rows have more cells than the header. Add headings for those columns."
    )
  }
  return { headings, rows }
}
