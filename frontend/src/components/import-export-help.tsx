import {
  IconFileCode,
  IconFileTypeCsv,
  IconFileTypePdf,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const headingStyle =
  "flex items-center gap-2.5 font-heading text-base font-semibold text-help-heading"
const detailStyle = "grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4"

export function ImportExportHelp({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[44rem]"
      >
        <DialogHeader className="shrink-0 border-b bg-muted/50 px-5 py-4 sm:px-7 sm:py-5">
          <DialogTitle className="text-lg font-semibold tracking-tight sm:text-xl">
            Import/export help
          </DialogTitle>
        </DialogHeader>
        <div
          role="region"
          aria-label="Import and export guidance"
          tabIndex={0}
          className="min-h-0 divide-y overflow-y-auto px-5 font-sans text-sm/6 focus-visible:-outline-offset-2 sm:px-7"
        >
          <section className="flex flex-col gap-3 py-5">
            <h3 className={headingStyle}>
              <IconFileTypeCsv size={20} aria-hidden="true" />
              Inventory CSV
            </h3>
            <dl className="flex flex-col gap-3">
              <div className={detailStyle}>
                <dt className="font-semibold">Prepare the file</dt>
                <dd>
                  Start with <strong>Export → Inventory CSV</strong> in the
                  Workspace menu. Keep all ten headers, then use{" "}
                  <strong>Import → Inventory CSV</strong> to upload the edited
                  file or paste rows from your spreadsheet.
                </dd>
              </div>
              <div className={detailStyle}>
                <dt className="font-semibold">How rows match</dt>
                <dd>
                  Component and network names are matched within the open plan.
                  Interface names are matched within their component. Blank
                  cells preserve existing values and connections. Component type
                  is set when a component is created.
                </dd>
              </div>
              <div className={detailStyle}>
                <dt className="font-semibold">Review conflicts</dt>
                <dd>
                  Review the before and after values before applying. If a name
                  or connection change could mean more than one thing, the
                  wizard asks you to choose. You can correct values or skip
                  affected rows or connections. Duplicate IPv4 addresses on the
                  same network can be kept with a visible conflict flag.
                </dd>
              </div>
              <div className={detailStyle}>
                <dt className="font-semibold">If the plan changes</dt>
                <dd>
                  Review the refreshed preview before applying again if another
                  edit affects the import.
                </dd>
              </div>
            </dl>
          </section>
          <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <section className="flex flex-col gap-2 py-4 sm:pr-5">
              <h3 className={headingStyle}>
                <IconFileCode size={20} aria-hidden="true" />
                JSON plan packages
              </h3>
              <p>
                Use <strong>Export → Plan package</strong> to transfer the full
                plan, including layout, networks, colors, and links.{" "}
                <strong>Import → Plan package</strong> opens an independent
                copy, even when a plan with the same name already exists.
              </p>
            </section>
            <section className="flex flex-col gap-2 py-4 sm:pl-5">
              <h3 className={headingStyle}>
                <IconFileTypePdf size={20} aria-hidden="true" />
                PDF
              </h3>
              <p>
                Use <strong>Export → PDF</strong> to share a readable copy of
                the diagram, table, or both.
              </p>
            </section>
          </div>
        </div>
        <DialogFooter className="shrink-0 flex-row justify-end border-t bg-muted/50 px-5 py-3 sm:px-7">
          <DialogClose render={<Button className="min-h-11 px-5" />}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
