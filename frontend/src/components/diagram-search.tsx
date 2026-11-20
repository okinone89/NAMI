import { useRef, type ReactNode } from "react"
import { IconSearch, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DiagramSearchResult } from "@/lib/diagram-search"

type Props = {
  query: string
  results: DiagramSearchResult[]
  onQueryChange: (query: string) => void
  onSelectResult: (result: DiagramSearchResult) => void
  children?: ReactNode
}

export function DiagramSearch({
  query,
  results,
  onQueryChange,
  onSelectResult,
  children,
}: Props) {
  const searchInput = useRef<HTMLInputElement>(null)
  const searching = query.trim().length > 0
  return (
    <div className="space-y-2 border-b px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex min-w-44 flex-1 items-center gap-2">
          <IconSearch
            aria-hidden="true"
            className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground"
          />
          <Input
            ref={searchInput}
            type="search"
            aria-label="Search plan"
            placeholder="Filter components and interfaces"
            className="min-h-11 bg-background pl-9 [&::-webkit-search-cancel-button]:hidden"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <Button
              variant="outline"
              size="icon"
              aria-label="Clear search"
              className="size-11 shrink-0"
              onClick={() => {
                onQueryChange("")
                searchInput.current?.focus()
              }}
            >
              <IconX aria-hidden="true" />
            </Button>
          )}
        </div>
        {children}
      </div>
      {searching && (
        <>
          <p role="status" className="text-xs text-muted-foreground">
            {results.length === 0
              ? "No matching components"
              : `${results.length} ${results.length === 1 ? "result" : "results"}`}
          </p>
          {results.length > 0 && (
            <ul
              aria-label="Search results"
              className="grid max-h-36 gap-1 overflow-y-auto sm:grid-cols-2"
            >
              {results.map((result) => (
                <li
                  key={JSON.stringify([result.componentId, result.networkId])}
                  className="min-w-0"
                >
                  <Button
                    variant="outline"
                    onClick={() => onSelectResult(result)}
                    className="h-auto min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-left whitespace-normal"
                  >
                    <span className="wrap-anywhere">
                      {result.componentName}
                    </span>
                    <span className="wrap-anywhere text-muted-foreground">
                      {result.networkName}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
