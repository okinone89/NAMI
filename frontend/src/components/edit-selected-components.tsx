import { useId, useState, type FormEvent } from "react"
import { ComponentAppearanceFields } from "@/components/component-appearance-fields"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  componentTypeSuggestions,
  type ComponentAppearance,
} from "@/lib/component-appearance"
import type { Component, Plan, SavePlanSnapshot } from "@/lib/plans"

export function EditSelectedComponents({
  plan,
  selection,
  savePlan,
  onClose,
}: {
  plan: Plan
  selection: ReadonlySet<string>
  savePlan: SavePlanSnapshot
  onClose: () => void
}) {
  const formId = useId()
  const [applyType, setApplyType] = useState(false)
  const [applyAppearance, setApplyAppearance] = useState(false)
  const [type, setType] = useState("")
  const [appearance, setAppearance] = useState<ComponentAppearance>()
  const [readingIcon, setReadingIcon] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState("")
  const first = plan.components.find(({ id }) => selection.has(id))
  if (!first) return null
  const appearanceDraft = {
    ...first,
    type: (applyType && type.trim()) || first.type,
    appearance,
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      busy ||
      (!applyType && !applyAppearance) ||
      (applyAppearance && readingIcon)
    )
      return
    const updatedType = type.trim()
    if (applyType && !updatedType) {
      setFailure("Enter a component type.")
      return
    }
    if (
      applyAppearance &&
      appearance?.kind === "custom" &&
      !appearance.imageData
    ) {
      setFailure("Choose a custom icon before saving.")
      return
    }
    const updatedAppearance =
      appearance?.kind === "shape"
        ? { ...appearance, label: appearance.label.trim() }
        : appearance
    const components = plan.components.map((component): Component => {
      if (!selection.has(component.id)) return component
      return {
        ...component,
        type: applyType ? updatedType : component.type,
        appearance: applyAppearance ? updatedAppearance : component.appearance,
      }
    })
    if (applyType) {
      const byId = new Map(
        components.map((component) => [component.id, component])
      )
      for (const vm of components) {
        if (!vm.hostId) continue
        const host = byId.get(vm.hostId)!
        if (
          vm.type.toLowerCase() !== "vm" ||
          host.type.toLowerCase() !== "server"
        ) {
          setFailure(
            `The type change would disrupt hosting for ${vm.name} on ${host.name}.`
          )
          return
        }
      }
    }
    setFailure("")
    setBusy(true)
    try {
      await savePlan({ ...plan, components })
      onClose()
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not edit the selected components."
      )
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Edit selected components</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => void submit(event)}
          onChange={() => setFailure("")}
        >
          <fieldset disabled={busy}>
            <FieldGroup>
              <Field>
                <FieldLabel className="min-h-8 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyType}
                    onChange={(event) => setApplyType(event.target.checked)}
                  />
                  Change type
                </FieldLabel>
                {applyType && (
                  <>
                    <FieldLabel htmlFor={`${formId}-type`}>
                      Component type
                    </FieldLabel>
                    <Input
                      id={`${formId}-type`}
                      required
                      list={`${formId}-types`}
                      value={type}
                      onChange={(event) => setType(event.target.value)}
                    />
                    <datalist id={`${formId}-types`}>
                      {componentTypeSuggestions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
              <Field>
                <FieldLabel className="min-h-8 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyAppearance}
                    onChange={(event) =>
                      setApplyAppearance(event.target.checked)
                    }
                  />
                  Change appearance
                </FieldLabel>
                {applyAppearance && (
                  <ComponentAppearanceFields
                    component={appearanceDraft}
                    onChange={setAppearance}
                    onReadingIconChange={setReadingIcon}
                  />
                )}
              </Field>
            </FieldGroup>
          </fieldset>
          {failure && (
            <p role="alert" className="text-destructive">
              {failure}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                (!applyType && !applyAppearance) ||
                (applyAppearance && readingIcon)
              }
            >
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
