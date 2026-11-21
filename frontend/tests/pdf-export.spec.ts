import { workspaceAction } from "./workspace-settings"
import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { unzipSync } from "fflate"

test("a reader can reopen filtered views and download combined and per-network reports", async ({
  page,
}, testInfo) => {
  const networks = ["Office", "Plant"].map((name) => ({
    id: name,
    name,
    position: null,
    subnet: null,
  }))
  const components = ["Router", "Switch", "PLC"].map((name, i) => ({
    id: name,
    name,
    type: name,
    hostId: null,
    position: { x: 20 + i * 230, y: 40 },
  }))
  const interfaces = components.map((c, i) => ({
    id: c.id + "-eth",
    componentId: c.id,
    name: "Ethernet",
    networkId: networks[i % 2].id,
    ipv4: "192.168.0." + i,
  }))
  const plan = {
    id: "p1",
    name: "Site inventory",
    revision: 1,
    networks,
    components,
    interfaces,
    links: [
      {
        id: "l1",
        medium: "wired",
        source: { componentId: "Router", interfaceId: "Router-eth" },
        target: { componentId: "PLC", interfaceId: "PLC-eth" },
        protocol: null,
      },
    ],
  }
  await page.route("**/api/editor-session", (r) =>
    r.fulfill({ json: { canEdit: false, expiresAt: null, setupRequired: false } })
  )
  await page.route("**/api/plans", (r) =>
    r.fulfill({ json: [{ id: plan.id, name: plan.name }] })
  )
  await page.route("**/api/plans/p1", (r) => r.fulfill({ json: plan }))
  await page.goto("/?plan=p1")
  await page.getByRole("button", { name: "Office", exact: true }).click()
  await page.getByRole("searchbox", { name: "Search plan" }).fill("Ethernet")
  await page.reload()
  await expect(
    page.getByRole("button", { name: "Office", exact: true })
  ).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Table", exact: true }).click()
  await expect(page.getByRole("searchbox")).toHaveValue("Ethernet")
  await workspaceAction(page, "Export", "PDF")
  await expect(page.getByLabel("Include")).toHaveValue("Table")
  await page.getByLabel("Include").selectOption("Both")
  const downloading = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download PDF" }).click()
  const pdf = await downloading
  expect(pdf.suggestedFilename()).toBe("Site inventory-Office.pdf")
  const output = testInfo.outputPath("combined.pdf")
  await pdf.saveAs(output)
  expect((await readFile(output)).toString("latin1")).toMatch(/\/Count 2\b/)
  await workspaceAction(page, "Export", "PDF")
  await page.getByLabel("Export scope").selectOption("separate")
  const zipping = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download ZIP" }).click()
  const zip = await zipping
  expect(zip.suggestedFilename()).toBe("Site inventory-networks.zip")
  const files = unzipSync(await readFile((await zip.path())!))
  expect(Object.keys(files)).toEqual(["1-Office.pdf", "2-Plant.pdf"])
  for (const file of Object.values(files))
    expect(Buffer.from(file).toString("ascii", 0, 5)).toBe("%PDF-")
  await page.reload()
  await workspaceAction(page, "Export", "PDF")
  await expect(page.getByLabel("Export scope")).toHaveValue("separate")
})

test("selected networks start on fresh PDF pages and are remembered per plan", async ({
  page,
}, testInfo) => {
  const networks = ["Office", "Plant", "Lab"].map((id) => ({
    id,
    name: id,
    position: null,
    subnet: null,
  }))
  const plans = ["East", "West"].map((id) => ({
    id,
    name: id,
    revision: 1,
    networks,
    components: [],
    interfaces: [],
    links: [],
  }))
  await page.route("**/api/editor-session", (r) =>
    r.fulfill({ json: { canEdit: false, expiresAt: null, setupRequired: false } })
  )
  await page.route("**/api/plans", (r) => r.fulfill({ json: plans }))
  for (const plan of plans)
    await page.route("**/api/plans/" + plan.id, (r) =>
      r.fulfill({ json: plan })
    )
  const open = () => workspaceAction(page, "Export", "PDF")
  const scope = page.getByLabel("Export scope")
  const download = page.getByRole("button", { name: "Download PDF" })
  await page.goto("/?plan=East")
  await open()
  await scope.selectOption("selected")
  await expect(download).toBeDisabled()
  await page.getByRole("checkbox", { name: "Lab", exact: true }).check()
  await page.getByRole("checkbox", { name: "Office", exact: true }).check()
  await page.reload()
  await open()
  await expect(scope).toHaveValue("selected")
  await expect(
    page.getByRole("checkbox", { name: "Lab", exact: true })
  ).toBeChecked()
  await expect(
    page.getByRole("checkbox", { name: "Office", exact: true })
  ).toBeChecked()
  await expect(
    page.getByRole("checkbox", { name: "Plant", exact: true })
  ).not.toBeChecked()
  await page.getByLabel("Include").selectOption("Both")
  const downloading = page.waitForEvent("download")
  await download.click()
  const pdf = await downloading
  expect(pdf.suggestedFilename()).toBe("East-selected-networks.pdf")
  const output = testInfo.outputPath("selected.pdf")
  await pdf.saveAs(output)
  expect((await readFile(output)).toString("latin1")).toMatch(/\/Count 4\b/)
  await workspaceAction(page, "Open plan")
  await page.getByRole("menuitemradio", { name: "West" }).click()
  await open()
  await scope.selectOption("selected")
  await expect(download).toBeDisabled()
})
