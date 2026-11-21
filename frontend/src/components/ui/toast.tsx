import { Toast } from "@base-ui/react/toast"
import { IconCircleCheck, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"

const toast = Toast.createToastManager()

function ToastList() {
  const { toasts } = Toast.useToastManager()

  return toasts.map((item) => (
    <Toast.Root
      key={item.id}
      toast={item}
      data-slot="toast"
      className="pointer-events-auto border bg-popover text-popover-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring data-ending-style:opacity-0 data-limited:hidden data-starting-style:opacity-0 motion-safe:transition-opacity motion-safe:duration-150"
    >
      <Toast.Content className="flex items-center gap-3 py-2 pr-2 pl-4">
        {item.type === "success" && (
          <IconCircleCheck aria-hidden="true" className="size-4 shrink-0" />
        )}
        <Toast.Title className="flex-1 text-sm font-medium" />
        <Toast.Close
          aria-hidden={false}
          aria-label="Close notification"
          render={<Button variant="ghost" size="icon" className="size-11" />}
        >
          <IconX aria-hidden="true" />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ))
}

function Toaster() {
  return (
    <Toast.Provider toastManager={toast}>
      <Toast.Portal>
        <Toast.Viewport className="pointer-events-none fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-sm flex-col gap-2 outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}

export { toast, Toaster }
