import { workspaceAction, expectReadOnly } from "./workspace-settings"
import { expect, test } from "@playwright/test"

test("unlock editing and sign out without leaving the current plan view", async ({
  page,
}) => {
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
  await page.getByRole("button", { name: "Table" }).click()
  await workspaceAction(page, "Unlock editing")
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
  await expect(page.getByText("Editing unlocked")).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Interface table" })
  ).toBeVisible()

  await workspaceAction(page, "Sign out")
  await expectReadOnly(page)
  await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden()
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
  await page.getByRole("button", { name: "Table" }).click()
  await expect(page.getByText("Editing unlocked")).toBeVisible()

  expired = true
  await page.clock.fastForward(idleTime)
  await expectReadOnly(page)
  await expect(
    page.getByRole("heading", { name: "Interface table" })
  ).toBeVisible()
})
