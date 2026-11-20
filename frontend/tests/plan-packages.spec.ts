import { expect, test } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase, workspaceAction } from "./workspace-settings"

const destinationOrigin = process.env.NAMI_TEST_TRANSFER_DESTINATION

const imageData =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="

test("download a plan and reopen an imported copy with its diagram and interface data", async ({
  page,
}, info) => {
  const name = `Transfer cell ${info.project.name}${destinationOrigin ? " cross-provider" : ""}`
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
        {
          id: "drive-lan",
          componentId: "drive",
          name: "LAN",
          networkId: "cell",
        },
      ],
      links: [
        {
          id: "panel-drive",
          lineType: "elbow",
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
    workspaceAction(page, "Export plan"),
  ])
  expect(download.suggestedFilename()).toMatch(/\.nami\.json$/)
  const file = info.outputPath("plan.nami.json")
  await download.saveAs(file)

  const selectedId = () => new URL(page.url()).searchParams.get("plan")!
  let existingId = original.id
  if (destinationOrigin) {
    await page.context().clearCookies()
    await page.goto(destinationOrigin)
    await workspaceAction(page, "Unlock editing")
    const unlock = page.getByRole("dialog", { name: "Unlock editing" })
    await unlock.getByLabel("Shared editor passphrase").fill(editorPassphrase)
    await unlock.getByRole("button", { name: "Unlock editing" }).click()
    await workspaceAction(page, "New plan")
    const create = page.getByRole("dialog", { name: "New plan" })
    await create.getByLabel("Plan name").fill(name)
    await create.getByRole("button", { name: "Create plan" }).click()
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Table", exact: true }).click()
    existingId = selectedId()
    expect(existingId).not.toBe(original.id)
  }
  await workspaceAction(page, "Import plan")
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
  expect(selectedId()).toBe(existingId)

  await packageInput.setInputFiles(file)
  await importButton.click()
  await expect(dialog).toBeHidden()
  expect(selectedId()).not.toBe(existingId)
  if (destinationOrigin) {
    const copiedId = selectedId()
    const existing = await page.request.get(
      new URL(`/api/plans/${existingId}`, destinationOrigin).href
    )
    expect(existing.ok()).toBe(true)
    expect((await existing.json()).components).toEqual([])
    expect(copiedId).not.toBe(original.id)
  }
  await workspaceAction(page, "Open plan")
  await expect(
    page.getByRole("menuitemradio", { name, exact: true })
  ).toHaveCount(2)
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")

  await workspaceAction(page, "Sign out")
  await page.reload()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  expect(selectedId()).not.toBe(existingId)
  await expect(panel).toHaveAttribute("style", originalPosition!)
  const icon = panel.getByRole("img", { name: "Custom icon" })
  const copied = await page.request.get(
    new URL(`/api/plans/${selectedId()}`, page.url()).href
  )
  expect(((await copied.json()) as Plan).links[0].lineType).toBe("elbow")
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
  await page.getByRole("button", { name: "Workspace", exact: true }).click()
  const menu = page.getByRole("menu", { name: "Workspace", exact: true })
  await expect(menu.getByRole("menuitem", { name: "Export PDF" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Export plan" })).toHaveCount(
    0
  )
  await expect(page.getByRole("menuitem", { name: "Import plan" })).toHaveCount(
    0
  )
  await menu.press("Escape")
  await expect(menu).toBeHidden()

  await page.getByRole("button", { name: "Table", exact: true }).click()
  const table = page.getByRole("region", { name: "Table", exact: true })
  const row = table.getByRole("row").filter({
    has: page.getByRole("button", { name: "Operator panel", exact: true }),
  })
  await expect(row.getByText("192.0.2.18", { exact: true })).toBeVisible()
  await expect(row.getByText("Cell LAN", { exact: true })).toBeVisible()
  await row.getByRole("button", { name: "Operator panel", exact: true }).click()
  await expect(
    page.getByRole("dialog").getByText("panel-1", { exact: true })
  ).toBeVisible()
})
