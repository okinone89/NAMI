import { useEffect, useState } from "react"
import type { AddressConflictApproval } from "@/lib/address-issues"
import {
  createPlan,
  exportPlan,
  getPlan,
  importPlan,
  listPlans,
  PlanRequestError,
  savePlan,
  type Plan,
  type PlanSummary,
} from "@/lib/plans"

export function usePlanWorkspace(
  onEditorExpired: () => void,
  automaticIpAssignment: boolean
) {
  const [plans, setPlans] = useState<PlanSummary[]>()
  const [selection, setSelection] = useState(() =>
    new URL(location.href).searchParams.get("plan")
  )
  const [snapshot, setSnapshot] = useState<Plan>()
  const [failedPlanId, setFailedPlanId] = useState<string>()
  const [listFailed, setListFailed] = useState(false)
  const [readVersion, setReadVersion] = useState(0)
  const [allocationNotice, setAllocationNotice] = useState<{
    planId: string
    count: number
  }>()
  const planId = plans?.find(({ id }) => id === selection)?.id ?? plans?.[0]?.id
  const plan = snapshot?.id === planId ? snapshot : undefined

  useEffect(() => {
    const read = new AbortController()
    void listPlans(read.signal)
      .then((plans) => {
        if (!read.signal.aborted) setPlans(plans)
      })
      .catch(() => {
        if (!read.signal.aborted) setListFailed(true)
      })
    return () => read.abort()
  }, [])

  useEffect(() => {
    if (!planId) return
    const read = new AbortController()
    void getPlan(planId, read.signal)
      .then((opened) => {
        if (read.signal.aborted) return
        setFailedPlanId(undefined)
        setSnapshot((current) =>
          current?.id === opened.id && current.revision > opened.revision
            ? current
            : opened
        )
      })
      .catch(() => {
        if (!read.signal.aborted) setFailedPlanId(planId)
      })
    return () => read.abort()
  }, [planId, readVersion])

  function selectPlan(id: string) {
    const url = new URL(location.href)
    url.searchParams.set("plan", id)
    history.replaceState(null, "", url)
    setSelection(id)
    setAllocationNotice(undefined)
  }

  async function withEditorAccess<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation
    } catch (error) {
      if (error instanceof PlanRequestError && error.status === 401)
        onEditorExpired()
      throw error
    }
  }

  function openNewPlan(created: Plan) {
    setPlans((previous) => [
      ...(previous ?? []),
      { id: created.id, name: created.name },
    ])
    setSnapshot(created)
    selectPlan(created.id)
  }

  async function addPlan(name: string) {
    openNewPlan(await withEditorAccess(createPlan(name)))
  }

  async function addPlanPackage(file: File) {
    openNewPlan(await withEditorAccess(importPlan(file)))
  }

  async function updatePlan(
    next: Plan,
    keepAddressConflicts?: AddressConflictApproval[]
  ) {
    const saved = await withEditorAccess(
      savePlan(next, keepAddressConflicts, automaticIpAssignment || undefined)
    )
    if (automaticIpAssignment && plan?.id === saved.id) {
      const connected = new Set(
        plan.interfaces.filter((port) => port.networkId).map((port) => port.id)
      )
      const subnetIds = new Set(
        saved.networks
          .filter((network) => network.subnet)
          .map((network) => network.id)
      )
      const count = saved.interfaces.filter(
        (port) =>
          port.ipv4 === null &&
          port.networkId &&
          subnetIds.has(port.networkId) &&
          !connected.has(port.id)
      ).length
      setAllocationNotice(count ? { planId: saved.id, count } : undefined)
    }
    setSnapshot((current) =>
      current?.id === saved.id && current.revision < saved.revision
        ? saved
        : current
    )
    setPlans((previous) =>
      previous?.map((summary) =>
        summary.id === saved.id ? { id: saved.id, name: saved.name } : summary
      )
    )
  }

  async function downloadPlan(plan: PlanSummary) {
    const url = URL.createObjectURL(await withEditorAccess(exportPlan(plan.id)))
    const link = document.createElement("a")
    link.href = url
    link.download = `${plan.name}.nami.json`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return {
    plans,
    plan,
    planId,
    unassignedCount:
      allocationNotice?.planId === planId ? allocationNotice?.count : undefined,
    failed:
      listFailed || (failedPlanId !== undefined && failedPlanId === planId),
    loading: !plans || (planId !== undefined && !plan),
    selectPlan,
    addPlan,
    exportPlan: downloadPlan,
    importPlan: addPlanPackage,
    savePlan: updatePlan,
    withEditorAccess,
    refreshPlan: () => setReadVersion((version) => version + 1),
  }
}
