import { useId } from "react"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { Ipv4Range, PlanNetwork } from "@/lib/plans"

export function readAllocationFields(fields: FormData) {
  const start = String(fields.get("poolStart") ?? "").trim()
  const end = String(fields.get("poolEnd") ?? "").trim()
  if ((!start && end) || (start && !end)) {
    throw new Error(
      "Enter both ends of the allocation pool or leave both blank."
    )
  }

  const excludedIpv4Ranges = String(fields.get("exclusions") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map<Ipv4Range>((line) => {
      const [start, end, extra] = line.split("-").map((part) => part.trim())
      if (!start || end === "" || extra !== undefined) {
        throw new Error(
          "Enter one IPv4 address or start–end range on each line."
        )
      }
      return { start, end }
    })

  return {
    allocationPool: start ? { start, end } : null,
    excludedIpv4Ranges: excludedIpv4Ranges.length ? excludedIpv4Ranges : null,
  }
}

export function NetworkAllocationFields({
  network,
  disabled,
}: {
  network?: PlanNetwork
  disabled: boolean
}) {
  const id = useId()
  const pool = network?.allocationPool
  const exclusions = network?.excludedIpv4Ranges
    ?.map(({ start, end }) => (end ? `${start} - ${end}` : start))
    .join("\n")

  return (
    <details className="border-y py-2">
      <summary className="min-h-10 cursor-pointer py-2 font-medium">
        Allocation pool and exclusions
      </summary>
      <fieldset
        disabled={disabled}
        className="flex min-w-0 flex-col gap-4 pb-2"
      >
        <p className="text-muted-foreground">
          {disabled
            ? "Enter a subnet to configure allocation."
            : "Leave the pool blank to use the subnet’s usable host addresses."}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel htmlFor={`${id}-start`}>Pool start</FieldLabel>
            <Input
              id={`${id}-start`}
              name="poolStart"
              defaultValue={pool?.start}
              spellCheck={false}
              autoComplete="off"
              className="min-h-11"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-end`}>Pool end</FieldLabel>
            <Input
              id={`${id}-end`}
              name="poolEnd"
              defaultValue={pool?.end ?? pool?.start}
              spellCheck={false}
              autoComplete="off"
              className="min-h-11"
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`${id}-exclusions`}>
            Excluded addresses and ranges
          </FieldLabel>
          <textarea
            id={`${id}-exclusions`}
            name="exclusions"
            defaultValue={exclusions}
            aria-describedby={`${id}-help`}
            spellCheck={false}
            autoComplete="off"
            rows={3}
            className="w-full border border-input bg-background p-2 text-base disabled:opacity-50 md:text-sm"
          />
          <p id={`${id}-help`} className="text-muted-foreground">
            Enter one reserved address or range per line. Use a hyphen between
            the first and last address of a range, such as a DHCP range.
          </p>
        </Field>
      </fieldset>
    </details>
  )
}
