import { useId, useRef, useState } from "react"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  builtInSymbols,
  componentShapes,
  defaultSymbol,
  maxShapeLabelLength,
  type BuiltInSymbol,
  type ComponentAppearance,
  type ComponentShape,
} from "@/lib/component-appearance"
import type { Component } from "@/lib/plans"

const iconFormats = ["image/png", "image/jpeg", "image/webp"]
const maxIconKibibytes = 96

const selectClass = "min-h-11 border border-input bg-background px-2"

export function ComponentAppearanceFields({
  component,
  onChange,
  onReadingIconChange,
}: {
  component: Component
  onChange: (appearance: ComponentAppearance | undefined) => void
  onReadingIconChange: (reading: boolean) => void
}) {
  const id = useId()
  const uploadSequence = useRef(0)
  const [uploadError, setUploadError] = useState("")
  const { appearance, type } = component

  function changeRepresentation(kind: string) {
    uploadSequence.current++
    onReadingIconChange(false)
    setUploadError("")
    switch (kind) {
      case "builtIn":
        onChange({ kind, symbol: defaultSymbol(type) })
        break
      case "custom":
        onChange({ kind, imageData: "" })
        break
      case "shape":
        onChange({ kind, shape: "rectangle", label: "" })
        break
      default:
        onChange(undefined)
    }
  }

  async function importIcon(file: File | undefined) {
    if (!file) return
    const sequence = ++uploadSequence.current
    setUploadError("")
    if (
      !iconFormats.includes(file.type) ||
      file.size > maxIconKibibytes * 1024
    ) {
      setUploadError(
        `Choose a PNG, JPEG, or WebP icon up to ${maxIconKibibytes} KiB.`
      )
      onReadingIconChange(false)
      return
    }

    onReadingIconChange(true)
    try {
      const imageData = await readIcon(file)
      const image = new Image()
      image.src = imageData
      await image.decode()
      if (sequence === uploadSequence.current) {
        onChange({ kind: "custom", imageData })
      }
    } catch {
      if (sequence === uploadSequence.current) {
        setUploadError("This icon could not be opened.")
      }
    } finally {
      if (sequence === uploadSequence.current) onReadingIconChange(false)
    }
  }

  return (
    <FieldGroup className="gap-3 sm:grid sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor={`${id}-kind`}>Representation</FieldLabel>
        <select
          id={`${id}-kind`}
          className={selectClass}
          value={appearance?.kind ?? ""}
          onChange={(event) => changeRepresentation(event.target.value)}
        >
          <option value="">Automatic by type</option>
          <option value="builtIn">Built-in symbol</option>
          <option value="custom">Custom icon</option>
          <option value="shape">Labeled shape</option>
        </select>
      </Field>
      {appearance?.kind === "builtIn" && (
        <Field>
          <FieldLabel htmlFor={`${id}-symbol`}>Built-in symbol</FieldLabel>
          <select
            id={`${id}-symbol`}
            className={selectClass}
            value={appearance.symbol}
            onChange={(event) =>
              onChange({
                kind: "builtIn",
                symbol: event.target.value as BuiltInSymbol,
              })
            }
          >
            {Object.entries(builtInSymbols).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {appearance?.kind === "custom" && (
        <Field>
          <FieldLabel htmlFor={`${id}-icon`}>Custom icon</FieldLabel>
          <div className="flex items-center gap-2">
            {appearance.imageData && (
              <img
                alt=""
                src={appearance.imageData}
                className="size-9 shrink-0 object-contain"
              />
            )}
            <Input
              id={`${id}-icon`}
              type="file"
              className="min-h-11 py-2"
              accept={iconFormats.join(",")}
              aria-describedby={
                uploadError
                  ? `${id}-icon-description ${id}-icon-error`
                  : `${id}-icon-description`
              }
              aria-invalid={uploadError ? true : undefined}
              onChange={(event) =>
                void importIcon(event.currentTarget.files?.[0])
              }
            />
          </div>
          <FieldDescription id={`${id}-icon-description`}>
            PNG, JPEG, or WebP, up to {maxIconKibibytes} KiB
          </FieldDescription>
          {uploadError && (
            <FieldError id={`${id}-icon-error`}>{uploadError}</FieldError>
          )}
        </Field>
      )}
      {appearance?.kind === "shape" && (
        <>
          <Field>
            <FieldLabel htmlFor={`${id}-shape`}>Shape</FieldLabel>
            <select
              id={`${id}-shape`}
              className={selectClass}
              value={appearance.shape}
              onChange={(event) =>
                onChange({
                  ...appearance,
                  shape: event.target.value as ComponentShape,
                })
              }
            >
              {Object.entries(componentShapes).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-shape-label`}>Shape label</FieldLabel>
            <Input
              id={`${id}-shape-label`}
              className="min-h-11"
              maxLength={maxShapeLabelLength}
              value={appearance.label}
              onChange={(event) =>
                onChange({ ...appearance, label: event.target.value })
              }
            />
          </Field>
        </>
      )}
    </FieldGroup>
  )
}

function readIcon(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
