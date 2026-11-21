import { useId } from "react"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export const editorPasswordLengthHelp = "Use 15 to 256 characters."

export function EditorPasswordField({
  name,
  label,
  autoComplete,
  disabled,
  description,
  errorId,
}: {
  name: string
  label: string
  autoComplete: "current-password" | "new-password"
  disabled: boolean
  description?: string
  errorId?: string
}) {
  const id = useId()
  const descriptionId = description ? `${id}-description` : undefined
  return (
    <Field data-invalid={!!errorId} data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={name}
        type="password"
        autoComplete={autoComplete}
        aria-describedby={
          [descriptionId, errorId].filter(Boolean).join(" ") || undefined
        }
        aria-invalid={!!errorId}
        required
        disabled={disabled}
        className="min-h-11"
      />
      {description && (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      )}
    </Field>
  )
}
