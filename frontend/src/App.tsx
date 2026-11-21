import { PdfExport } from "@/components/pdf-export"
import { usePlanFilter } from "@/hooks/use-plan-filter"
import { useState, useMemo } from "react"
import {
  IconDownload,
  IconFileTypePdf,
  IconUpload,
  IconFolderOpen,
  IconFolderPlus,
  IconHelpCircle,
  IconKey,
  IconPencil,
  IconPlus,
  IconSun,
  IconMoon,
  IconSchema,
  IconTable,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { EditorPasswordChange } from "@/components/editor-password-change"
import { EditorPasswordSetup } from "@/components/editor-password-setup"
import { EditorUnlockDialog, WorkspaceMenu } from "@/components/editor-session"
import { readOnly, useEditorSession } from "@/hooks/use-editor-session"
import { usePlanWorkspace } from "@/hooks/use-plan-workspace"
import { PlanNameDialog } from "@/components/plan-name-dialog"
import { PlanPackageImport } from "@/components/plan-package-controls"
import { PlanNetworks } from "@/components/plan-networks"
import { ComponentEditor } from "@/components/component-editor"
import { ImportExportHelp } from "@/components/import-export-help"
import { DiagramView } from "@/components/diagram-view"
import { InterfaceTable } from "@/components/interface-table"
import { Dialog } from "@/components/ui/dialog"
import { AddressSaveFeedback } from "@/components/ipv4-issues"
import { inventoryPath } from "@/lib/inventory"
import { applyDarkMode } from "@/lib/theme"
import {
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { InventoryDialog } from "@/components/inventory-tools"
import {
  InventoryCommitAction,
  InventoryUndoControl,
} from "@/components/inventory-confirmation"
import type { DiagramPosition, SavePlanSnapshot } from "@/lib/plans"

const views = {
  Diagram: {
    icon: IconSchema,
    heading: "Network diagram",
    component: DiagramView,
  },
  Table: {
    icon: IconTable,
    heading: "Interface table",
    component: InterfaceTable,
  },
}
type View = keyof typeof views
const automaticIpKey = "nami.automatic-ip-assignment"
type ComponentSelection = {
  planId: string
  componentId: string | null
  initialType?: string
  position?: DiagramPosition
  onMove?: () => void
  onAdded?: () => void
}

export default function App() {
  const editorSession = useEditorSession()
  const [setupCompletedElsewhere, setSetupCompletedElsewhere] = useState(false)

  if (!editorSession.session) {
    return (
      <main className="grid min-h-svh place-items-center px-4">
        {editorSession.checkFailed ? (
          <div className="flex flex-col items-center gap-4">
            <p role="alert">Unable to check editor setup.</p>
            <Button onClick={editorSession.refresh}>Try again</Button>
          </div>
        ) : (
          <p role="status">Loading NAMI…</p>
        )}
      </main>
    )
  }

  if (editorSession.session.setupRequired) {
    return (
      <EditorPasswordSetup
        onCreated={(session) => {
          setSetupCompletedElsewhere(false)
          editorSession.apply(session)
        }}
        onAlreadyConfigured={() => {
          setSetupCompletedElsewhere(true)
          editorSession.apply(readOnly)
        }}
      />
    )
  }

  return (
    <Workspace
      editorSession={editorSession}
      setupCompletedElsewhere={setupCompletedElsewhere}
      dismissSetupNotice={() => setSetupCompletedElsewhere(false)}
    />
  )
}

function Workspace({
  editorSession,
  setupCompletedElsewhere,
  dismissSetupNotice,
}: {
  editorSession: ReturnType<typeof useEditorSession>
  setupCompletedElsewhere: boolean
  dismissSetupNotice: () => void
}) {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  )
  const [automaticIpAssignment, setAutomaticIpAssignment] = useState(() => {
    try {
      return localStorage.getItem(automaticIpKey) === "true"
    } catch {
      return false
    }
  })
  const workspace = usePlanWorkspace(
    editorSession.refresh,
    automaticIpAssignment
  )
  const { plans, plan, failed, loading } = workspace
  const { value: filter, update: updateFilter } = usePlanFilter(plan?.id)
  const networkIds = useMemo(
    () =>
      filter.networkIds.filter((id) => plan?.networks.some((n) => n.id === id)),
    [filter.networkIds, plan?.networks]
  )
  const [sessionImports, setSessionImports] = useState<Record<string, string>>(
    {}
  )
  if (!editorSession.canEdit && Object.keys(sessionImports).length)
    setSessionImports({})
  const [renaming, setRenaming] = useState<string>()
  const [view, setView] = useState<View>("Diagram")
  const [fileDialog, setFileDialog] = useState<
    "pdf" | "inventory" | "package" | "help"
  >()
  if (
    !editorSession.canEdit &&
    (fileDialog === "inventory" || fileDialog === "package")
  )
    setFileDialog(undefined)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<unknown>()
  async function downloadPlan() {
    if (!plan) return
    setExportError(undefined)
    setExporting(true)
    try {
      await workspace.exportPlan(plan)
    } catch (error) {
      setExportError(error)
    } finally {
      setExporting(false)
    }
  }

  const [workspaceDialog, setWorkspaceDialog] = useState<
    "unlock" | "unlock-to-create" | "create" | "change-password"
  >()
  const [passwordChangeNotice, setPasswordChangeNotice] = useState("")
  if (!editorSession.canEdit && workspaceDialog === "change-password")
    setWorkspaceDialog(undefined)
  function startCreatingPlan() {
    setWorkspaceDialog(editorSession.canEdit ? "create" : "unlock-to-create")
  }

  const [selection, setSelection] = useState<ComponentSelection>()
  const activeSelection = selection?.planId === plan?.id ? selection : undefined
  const selectedComponent = plan?.components.find(
    ({ id }) => id === activeSelection?.componentId
  )
  const addingComponent =
    activeSelection?.componentId === null && editorSession.canEdit

  function selectComponent(
    componentId: string | null,
    options?: Pick<
      ComponentSelection,
      "initialType" | "position" | "onMove" | "onAdded"
    >
  ) {
    if (plan) setSelection({ planId: plan.id, componentId, ...options })
  }

  const saveComponent: SavePlanSnapshot = async (
    next,
    keepAddressConflicts
  ) => {
    const position = addingComponent && activeSelection?.position
    if (plan && position) {
      const existing = new Set(plan.components.map(({ id }) => id))
      next = {
        ...next,
        components: next.components.map((component) =>
          existing.has(component.id) ? component : { ...component, position }
        ),
      }
    }
    await workspace.savePlan(next, keepAddressConflicts)
    if (addingComponent) activeSelection?.onAdded?.()
  }

  const { icon: ViewIcon, heading, component: ActiveView } = views[view]
  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b px-3 py-2 sm:px-5">
        <img src="/nami-switch.svg" alt="" width="34" height="34" />
        <strong className="tracking-wide">NAMI</strong>
        <span className="hidden border-l pl-3 text-xs sm:inline">
          Network workspace
        </span>
        <WorkspaceMenu
          session={editorSession}
          onUnlock={() => setWorkspaceDialog("unlock")}
        >
          <DropdownMenuGroup>
            {!!plans?.length && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <IconFolderOpen aria-hidden="true" /> Open plan
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-w-[55vw]">
                  <DropdownMenuRadioGroup
                    value={workspace.planId}
                    onValueChange={workspace.selectPlan}
                  >
                    {plans.map(({ id, name }) => (
                      <DropdownMenuRadioItem closeOnClick key={id} value={id}>
                        {name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {editorSession.canEdit && plans && (
              <DropdownMenuItem onClick={startCreatingPlan}>
                <IconFolderPlus aria-hidden="true" /> New plan
              </DropdownMenuItem>
            )}
            {editorSession.canEdit && plan && (
              <DropdownMenuItem onClick={() => setRenaming(plan.id)}>
                <IconPencil aria-hidden="true" /> Edit plan
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {!!plans?.length && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            {plan && !failed && (
              <>
                <DropdownMenuItem onClick={() => setFileDialog("pdf")}>
                  <IconFileTypePdf aria-hidden="true" /> Export PDF
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={<a href={`${inventoryPath(plan.id)}.csv`} download />}
                >
                  <IconDownload aria-hidden="true" /> Export inventory CSV
                </DropdownMenuItem>
                {editorSession.canEdit && (
                  <DropdownMenuItem onClick={() => setFileDialog("inventory")}>
                    <IconUpload aria-hidden="true" /> Import inventory
                  </DropdownMenuItem>
                )}
              </>
            )}
            {editorSession.canEdit && plan && (
              <DropdownMenuItem disabled={exporting} onClick={downloadPlan}>
                <IconDownload aria-hidden="true" />{" "}
                {exporting ? "Exporting…" : "Export plan"}
              </DropdownMenuItem>
            )}
            {editorSession.canEdit && plans && (
              <DropdownMenuItem onClick={() => setFileDialog("package")}>
                <IconUpload aria-hidden="true" /> Import plan
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setFileDialog("help")}>
              <IconHelpCircle aria-hidden="true" /> Import/export help
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {editorSession.canEdit && (
              <DropdownMenuItem
                onClick={() => {
                  setPasswordChangeNotice("")
                  setWorkspaceDialog("change-password")
                }}
              >
                <IconKey aria-hidden="true" /> Change editor password
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => {
                applyDarkMode(!dark)
                setDark(!dark)
              }}
            >
              {dark ? (
                <IconSun aria-hidden="true" />
              ) : (
                <IconMoon aria-hidden="true" />
              )}
              {dark ? "Switch to light mode" : "Switch to dark mode"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </WorkspaceMenu>
        {passwordChangeNotice && (
          <p role="status" className="basis-full text-xs">
            {passwordChangeNotice}
          </p>
        )}
        <AddressSaveFeedback
          failure={exportError}
          disabled={exporting}
          fallback="Unable to export the plan. Try again."
        />
      </header>
      <main className="w-full px-3 py-5 sm:px-5">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <h1 className="text-3xl font-medium tracking-tight break-words sm:text-4xl">
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
        {plan && (
          <PlanNetworks
            key={plan.id}
            plan={plan}
            canEdit={editorSession.canEdit}
            savePlan={workspace.savePlan}
            selected={networkIds}
            onToggle={(id) =>
              updateFilter({
                networkIds: networkIds.includes(id)
                  ? networkIds.filter((value) => value !== id)
                  : [...networkIds, id],
              })
            }
          />
        )}
        <section aria-label={view} className="border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-4 py-2">
            <h2 className="flex items-center gap-2 py-1 text-sm font-medium">
              <ViewIcon size={18} aria-hidden="true" />
              {heading}
            </h2>
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={heading + " actions"}
            >
              {view === "Table" && plan && editorSession.canEdit && (
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => selectComponent(null)}
                >
                  <IconPlus aria-hidden="true" /> Add component
                </Button>
              )}
              {view === "Table" && plan && !failed && editorSession.canEdit && (
                <InventoryUndoControl
                  key={plan.id}
                  planId={plan.id}
                  revision={plan.revision}
                  sessionImportId={sessionImports[plan.id]}
                  withEditorAccess={workspace.withEditorAccess}
                  onPlanChanged={workspace.refreshPlan}
                />
              )}
              {plan && !failed && editorSession.canEdit && (
                <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2 text-xs">
                  <input
                    type="checkbox"
                    checked={automaticIpAssignment}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setAutomaticIpAssignment(checked)
                      try {
                        localStorage.setItem(automaticIpKey, String(checked))
                      } catch {
                        // The current view still uses the selected setting.
                      }
                    }}
                    className="size-4 shrink-0 accent-primary"
                  />
                  Automatic IP assignment
                </label>
              )}
            </div>
          </div>
          {editorSession.canEdit &&
            automaticIpAssignment &&
            workspace.allocationNotice && (
              <p role="status" className="border-b px-4 py-2 text-xs">
                The network allocation pool ran out of addresses.{" "}
                {workspace.allocationNotice.count}{" "}
                {workspace.allocationNotice.count === 1
                  ? "interface was"
                  : "interfaces were"}{" "}
                saved without IPv4.
                <span>
                  {" "}
                  Affected{" "}
                  {workspace.allocationNotice.networks.length === 1
                    ? "network"
                    : "networks"}{" "}
                  {workspace.allocationNotice.networks.join(", ")}.
                </span>
              </p>
            )}
          {plan && !failed ? (
            <ActiveView
              key={plan.id}
              plan={plan}
              canEdit={editorSession.canEdit}
              automaticIpAssignment={automaticIpAssignment}
              savePlan={workspace.savePlan}
              filter={{ ...filter, networkIds }}
              updateFilter={updateFilter}
              refreshPlan={workspace.refreshPlan}
              withEditorAccess={workspace.withEditorAccess}
              onSelectComponent={(componentId, onMove) =>
                selectComponent(componentId, { onMove })
              }
              onAddComponent={(options) => selectComponent(null, options)}
            />
          ) : (
            <div className="grid min-h-[50svh] place-items-center px-5 text-center">
              {failed ? (
                <p role="alert">
                  Unable to load the plan. Reload to try again.
                </p>
              ) : loading ? (
                <p role="status">Loading plan…</p>
              ) : (
                <div className="flex flex-col items-center gap-4 py-5">
                  <h3 className="text-lg font-medium">No plans yet</h3>
                  <Button className="min-h-11" onClick={startCreatingPlan}>
                    <IconFolderPlus
                      aria-hidden="true"
                      data-icon="inline-start"
                    />
                    Create plan
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
      {fileDialog === "help" && (
        <ImportExportHelp onClose={() => setFileDialog(undefined)} />
      )}
      {fileDialog === "pdf" && plan && !failed && (
        <PdfExport
          plan={plan}
          view={view}
          filter={{ ...filter, networkIds }}
          onClose={() => setFileDialog(undefined)}
        />
      )}
      {fileDialog === "package" && editorSession.canEdit && (
        <PlanPackageImport
          onImport={workspace.importPlan}
          onClose={() => setFileDialog(undefined)}
        />
      )}
      {fileDialog === "inventory" && plan && editorSession.canEdit && (
        <Dialog open onOpenChange={(open) => !open && setFileDialog(undefined)}>
          <InventoryDialog
            planId={plan.id}
            close={() => setFileDialog(undefined)}
            withEditorAccess={workspace.withEditorAccess}
            renderActions={(review) => (
              <InventoryCommitAction
                review={review}
                withEditorAccess={workspace.withEditorAccess}
                onPlanChanged={workspace.refreshPlan}
                onImported={(id) =>
                  setSessionImports((previous) => ({
                    ...previous,
                    [plan.id]: id,
                  }))
                }
              />
            )}
          />
        </Dialog>
      )}
      {plan && (selectedComponent || addingComponent) && (
        <ComponentEditor
          key={selectedComponent?.id ?? "add-component"}
          plan={plan}
          component={selectedComponent}
          initialType={activeSelection?.initialType}
          canEdit={editorSession.canEdit}
          onClose={() => setSelection(undefined)}
          onMove={activeSelection?.onMove}
          savePlan={saveComponent}
          withEditorAccess={workspace.withEditorAccess}
        />
      )}
      {plan && renaming === plan.id && editorSession.canEdit && (
        <PlanNameDialog
          title="Edit plan"
          label="Plan name"
          name={plan.name}
          action="Save plan"
          onClose={() => setRenaming(undefined)}
          onSave={async (name) => {
            await workspace.savePlan({ ...plan, name })
            setRenaming(undefined)
          }}
        />
      )}
      {(workspaceDialog === "unlock" ||
        workspaceDialog === "unlock-to-create" ||
        setupCompletedElsewhere) && (
        <EditorUnlockDialog
          setupCompletedElsewhere={setupCompletedElsewhere}
          onClose={() => {
            dismissSetupNotice()
            setWorkspaceDialog(undefined)
          }}
          onSetupRequired={() => void editorSession.refresh()}
          onUnlocked={(session) => {
            dismissSetupNotice()
            editorSession.apply(session)
            setWorkspaceDialog(
              workspaceDialog === "unlock-to-create" ? "create" : undefined
            )
          }}
        />
      )}
      {workspaceDialog === "create" && editorSession.canEdit && (
        <PlanNameDialog
          title="New plan"
          label="Plan name"
          action="Create plan"
          onSave={workspace.addPlan}
          onClose={() => setWorkspaceDialog(undefined)}
        />
      )}
      {workspaceDialog === "change-password" && editorSession.canEdit && (
        <EditorPasswordChange
          onClose={() => setWorkspaceDialog(undefined)}
          onChanged={(session) => {
            editorSession.apply(session)
            setWorkspaceDialog(undefined)
            setPasswordChangeNotice("Editor password changed.")
          }}
          onSessionLost={() => {
            setWorkspaceDialog(undefined)
            setPasswordChangeNotice("Unlock editing again to change the editor password.")
            void editorSession.refresh()
          }}
        />
      )}
    </>
  )
}
