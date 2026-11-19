import { expect, test } from "@playwright/test"

test("switch views while loading and browse the empty plan", async ({
  page,
}) => {
  let release!: () => void
  const loading = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/fixtures/empty-plan.json", async (route) => {
    await loading
    await route.continue()
  })
  await page.goto("/")
  try {
    await expect(page.getByRole("status")).toHaveText("Loading plan…")
    await page.getByRole("button", { name: "Table" }).click()
    await expect(
      page.getByRole("button", { name: "Table", pressed: true })
    ).toBeVisible()
  } finally {
    release()
  }
  await expect(
    page.getByRole("heading", { name: "No interfaces yet" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Diagram" }).click()
  await expect(
    page.getByRole("heading", { name: "No components yet" })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
