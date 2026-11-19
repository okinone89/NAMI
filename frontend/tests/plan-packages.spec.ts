import { expect, test } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase } from "./workspace-settings"

const imageData =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="

test("download a plan and reopen an imported copy with its diagram and interface data", async ({
  page,
}, info) => {
  const name = `Transfer cell ${info.project.name}`
  const session = await page.request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
  })
  expect(session.ok()).toBe(true)
  const created = await page.request.post("/api/plans", { data: { name } })
  expect(created.status()).toBe(201)
  const original: Plan = await created.json()
  const saved = await page.request.put(`/api/plans/${original.id}`, {
    data: {
      ...original,
      networks: [{ id: "cell", name: "Cell LAN", subnet: "192.0.2.0/24" }],
      components: [
        {
          id: "panel",
          name: "Operator panel",
          type: "HMI",
          position: { x: 24, y: 72 },
          appearance: { kind: "custom", imageData },
        },
        {
          id: "drive",
          name: "Drive",
          type: "Drive",
          position: { x: 248, y: 72 },
          appearance: { kind: "shape", shape: "diamond", label: "Safety zone" },
        },
      ],
      interfaces: [
        {
          id: "panel-lan",
          componentId: "panel",
          name: "LAN",
          networkId: "cell",
          ipv4: "192.0.2.18",
          protocolProfiles: {
            profinet: { stationName: "panel-1", roles: ["device"] },
          },
        },
      ],
      links: [
        {
          id: "panel-drive",
          source: { componentId: "panel", interfaceId: "panel-lan" },
          target: { componentId: "drive" },
          medium: "wired",
          protocol: "PROFINET",
        },
      ],
    },
  })
  expect(saved.ok()).toBe(true)
  await page.goto(`/?plan=${original.id}`)
  const diagram = page.getByRole("region", { name: "Diagram", exact: true })
  const panel = diagram.getByRole("button", {
    name: "Operator panel",
    exact: true,
  })
  await expect(panel).toBeVisible()
  const originalPosition = await panel.getAttribute("style")

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export plan", exact: true }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.nami\.json$/)
  const file = info.outputPath("plan.nami.json")
  await download.saveAs(file)

  await page.getByRole("button", { name: "Import plan", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Import plan" })
  const packageInput = dialog.getByLabel("Plan package")
  const importButton = dialog.getByRole("button", { name: "Import plan" })
  await packageInput.setInputFiles({
    name: "incomplete.nami.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":1,"plan":{"name":"Incomplete"}}'),
  })
  await importButton.click()
  await expect(dialog.getByRole("alert")).toContainText(
    "Choose a complete and valid NAMI plan package"
  )
  const selection = page.getByLabel("Open plan")
  await expect(selection).toHaveValue(original.id)

  await packageInput.setInputFiles(file)
  await importButton.click()
  await expect(dialog).toBeHidden()
  await expect(selection.locator("option", { hasText: name })).toHaveCount(2)
  await expect(selection).not.toHaveValue(original.id)

  await page.getByRole("button", { name: "Sign out" }).click()
  await page.reload()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await expect(selection).not.toHaveValue(original.id)
  await expect(panel).toHaveAttribute("style", originalPosition!)
  const icon = panel.getByRole("img", { name: "Custom icon" })
  await expect(icon).toBeVisible()
  await expect
    .poll(() =>
      icon.evaluate((element: HTMLImageElement) => element.naturalWidth)
    )
    .toBe(1)
  await expect(diagram.getByText("Safety zone", { exact: true })).toBeVisible()
  await expect(
    diagram.getByRole("button", {
      name: "Operator panel / LAN to Drive (Wired)",
    })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Export plan" })).toBeHidden()
  await expect(page.getByRole("button", { name: "Import plan" })).toBeHidden()

  await page.getByRole("button", { name: "Table", exact: true }).click()
  const table = page.getByRole("region", { name: "Table", exact: true })
  const row = table.getByRole("row").filter({ hasText: "Operator panel" })
  await expect(row.getByText("192.0.2.18", { exact: true })).toBeVisible()
  await expect(row.getByText("Cell LAN", { exact: true })).toBeVisible()
  await row.getByRole("button", { name: "Operator panel", exact: true }).click()
  await expect(
    page.getByRole("dialog").getByText("panel-1", { exact: true })
  ).toBeVisible()
})
