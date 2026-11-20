import { IconChevronDown } from "@tabler/icons-react"
import type { ComponentProps } from "react"
import { inputStyles } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export function NativeSelect({
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <div className="relative min-w-0">
      <select
        data-slot="native-select"
        className={cn(
          inputStyles,
          "min-h-11 appearance-none pr-8 [&>option]:bg-background [&>option]:text-foreground",
          className
        )}
        {...props}
      />
      <IconChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}
