export type AddressInterface = {
  interfaceId: string
  interfaceName: string
  componentId: string
  componentName: string
}

export type AddressIssue = {
  code:
    | "invalidSubnet"
    | "invalidAllocationSettings"
    | "invalidIpv4"
    | "outsideSubnet"
    | "duplicateIpv4"
  message: string
  networkId: string | null
  networkName: string | null
  ipv4: string | null
  interfaces: AddressInterface[]
}

export type AddressConflictApproval = {
  networkId: string
  ipv4: string
  interfaceIds: string[]
}

export function addressConflictApprovals(issues: AddressIssue[]) {
  const approvals: AddressConflictApproval[] = []
  for (const issue of issues) {
    if (issue.code !== "duplicateIpv4" || !issue.networkId || !issue.ipv4)
      return []
    approvals.push({
      networkId: issue.networkId,
      ipv4: issue.ipv4,
      interfaceIds: issue.interfaces.map((port) => port.interfaceId),
    })
  }
  return approvals
}
