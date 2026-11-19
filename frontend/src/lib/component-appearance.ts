export const builtInSymbols = {
  plc: "PLC",
  hmi: "HMI",
  switch: "Switch",
  router: "Router",
  accessPoint: "Access point",
  server: "Server",
  vm: "Virtual machine",
  computer: "Computer",
  generic: "Generic device",
}

export type BuiltInSymbol = keyof typeof builtInSymbols

export const componentShapes = {
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
}
export type ComponentShape = keyof typeof componentShapes
export const maxShapeLabelLength = 48

export type ComponentAppearance =
  | { kind: "builtIn"; symbol: BuiltInSymbol }
  | { kind: "custom"; imageData: string }
  | { kind: "shape"; shape: ComponentShape; label: string }

export function defaultSymbol(type: string): BuiltInSymbol {
  const normalized = type.trim().toLowerCase()
  if (normalized === "access point") return "accessPoint"
  return Object.hasOwn(builtInSymbols, normalized)
    ? (normalized as BuiltInSymbol)
    : "generic"
}
