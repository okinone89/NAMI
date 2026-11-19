export type PlanSummary = {
  id: string
  name: string
}

export type DiagramPosition = { x: number; y: number }

export type PlanNetwork = {
  id: string
  name: string
  subnet: string | null
  position: DiagramPosition | null
}

export type Component = {
  id: string
  name: string
  type: string
  position: DiagramPosition | null
  hostId: string | null
}

export type PlanInterface = {
  id: string
  componentId: string
  name: string
  networkId: string | null
  ipv4: string | null
}

export type LinkEndpoint = { componentId: string; interfaceId: string | null }
export type LinkMedium = "wired" | "wireless" | "virtual"
export type PlanLink = {
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
}

export class PlanRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const plansPath = "/api/plans"

function planPath(id: string) {
  return `${plansPath}/${encodeURIComponent(id)}`
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json()
  const problem = await response.json().catch(() => undefined)
  throw new PlanRequestError(
    response.status,
    problem?.title ?? "The plan request failed. Try again."
  )
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

export async function savePlan(plan: Plan) {
  return readResponse<Plan>(
    await fetch(planPath(plan.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan),
    })
  )
}
