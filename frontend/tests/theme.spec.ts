import { expect, test } from "@playwright/test"

test("starts with the system theme and remembers explicit choices on later visits", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.goto("/")
  const toggle = page.getByRole("button", { name: "Dark mode" })
  await expect(toggle).toHaveAttribute("aria-pressed", "true")
  await toggle.click()
  const next = await context.newPage()
  await page.close()
  await next.emulateMedia({ colorScheme: "dark" })
  await next.goto("/")
  await expect(next.locator("html")).toHaveCSS("color-scheme", "light")
  await next.getByRole("button", { name: "Dark mode" }).click()
  await next.emulateMedia({ colorScheme: "light" })
  await next.reload()
  await expect(next.locator("html")).toHaveCSS("color-scheme", "dark")
})
