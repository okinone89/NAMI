import { expectReadOnly } from "./workspace-settings"
import { expect, test } from "@playwright/test"

test("describe and run the mode badge actions", async ({ page, hasTouch }) => {
  let canEdit = false
  await page.route("**/api/editor-session", async (route) => {
    const method = route.request().method()
    if (method === "POST") {
      if (route.request().postDataJSON().passphrase !== "workshop phrase") {
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
  const passphrase = dialog.getByLabel("Shared editor passphrase")
  await passphrase.fill("incorrect phrase")
  await dialog.getByRole("button", { name: "Unlock editing" }).click()
  await expect(dialog.getByRole("alert")).toHaveText(
    "Incorrect editor passphrase."
  )
  await passphrase.fill("workshop phrase")
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
