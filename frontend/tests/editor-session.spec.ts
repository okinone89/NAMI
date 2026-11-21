import {
  editorPassword,
  expectReadOnly,
  unlockEditing,
  workspaceAction,
} from "./workspace-settings"
import { expect, test } from "@playwright/test"

test("first-run setup validates confirmation and opens the workspace in Edit mode", async ({
  page,
}) => {
  const password = "new workshop password"
  const session = {
    canEdit: true,
    setupRequired: false,
    expiresAt: new Date(Date.now() + 8 * 60 * 60_000).toISOString(),
  }
  let created = false
  await page.route("**/api/editor-session", (route) =>
    route.fulfill({
      json: created
        ? session
        : { canEdit: false, setupRequired: true, expiresAt: null },
    })
  )
  await page.route("**/api/editor-session/setup", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      password,
      confirmation: password,
    })
    created = true
    await route.fulfill({ status: 201, json: session })
  })

  await page.goto("/")
  const setup = page.getByRole("region", { name: "Create editor password" })
  await expect(setup).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Workspace", exact: true })
  ).toHaveCount(0)
  const input = setup.getByLabel("Editor password", { exact: true })
  const confirmation = setup.getByLabel("Confirm password")
  await expect(input).toHaveAttribute("autocomplete", "new-password")
  await input.fill(password)
  await confirmation.fill("different workshop password")
  const create = setup.getByRole("button", { name: "Create password" })
  await create.click()
  await expect(setup.getByRole("alert")).toHaveText("Passwords do not match.")
  expect(created).toBe(false)

  await confirmation.fill(password)
  await create.click()
  await expect(page.getByRole("button", { name: "Edit mode" })).toBeVisible()
  await expect(setup).toHaveCount(0)
})

test("a competing setup submission opens the usual password prompt", async ({
  page,
}) => {
  await page.route("**/api/editor-session", (route) =>
    route.fulfill({
      json: { canEdit: false, setupRequired: true, expiresAt: null },
    })
  )
  await page.route("**/api/editor-session/setup", (route) =>
    route.fulfill({ status: 409 })
  )

  await page.goto("/")
  const setup = page.getByRole("region", { name: "Create editor password" })
  await setup
    .getByLabel("Editor password", { exact: true })
    .fill("new workshop password")
  await setup.getByLabel("Confirm password").fill("new workshop password")
  await setup.getByRole("button", { name: "Create password" }).click()

  const unlock = page.getByRole("dialog", { name: "Unlock editing" })
  await expect(unlock).toHaveAccessibleDescription(
    "Another visitor created the editor password."
  )
  await expect(unlock.getByLabel("Shared editor password")).toHaveValue("")
  await unlock.getByRole("button", { name: "Cancel" }).click()
  await expectReadOnly(page)
})

test("editors can change the password after confirming both credentials", async ({
  page,
  hasTouch,
}) => {
  const replacement = "updated workshop password"
  let submissions = 0
  await page.route("**/api/editor-session/password", async (route) => {
    submissions++
    expect(route.request().method()).toBe("PUT")
    const data = route.request().postDataJSON()
    expect(data.newPassword).toBe(replacement)
    expect(data.confirmation).toBe(replacement)
    if (data.currentPassword !== editorPassword) {
      await route.fulfill({
        status: 403,
        json: { title: "Incorrect current password." },
      })
      return
    }
    await route.fulfill({
      json: {
        canEdit: true,
        setupRequired: false,
        expiresAt: new Date(Date.now() + 8 * 60 * 60_000).toISOString(),
      },
    })
  })

  await page.goto("/")
  await expectReadOnly(page)
  await page.getByRole("button", { name: "Workspace", exact: true }).click()
  const menu = page.getByRole("menu", { name: "Workspace" })
  await expect(
    menu.getByRole("menuitem", { name: "Change editor password" })
  ).toHaveCount(0)
  await menu.press("Escape")
  await unlockEditing(page)
  await workspaceAction(page, "Change editor password")

  const dialog = page.getByRole("dialog", { name: "Change editor password" })
  const current = dialog.getByLabel("Current password")
  const next = dialog.getByLabel("New password", { exact: true })
  const confirmation = dialog.getByLabel("Confirm new password")
  const submit = dialog.getByRole("button", { name: "Change password" })
  await expect(current).toHaveAttribute("autocomplete", "current-password")
  await expect(next).toHaveAttribute("autocomplete", "new-password")
  await next.fill(replacement)
  await confirmation.fill(replacement)
  await submit.click()
  await expect(current).toBeFocused()
  expect(submissions).toBe(0)

  await current.fill("incorrect workshop password")
  await confirmation.fill("different workshop password")
  await submit.click()
  await expect(dialog.getByRole("alert")).toHaveText("Passwords do not match.")
  expect(submissions).toBe(0)

  await confirmation.fill(replacement)
  await submit.click()
  await expect(dialog.getByRole("alert")).toHaveText(
    "Incorrect current password."
  )
  await expect(current).toHaveAttribute("aria-invalid", "true")
  await current.fill(editorPassword)
  await submit.click()
  await expect(dialog).toBeHidden()
  const toast = page.getByRole("dialog", { name: "Editor password changed." })
  await expect(toast).toBeVisible()
  const closeToast = toast.getByRole("button", { name: "Close notification" })
  if (hasTouch) await closeToast.tap()
  else await closeToast.click()
  await expect(toast).toBeHidden()
  await expect(page.getByRole("button", { name: "Edit mode" })).toBeVisible()
  expect(submissions).toBe(2)
})

