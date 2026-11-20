import type {
  AddressConflictApproval,
  AddressIssue,
} from "@/lib/address-issues"
import type { ComponentAppearance } from "@/lib/component-appearance"
import type { InterfaceProtocolProfiles } from "@/lib/protocol-profiles"

export type PlanSummary = {
  id: string
  name: string
}

export type DiagramPosition = { x: number; y: number }
export type Ipv4Range = { start: string; end?: string | null }

export type PlanNetwork = {
  id: string
  name: string
  subnet: string | null
  position: DiagramPosition | null
  allocationPool?: Ipv4Range | null
  excludedIpv4Ranges?: Ipv4Range[] | null
}

export type Component = {
  id: string
  name: string
  type: string
  position: DiagramPosition | null
  hostId: string | null
  appearance?: ComponentAppearance
}

export type PlanInterface = {
  id: string
  componentId: string
  name: string
  networkId: string | null
  ipv4: string | null
  protocolProfiles?: InterfaceProtocolProfiles
}

export type LinkEndpoint = { componentId: string; interfaceId: string | null }
export type LinkMedium = "wired" | "wireless" | "virtual"
export type PlanLink = {
  lineType?: "elbow"
  id: string
  source: LinkEndpoint
  target: LinkEndpoint
  medium: LinkMedium
  protocol: string | null
}

export type Plan = PlanSummary & {
  revision: number
  networks: PlanNetwork[]
  components: Component[]
  interfaces: PlanInterface[]
  links: PlanLink[]
  addressIssues?: AddressIssue[]
}

export type WithEditorAccess = <T>(request: Promise<T>) => Promise<T>

export type SavePlanSnapshot = (
  plan: Plan,
  keepAddressConflicts?: AddressConflictApproval[]
) => Promise<void>

export type AddressAllocationPreview = {
  revision: number
  canApply: boolean
  assignments: {
    interfaceId: string
    networkId: string | null
    ipv4: string | null
    status: "proposed" | "assigned" | "exhausted" | "unavailable"
  }[]
}

export class PlanRequestError extends Error {
  readonly status: number
  readonly addressIssues: AddressIssue[]

  constructor(
    status: number,
    message: string,
    addressIssues: AddressIssue[] = []
  ) {
    super(message)
    this.status = status
    this.addressIssues = addressIssues
  }
}

const plansPath = "/api/plans"

function planPath(id: string) {
  return `${plansPath}/${encodeURIComponent(id)}`
}

async function requireSuccess(response: Response): Promise<Response> {
  if (response.ok) return response
  const problem = await response.json().catch(() => undefined)
  throw new PlanRequestError(
    response.status,
    problem?.title ?? "The plan request failed. Try again.",
    problem?.addressIssues
  )
}

async function readResponse<T>(response: Response): Promise<T> {
  return (await requireSuccess(response)).json()
}

export async function listPlans(signal?: AbortSignal) {
  return readResponse<PlanSummary[]>(
    await fetch(plansPath, { signal, cache: "no-store" })
  )
}

export async function getPlan(id: string, signal?: AbortSignal) {
  return readResponse<Plan>(
    await fetch(planPath(id), { signal, cache: "no-store" })
  )
}

export async function createPlan(name: string) {
  return readResponse<Plan>(
    await fetch(plansPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
  )
}

export async function exportPlan(id: string) {
  const response = await fetch(`${planPath(id)}/package`, { cache: "no-store" })
  return (await requireSuccess(response)).blob()
}

export async function importPlan(file: File) {
  return readResponse<Plan>(
    await fetch(`${plansPath}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: file,
    })
  )
}

export async function savePlan(
  plan: Plan,
  keepAddressConflicts?: AddressConflictApproval[]
) {
  return readResponse<Plan>(
    await fetch(planPath(plan.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...plan, keepAddressConflicts }),
    })
  )
}

function requestAllocation(
  id: string,
  action: "preview" | "commit",
  data: object
) {
  return fetch(`${planPath(id)}/address-allocation/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
}

export async function previewAddressAllocation(
  id: string,
  interfaceIds: string[]
) {
  return readResponse<AddressAllocationPreview>(
    await requestAllocation(id, "preview", { interfaceIds })
  )
}

export async function commitAddressAllocation(
  id: string,
  interfaceIds: string[],
  preview: AddressAllocationPreview
) {
  const response = await requestAllocation(id, "commit", {
    interfaceIds,
    revision: preview.revision,
    assignments: preview.assignments,
  })
  if (response.status === 409) {
    return { preview: (await response.json()) as AddressAllocationPreview }
  }
  return { saved: await readResponse<Plan>(response) }
}
