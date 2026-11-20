import { expect, type Page } from "@playwright/test"
export const editorPassphrase = "playwright-only editor passphrase"

export async function workspaceAction(page: Page, name: string) {
  await page.getByRole("button", { name: "Workspace", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

export async function expectReadOnly(page: Page) {
  await page.getByRole("button", { name: "Workspace", exact: true }).click()
  await expect(
    page.getByRole("menuitem", { name: "Unlock editing" })
  ).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toHaveCount(0)
  await page.keyboard.press("Escape")
}