test("the password change toast dismisses itself after ten seconds", async ({
  page,
}) => {
  await page.clock.install()
  const session = {
    canEdit: true,
    setupRequired: false,
    expiresAt: new Date(Date.now() + 8 * 60 * 60_000).toISOString(),
  }
  await page.route("**/api/editor-session", (route) =>
    route.fulfill({ json: session })
  )
  await page.route("**/api/editor-session/password", (route) =>
    route.fulfill({ json: session })
  )

  await page.goto("/")
  await workspaceAction(page, "Change editor password")
  const dialog = page.getByRole("dialog", { name: "Change editor password" })
  const replacement = "updated workshop password"
  await dialog.getByLabel("Current password").fill(editorPassword)
  await dialog.getByLabel("New password", { exact: true }).fill(replacement)
  await dialog.getByLabel("Confirm new password").fill(replacement)
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(now + 500)
  await dialog.getByRole("button", { name: "Change password" }).click()

  const toast = page.getByRole("dialog", { name: "Editor password changed." })
  await expect(toast).toBeVisible()
  await page.clock.fastForward(9_999)
  await expect(toast).toBeVisible()
  await page.clock.runFor(250)
  await expect(toast).toBeHidden()
})

test("describe and run the mode badge actions", async ({ page, hasTouch }) => {
  let canEdit = false
  await page.route("**/api/editor-session", async (route) => {
    const method = route.request().method()
    if (method === "POST") {
      if (route.request().postDataJSON().password !== "workshop phrase") {
        await route.fulfill({ status: 401 })
        return
      }
      canEdit = true
    }
    if (method === "DELETE") {
      canEdit = false
      await route.fulfill({ status: 204 })
      return
    }
    await route.fulfill({
      json: {
        canEdit,
        setupRequired: false,
        expiresAt: canEdit
          ? new Date(Date.now() + 8 * 60 * 60_000).toISOString()
          : null,
      },
    })
  })

  await page.goto("/")
  const toolbar = page.getByRole("banner")
  const viewMode = toolbar.getByRole("button", { name: "View mode" })
  const editMode = toolbar.getByRole("button", { name: "Edit mode" })
  const workspace = toolbar.getByRole("button", {
    name: "Workspace",
    exact: true,
  })
  const menu = page.getByRole("menu", { name: "Workspace", exact: true })
  const tooltip = page.getByRole("tooltip")
  const workspaceHeight = (await workspace.boundingBox())!.height

  async function expectMenuWithoutSessionActions() {
    await workspace.click()
    await expect(menu).toBeVisible()
    await expect(
      menu.getByRole("menuitem", { name: /^(Unlock editing|Sign out)$/ })
    ).toHaveCount(0)
    await menu.press("Escape")
    await expect(menu).toBeHidden()
  }

  await page.getByRole("button", { name: "Table" }).click()
  expect((await viewMode.boundingBox())!.height).toBe(workspaceHeight)
  await expectMenuWithoutSessionActions()
  await workspace.focus()
  await page.keyboard.press("Shift+Tab")
  await expect(viewMode).toBeFocused()
  await expect(tooltip).toHaveText("Unlock editing")
  await expect(viewMode).toHaveAccessibleDescription("Unlock editing")
  await page.keyboard.press("Escape")
  await expect(tooltip).toBeHidden()

  await viewMode.click()
  const dialog = page.getByRole("dialog", { name: "Unlock editing" })
  await expect(dialog).toBeVisible()
  const bounds = await dialog.boundingBox()
  expect(bounds?.x).toBeGreaterThanOrEqual(0)
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()!.width
  )
  const password = dialog.getByLabel("Shared editor password")
  await password.fill("incorrect phrase")
  await dialog.getByRole("button", { name: "Unlock editing" }).click()
  await expect(dialog.getByRole("alert")).toHaveText(
    "Incorrect editor password."
  )
  await password.fill("workshop phrase")
  await dialog.getByRole("button", { name: "Unlock editing" }).click()
  await expect(dialog).toBeHidden()
  await expect(editMode).toBeVisible()
  expect((await editMode.boundingBox())!.height).toBe(workspaceHeight)
  await expectMenuWithoutSessionActions()
  await expect(
    page.getByRole("heading", { name: "Interface table" })
  ).toBeVisible()

  if (hasTouch) {
    await workspace.focus()
    await page.keyboard.press("Shift+Tab")
  } else {
    await editMode.hover()
  }
  await expect(tooltip).toHaveText("Sign out")
  await expect(editMode).toHaveAccessibleDescription("Sign out")
  await editMode.click()
  await expect(viewMode).toBeVisible()
  await expect(tooltip).toBeHidden()
  await expect(
    page.getByRole("heading", { name: "Interface table" })
  ).toBeVisible()
})

test("idle expiry returns the current plan to read-only browsing", async ({
  page,
}) => {
  const now = new Date("2026-01-01T12:00:00Z")
  const idleTime = 8 * 60 * 60_000
  await page.clock.install({ time: now })
  let expired = false
  await page.route("**/api/editor-session", (route) =>
    route.fulfill({
      json: {
        canEdit: !expired,
        setupRequired: false,
        expiresAt: expired
          ? null
          : new Date(now.getTime() + idleTime).toISOString(),
      },
    })
  )
  await page.goto("/")
  const toolbar = page.getByRole("banner")
  await page.getByRole("button", { name: "Table" }).click()
  await expect(toolbar.getByRole("button", { name: "Edit mode" })).toBeVisible()

  expired = true
  await page.clock.fastForward(idleTime)
  await expectReadOnly(page)
  await expect(
    page.getByRole("heading", { name: "Interface table" })
  ).toBeVisible()
})
