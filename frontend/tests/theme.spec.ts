import { workspaceAction } from "./workspace-settings"
import { expect, test } from "@playwright/test"

test("starts with the system theme and remembers explicit choices on later visits", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.goto("/")
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark")
  await workspaceAction(page, "Switch to light mode")
  const next = await context.newPage()
  await page.close()
  await next.emulateMedia({ colorScheme: "dark" })
  await next.goto("/")
  await expect(next.locator("html")).toHaveCSS("color-scheme", "light")
  await workspaceAction(next, "Switch to dark mode")
  await next.emulateMedia({ colorScheme: "light" })
  await next.reload()
  await expect(next.locator("html")).toHaveCSS("color-scheme", "dark")
})
