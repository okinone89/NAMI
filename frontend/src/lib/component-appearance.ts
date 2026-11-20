export const builtInSymbols = {
  plc: "PLC",
  hmi: "HMI",
  switch: "Switch",
  router: "Router",
  accessPoint: "Access point",
  server: "Server",
  vm: "Virtual machine",
  computer: "Computer",
  vfd: "VFD",
  servoDrive: "Servo drive",
  ioLinkMaster: "IO-Link master",
  ioLinkHub: "IO-Link I/O hub",
  ioLinkDevice: "IO-Link device",
  remoteIo: "Remote I/O station",
  safetyPlc: "Safety PLC",
  protocolGateway: "Protocol gateway",
  visionCamera: "Vision camera",
  barcodeReader: "Barcode reader",
  generic: "Generic device",
}

export type BuiltInSymbol = keyof typeof builtInSymbols

export const symbolKeys = Object.keys(builtInSymbols) as BuiltInSymbol[]
export const componentTypeSuggestions = [
  ...symbolKeys.map((key) => (key === "vm" ? "VM" : builtInSymbols[key])),
  "Other",
]

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
  return (
    symbolKeys.find(
      (key) =>
        key.toLowerCase() === normalized ||
        builtInSymbols[key].toLowerCase() === normalized
    ) ?? "generic"
  )
}
