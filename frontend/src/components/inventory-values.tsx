import type { InventoryClearField, InventoryValues } from "@/lib/inventory"

export function PreviewValues({
  label,
  values,
  clear = [],
}: {
  label: string
  values: InventoryValues
  clear?: InventoryClearField[]
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-col gap-1 bg-muted/50 p-2"
    >
      <h5 className="font-medium">{label}</h5>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2">
        {values.componentName && (
          <>
            <dt>Component type</dt>
            <dd>{values.componentType}</dd>
          </>
        )}
        <dt>Network</dt>
        <dd>
          {clear.includes("network")
            ? "Clear value"
            : (values.networkName ?? "—")}
        </dd>
        {values.networkName && (
          <>
            <dt>Network subnet</dt>
            <dd>{values.networkSubnet ?? "—"}</dd>
          </>
        )}
        {values.interfaceName && (
          <>
            <dt>IPv4 address</dt>
            <dd>
              {clear.includes("ipv4") ? "Clear value" : (values.ipv4 ?? "—")}
            </dd>
          </>
        )}
      </dl>
    </div>
  )
}
