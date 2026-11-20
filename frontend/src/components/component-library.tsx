import { IconChevronRight } from "@tabler/icons-react"
import { useState } from "react"
import { BuiltInMark } from "@/components/diagram-component-label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  builtInSymbols,
  symbolKeys,
  type BuiltInSymbol,
} from "@/lib/component-appearance"
import { placementType } from "@/lib/diagram-placement"

const categories = {
  plc: "Controllers & HMI",
  safetyPlc: "Controllers & HMI",
  hmi: "Controllers & HMI",
  vfd: "Drives & motion",
  servoDrive: "Drives & motion",
  ioLinkMaster: "Field I/O",
  ioLinkHub: "Field I/O",
  ioLinkDevice: "Field I/O",
  remoteIo: "Field I/O",
  visionCamera: "Vision & identification",
  barcodeReader: "Vision & identification",
  switch: "Networking",
  router: "Networking",
  accessPoint: "Networking",
  protocolGateway: "Networking",
  server: "Computing",
  vm: "Computing",
  computer: "Computing",
  generic: "Other",
} satisfies Record<BuiltInSymbol, string>

const categoryNames = Array.from(new Set(Object.values(categories)))
const storageKey = "nami.library.collapsedCategories"

function readCollapsedCategories(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]")
    return Array.isArray(saved)
      ? categoryNames.filter((name) => saved.includes(name))
      : []
  } catch {
    return []
  }
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function ComponentLibrary({
  onChoose,
}: {
  onChoose: (key: BuiltInSymbol) => void
}) {
  const [query, setQuery] = useState("")
  const terms = query.trim().split(/\s+/).map(normalize)
  const [collapsed, setCollapsed] = useState(readCollapsedCategories)
  const searching = terms.some(Boolean)

  function toggle(category: string) {
    const next = collapsed.includes(category)
      ? collapsed.filter((name) => name !== category)
      : [...collapsed, category]
    setCollapsed(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // Browsers with restricted storage still support toggling the current library.
    }
  }

  const matches = symbolKeys.filter((key) => {
    const name = normalize(
      [builtInSymbols[key], key, categories[key]].join(" ")
    )
    return terms.every((term) => name.includes(term))
  })

  return (
    <aside
      aria-label="Component library"
      className="flex max-h-[70svh] w-36 shrink-0 flex-col border-r sm:w-52"
    >
      <div className="border-b p-2">
        <Input
          type="search"
          aria-label="Search component types"
          placeholder="Search types…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="space-y-3 overflow-y-auto p-2">
        {categoryNames.map((category) => {
          const keys = matches.filter((key) => categories[key] === category)
          if (!keys.length) return null
          const expanded = searching || !collapsed.includes(category)
          return (
            <section
              key={category}
              aria-label={category}
              className="grid gap-1"
            >
              <h3 className="text-xs font-medium text-muted-foreground">
                {searching ? (
                  category
                ) : (
                  <Button
                    variant="ghost"
                    aria-expanded={expanded}
                    className="h-auto min-h-8 w-full justify-start px-1 py-1 text-left whitespace-normal"
                    onClick={() => toggle(category)}
                  >
                    <IconChevronRight
                      aria-hidden="true"
                      className={expanded ? "rotate-90" : ""}
                    />
                    {category}
                  </Button>
                )}
              </h3>
              {expanded &&
                keys.map((key) => (
                  <Button
                    key={key}
                    variant="outline"
                    className="h-auto min-h-9 justify-start py-1 text-left whitespace-normal"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy"
                      event.dataTransfer.setData(placementType, key)
                    }}
                    onClick={() => onChoose(key)}
                  >
                    <BuiltInMark symbol={key} decorative />
                    {builtInSymbols[key]}
                  </Button>
                ))}
            </section>
          )
        })}
        {!matches.length && (
          <p role="status" className="text-xs text-muted-foreground">
            No matching component types.
          </p>
        )}
      </div>
    </aside>
  )
}
