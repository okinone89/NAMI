import { expect, type Page } from "@playwright/test"
export const editorPassphrase = "playwright-only editor passphrase"

export async function workspaceAction(page: Page, name: string) {
  await page.getByRole("button", { name: "Workspace", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

export async function unlockEditing(page: Page) {
  await page.getByRole("button", { name: "View mode", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Unlock editing" })
  await dialog.getByLabel("Shared editor passphrase").fill(editorPassphrase)
  await dialog.getByRole("button", { name: "Unlock editing" }).click()
  await expect(
    page.getByRole("button", { name: "Edit mode", exact: true })
  ).toBeVisible()
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Edit mode", exact: true }).click()
  await expectReadOnly(page)
}

export async function expectReadOnly(page: Page) {
  await expect(
    page.getByRole("button", { name: "View mode", exact: true })
  ).toBeVisible()
}
