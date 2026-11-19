import { useEffect, useState } from "react"
import {
  IconCircuitSwitchOpen,
  IconSchema,
  IconTable,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { EditorSessionControls } from "@/components/editor-session"
import { useEditorSession } from "@/hooks/use-editor-session"

const views = {
  Diagram: {
    icon: IconSchema,
    heading: "Network diagram",
    emptyTitle: "No components yet",
    description: "Components and links will appear on this diagram.",
    canvasClass: "diagram-grid",
  },
  Table: {
    icon: IconTable,
    heading: "Interface table",
    emptyTitle: "No interfaces yet",
    description: "Each interface will have its own row in this table.",
    canvasClass: "",
  },
}
type View = keyof typeof views
type Plan = {
  name: string
  components: unknown[]
  interfaces: unknown[]
  networks: unknown[]
}

export default function App() {
  const editorSession = useEditorSession()
  const [view, setView] = useState<View>("Diagram")
  const [plan, setPlan] = useState<Plan>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch(
          import.meta.env.BASE_URL + "fixtures/empty-plan.json",
          {
            signal: controller.signal,
          }
        )
        if (!response.ok) throw new Error("Plan unavailable")
        setPlan(await response.json())
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      }
    }
    void load()
    return () => controller.abort()
  }, [])

  const {
    icon: ViewIcon,
    heading,
    emptyTitle,
    description,
    canvasClass,
  } = views[view]
  return (
    <>
      <header className="flex items-center gap-3 border-b px-5 py-4 sm:px-10">
        <IconCircuitSwitchOpen
          aria-hidden="true"
          className="size-8 bg-primary p-1 text-primary-foreground"
        />
        <strong className="tracking-wide">NAMI</strong>
        <span className="hidden border-l pl-3 text-xs sm:inline">
          Network workspace
        </span>
        <EditorSessionControls session={editorSession} />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-10 sm:py-12">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
              {plan?.name ?? "Network plan"}
            </h1>
            {plan && (
              <p className="mt-3 text-xs">
                {plan.networks.length} networks · {plan.components.length}{" "}
                components · {plan.interfaces.length} interfaces
              </p>
            )}
          </div>
          <nav aria-label="Plan views" className="flex border p-1">
            {(Object.keys(views) as View[]).map((name) => {
              const Icon = views[name].icon
              return (
                <Button
                  key={name}
                  variant={view === name ? "default" : "ghost"}
                  aria-pressed={view === name}
                  onClick={() => setView(name)}
                  className="min-h-11 gap-2 px-4"
                >
                  <Icon aria-hidden="true" />
                  {name}
                </Button>
              )
            })}
          </nav>
        </div>
        <section aria-label={view} className="border">
          <h2 className="flex items-center gap-2 border-b bg-muted px-4 py-3 text-sm font-medium">
            <ViewIcon size={18} aria-hidden="true" />
            {heading}
          </h2>
          <div
            className={
              "grid min-h-[50svh] place-items-center px-5 text-center " +
              canvasClass
            }
          >
            {failed ? (
              <p role="alert">Unable to load the plan. Reload to try again.</p>
            ) : !plan ? (
              <p role="status">Loading plan…</p>
            ) : (
              <div className="bg-background p-5">
                <ViewIcon
                  aria-hidden="true"
                  size={36}
                  stroke={1.3}
                  className="mx-auto mb-4"
                />
                <h3 className="text-lg font-medium">{emptyTitle}</h3>
                <p className="mt-2 max-w-sm text-sm">{description}</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  )
}
