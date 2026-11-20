import {
  IconAccessPoint,
  IconWaveSine,
  IconRotateClockwise,
  IconHierarchy,
  IconArrowsSplit,
  IconPlugConnected,
  IconServer2,
  IconShieldCheck,
  IconTransform,
  IconCamera,
  IconBarcode,
  IconCpu,
  IconDeviceDesktop,
  IconDeviceDesktopAnalytics,
  IconDeviceDesktopCode,
  IconDeviceSdCard,
  IconDiamond,
  IconOval,
  IconRectangle,
  IconRouter,
  IconServer,
  IconSwitchHorizontal,
} from "@tabler/icons-react"
import {
  builtInSymbols,
  componentShapes,
  defaultSymbol,
  type BuiltInSymbol,
} from "@/lib/component-appearance"
import type { Component } from "@/lib/plans"

const symbols = {
  plc: IconCpu,
  hmi: IconDeviceDesktopAnalytics,
  switch: IconSwitchHorizontal,
  router: IconRouter,
  accessPoint: IconAccessPoint,
  server: IconServer,
  vm: IconDeviceDesktopCode,
  computer: IconDeviceDesktop,
  vfd: IconWaveSine,
  servoDrive: IconRotateClockwise,
  ioLinkMaster: IconHierarchy,
  ioLinkHub: IconArrowsSplit,
  ioLinkDevice: IconPlugConnected,
  remoteIo: IconServer2,
  safetyPlc: IconShieldCheck,
  protocolGateway: IconTransform,
  visionCamera: IconCamera,
  barcodeReader: IconBarcode,
  generic: IconDeviceSdCard,
}

const shapes = {
  rectangle: IconRectangle,
  ellipse: IconOval,
  diamond: IconDiamond,
}

export function AppearanceMark({ component }: { component: Component }) {
  const { appearance, type } = component

  if (appearance?.kind === "custom") {
    return (
      <img
        alt="Custom icon"
        src={appearance.imageData}
        className="size-9 shrink-0 object-contain"
      />
    )
  }

  if (appearance?.kind === "shape") {
    const Shape = shapes[appearance.shape]
    return (
      <Shape
        role="img"
        aria-label={`${componentShapes[appearance.shape]} shape`}
        className="size-6 shrink-0"
      />
    )
  }

  const symbol = appearance?.symbol ?? defaultSymbol(type)
  return <BuiltInMark symbol={symbol} />
}

export function BuiltInMark({
  symbol,
  decorative = false,
}: {
  symbol: BuiltInSymbol
  decorative?: boolean
}) {
  const Symbol = symbols[symbol]
  return (
    <Symbol
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `${builtInSymbols[symbol]} symbol`}
      className="size-6 shrink-0"
    />
  )
}

export function DiagramComponentLabel({ component }: { component: Component }) {
  const { appearance, name, type } = component
  const subtitle =
    appearance?.kind === "shape" ? appearance.label || type : type

  return (
    <span className="flex w-full min-w-0 items-center gap-2">
      <AppearanceMark component={component} />
      <span className="min-w-0">
        <span className="line-clamp-2 wrap-anywhere">{name}</span>
        <span className="block truncate text-muted-foreground" title={subtitle}>
          {subtitle}
        </span>
      </span>
    </span>
  )
}
