// The API stores a CIDR prefix. Each prefix has exactly one contiguous dotted mask.
const subnetMasks = Array.from({ length: 33 }, (_, prefix) =>
  [0, 8, 16, 24]
    .map((offset) => 256 - 2 ** (8 - Math.max(0, Math.min(8, prefix - offset))))
    .join(".")
)

export function subnetMask(subnet: string | null | undefined) {
  if (!subnet) return ""
  return subnetMasks[Number(subnet.split("/")[1])] ?? ""
}

export function networkCidr(address: string, mask: string) {
  if (!address && !mask) return null
  const prefix = subnetMasks.indexOf(mask)
  if (prefix < 0)
    throw new Error("Enter a contiguous subnet mask, such as 255.255.255.0.")
  const octets = address.split(".")
  if (
    octets.length !== 4 ||
    octets.some(
      (part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255
    )
  )
    throw new Error("Enter a valid IPv4 network address.")
  const maskOctets = mask.split(".").map(Number)
  const base = octets.map((octet, i) => Number(octet) & maskOctets[i]).join(".")
  if (base !== address)
    throw new Error(`Use the network address ${base} for this subnet mask.`)
  return `${address}/${prefix}`
}
