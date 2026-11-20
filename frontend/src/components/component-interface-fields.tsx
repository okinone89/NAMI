import { IconLink, IconWand, IconX } from "@tabler/icons-react"
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
import { NativeSelect } from "@/components/ui/native-select"
import type { AddressIssue } from "@/lib/address-issues"
import type { PlanInterface, PlanNetwork } from "@/lib/plans"

export function ComponentInterfaceFields({
  port,
  networks,
  addressIssues = [],
  onChange,
  onSuggestIpv4,
  onDiscard,
  allowLink,
}: {
  allowLink: boolean
  port: PlanInterface
  networks: PlanNetwork[]
  addressIssues?: AddressIssue[]
  onChange: (port: PlanInterface) => void
  onSuggestIpv4?: () => void
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
          <NativeSelect
            id={`${id}-network`}
            value={port.networkId ?? ""}
            onChange={(event) =>
              onChange({ ...port, networkId: event.target.value || null })
            }
          >
            <option value="">No network</option>
            {networks.map((network) => (
              <option key={network.id} value={network.id}>
                {network.name}
              </option>
            ))}
          </NativeSelect>
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
          {onSuggestIpv4 && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 self-start"
              onClick={onSuggestIpv4}
            >
              <IconWand aria-hidden="true" data-icon="inline-start" /> Suggest
              IPv4
            </Button>
          )}
        </Field>
      </FieldGroup>
      <PersistedIpv4Issues issues={addressIssues} />
      <ProtocolProfileFields
        profiles={port.protocolProfiles}
        onChange={(protocolProfiles) => onChange({ ...port, protocolProfiles })}
      />
      {allowLink && (
        <Button type="submit" variant="outline" data-link-port={port.id}>
          <IconLink aria-hidden="true" data-icon="inline-start" /> Add link from{" "}
          {port.name || "interface"}
        </Button>
      )}
      {onDiscard && (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 self-start"
          onClick={onDiscard}
        >
          <IconX aria-hidden="true" data-icon="inline-start" /> Discard new
          interface
        </Button>
      )}
    </FieldSet>
  )
}
