import { IconFlag } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  addressConflictApprovals,
  type AddressConflictApproval,
  type AddressIssue,
} from "@/lib/address-issues"
import { PlanRequestError } from "@/lib/plans"

export function Ipv4IssueList({ issues }: { issues: AddressIssue[] }) {
  return (
    <ul className="flex flex-col gap-2 break-words">
      {issues.map((issue) => (
        <li
          key={JSON.stringify([
            issue.code,
            issue.networkId,
            issue.ipv4,
            issue.interfaces.map((port) => port.interfaceId),
          ])}
        >
          <p>{issue.message}</p>
          {issue.code === "duplicateIpv4" && (
            <ul className="list-disc pl-5">
              {issue.interfaces.map((port) => (
                <li key={port.interfaceId}>
                  {port.componentName} / {port.interfaceName}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

export function PersistedIpv4Issues({ issues }: { issues: AddressIssue[] }) {
  if (!issues.length) return null
  return (
    <div className="mt-2 text-xs text-destructive">
      {issues.some((issue) => issue.code === "duplicateIpv4") && (
        <p className="font-medium">IPv4 address conflict</p>
      )}
      <Ipv4IssueList issues={issues} />
    </div>
  )
}

export function AddressSaveFeedback({
  failure,
  fallback,
  disabled,
  onKeep,
}: {
  failure: unknown
  fallback: string
  disabled: boolean
  onKeep?: (approvals: AddressConflictApproval[]) => void
}) {
  if (!failure) return null
  const issues =
    failure instanceof PlanRequestError ? failure.addressIssues : []
  const approvals = addressConflictApprovals(issues)
  return (
    <div className="basis-full text-sm">
      <div role="alert" className="text-destructive">
        {issues.length ? (
          <Ipv4IssueList issues={issues} />
        ) : failure instanceof Error ? (
          failure.message
        ) : (
          fallback
        )}
      </div>
      {!!approvals.length && onKeep && (
        <Button
          type="button"
          variant="outline"
          onClick={() => onKeep(approvals)}
          disabled={disabled}
          className="mt-2 min-h-11"
        >
          <IconFlag aria-hidden="true" data-icon="inline-start" /> Keep
          conflicts flagged
        </Button>
      )}
    </div>
  )
}
