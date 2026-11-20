import type { PlanNetwork } from "./plans"

export function defaultNetworkColor(id: string) {
  let hash = 0
  for (const character of id)
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b)
  const hue = Math.abs(hash) % 360
  // Convert the existing HSL palette to hex for the native color picker.
  const channels = [0, 8, 4].map((offset) => {
    const channel = (offset + hue / 30) % 12
    const value =
      0.39 - 0.65 * 0.39 * Math.max(-1, Math.min(channel - 3, 9 - channel, 1))
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, "0")
  })
  return "#" + channels.join("")
}

export function networkColor(network: PlanNetwork) {
  return network.color ?? defaultNetworkColor(network.id)
}
