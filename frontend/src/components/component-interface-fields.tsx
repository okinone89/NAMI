import { useId } from "react"
import { PersistedIpv4Issues } from "@/components/ipv4-issues"
import { ProtocolProfileFields } from "@/components/protocol-profile-fields"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { AddressIssue } from "@/lib/address-issues"
import type { PlanInterface, PlanNetwork } from "@/lib/plans"

export function ComponentInterfaceFields({
  port,
  networks,
  addressIssues = [],
  onChange,
  onDiscard,
}: {
  port: PlanInterface
  networks: PlanNetwork[]
  addressIssues?: AddressIssue[]
  onChange: (port: PlanInterface) => void
  onDiscard?: () => void
}) {
  const id = useId()
  return (
    <FieldSet className="min-w-0 border p-3">
      <FieldLegend className="max-w-full truncate px-1">
        {port.name.trim() || "New interface"}
      </FieldLegend>
      <FieldGroup className="gap-3 sm:grid sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Interface name</FieldLabel>
          <Input
            id={`${id}-name`}
            value={port.name}
            onChange={(event) =>
              onChange({ ...port, name: event.target.value })
            }
            required
            className="min-h-11"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-network`}>Network</FieldLabel>
          <select
            id={`${id}-network`}
            value={port.networkId ?? ""}
            onChange={(event) =>
              onChange({ ...port, networkId: event.target.value || null })
            }
            className="min-h-11 min-w-0 border border-input bg-background px-2"
          >
            <option value="">No network</option>
            {networks.map((network) => (
              <option key={network.id} value={network.id}>
                {network.name}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-ipv4`}>IPv4 address</FieldLabel>
          <Input
            id={`${id}-ipv4`}
            value={port.ipv4 ?? ""}
            onChange={(event) =>
              onChange({ ...port, ipv4: event.target.value })
            }
            spellCheck={false}
            autoComplete="off"
            className="min-h-11"
          />
        </Field>
      </FieldGroup>
      <PersistedIpv4Issues issues={addressIssues} />
      <ProtocolProfileFields
        profiles={port.protocolProfiles}
        onChange={(protocolProfiles) => onChange({ ...port, protocolProfiles })}
      />
      {onDiscard && (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 self-start"
          onClick={onDiscard}
        >
          Discard new interface
        </Button>
      )}
    </FieldSet>
  )
}
