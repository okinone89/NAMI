import { readFile } from "node:fs/promises"
import { expect, test, type Page } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase, workspaceAction } from "./workspace-settings"

async function createPlan(page: Page, name: string): Promise<Plan> {
  const created = await page.request.post("/api/plans", { data: { name } })
  expect(created.status()).toBe(201)
  return created.json()
}

async function openImport(page: Page, plan: Plan) {
  await page.goto(`/?plan=${plan.id}`)
  await workspaceAction(page, "Import inventory")
  return page.getByRole("dialog", { name: "Import inventory" })
}

test.beforeEach(async ({ page }) => {
  const session = await page.request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
  })
  expect(session.ok()).toBe(true)
})

test("an empty plan's exported CSV closes without a change or undo record", async ({
  page,
}) => {
  const plan = await createPlan(page, "Empty inventory")
  const path = "/api/plans/" + plan.id
  const csv = await (await page.request.get(path + "/inventory.csv")).body()
  const dialog = await openImport(page, plan)
  await dialog.getByLabel("CSV file").setInputFiles({
    name: "empty.csv",
    mimeType: "text/csv",
    buffer: csv,
  })
  await expect(
    dialog.getByRole("button", { name: "Preview import" })
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Preview import" }).click()
  await expect(
    dialog.getByRole("heading", { name: "No changes" })
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  expect(await (await page.request.get(path)).json()).toEqual(plan)
  expect((await page.request.get(path + "/inventory/undo")).status()).toBe(204)
})

test("legacy files and incomplete pasted headers explain where to get the current format", async ({
  page,
}) => {
  const dialog = await openImport(page, await createPlan(page, "New equipment"))
  await dialog.getByLabel("CSV file").setInputFiles({
    name: "old.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Component ID,Interface ID,Component,Interface\nc,i,Controller,P1"
    ),
  })
  await expect(
    dialog.getByText(/legacy ID headers.*Export inventory CSV/i)
  ).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: "Preview import" })
  ).toHaveCount(0)

  await dialog
    .getByLabel("Spreadsheet rows")
    .fill("Component,Interface\nController,P1")
  await dialog.getByRole("button", { name: "Load pasted rows" }).click()
  await expect(
    dialog.getByText(/current headers.*Export inventory CSV/i)
  ).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: "Preview import" })
  ).toHaveCount(0)
})

test("exported equipment imports into an empty plan and matches reordered pasted rows by name", async ({
  page,
}) => {
  const source = await createPlan(page, "Line A")
  const target = await createPlan(page, "Line B")
  const components = [
    {
      id: "plc",
      name: 'Controller, "west"',
      type: "PLC",
      position: null,
      hostId: null,
    },
    { id: "cab", name: "Cabinet", type: "Other", position: null, hostId: null },
  ]
  const interfaces = ["P1", "P2"].map((name) => ({
    id: name,
    componentId: "plc",
    name,
    networkId: null,
    ipv4: null,
  }))
  expect(
    (
      await page.request.put(`/api/plans/${source.id}`, {
        data: { ...source, components, interfaces } satisfies Plan,
      })
    ).ok()
  ).toBe(true)

  async function exportFile() {
    const download = page.waitForEvent("download")
    await workspaceAction(page, "Export inventory CSV")
    return (await download).path()
  }

  await page.goto(`/?plan=${source.id}`)
  const file = await exportFile()
  const dialog = await openImport(page, target)
  await dialog.getByLabel("CSV file").setInputFiles(file)
  await dialog.getByRole("button", { name: "Preview import" }).click()
  await dialog.getByRole("button", { name: "Apply import" }).click()
  await expect(dialog).toBeHidden()
  expect(await readFile(await exportFile(), "utf8")).toEqual(
    await readFile(file, "utf8")
  )
  const path = "/api/plans/" + target.id
  const imported: Plan = await (await page.request.get(path)).json()
  const receipt = await (
    await page.request.get(path + "/inventory/undo")
  ).json()
  await workspaceAction(page, "Import inventory")
  await dialog.getByLabel("CSV file").setInputFiles(file)
  await dialog.getByRole("button", { name: "Preview import" }).click()
  await expect(
    dialog.getByRole("heading", { name: "No changes" })
  ).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: "Apply import" })
  ).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Next" })).toHaveCount(0)
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await (await page.request.get(path)).json()).toEqual(imported)
  expect(
    await (await page.request.get(path + "/inventory/undo")).json()
  ).toEqual(receipt)

  await workspaceAction(page, "Import inventory")
  await dialog
    .getByLabel("Spreadsheet rows")
    .fill(
      [
        "Interface,Component,Network,Network subnet,IPv4,Component type,Link partner,Partner port,Connection type,Link protocol",
        ' p1 ," CONTROLLER, ""west"" ",,,,PLC,,,,',
        'p2,"controller, ""West""",,,,PLC,,,,',
        ", CABINET ,,,,Other,,,,",
      ].join("\n")
    )
  await dialog.getByRole("button", { name: "Load pasted rows" }).click()
  await dialog.getByRole("button", { name: "Preview import" }).click()
  await expect(
    dialog.getByRole("heading", { name: "No changes" })
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole("button", { name: "Table", exact: true }).click()
  await page.getByRole("button", { name: "Undo import" }).click()
  await expect
    .poll(async () => (await (await page.request.get(path)).json()).components)
    .toEqual([])
  const undone: Plan = await (await page.request.get(path)).json()
  expect(undone.interfaces).toEqual([])
  expect(undone.revision).toBe(imported.revision + 1)
})

test("reciprocal cabling and consistent metadata edits go directly to the summary", async ({
  page,
}) => {
  const plan = await createPlan(page, "Line wiring")
  const rows = [
    "Component,Interface,Component type,Network,Network subnet,IPv4,Link partner,Partner port,Connection type,Link protocol",
    "Controller,X1,PLC,,,,Switch,P8,,EtherCAT",
    "Switch,P8,Switch,,,,Controller,X1,FO,",
  ]
  async function apply(source: string[]) {
    const dialog = await openImport(page, plan)
    await dialog.getByLabel("Spreadsheet rows").fill(source.join("\n"))
    await dialog.getByRole("button", { name: "Load pasted rows" }).click()
    await dialog.getByRole("button", { name: "Preview import" }).click()
    await expect(
      dialog.getByRole("heading", { name: "Import summary" })
    ).toBeVisible()
    await dialog.getByRole("button", { name: "Apply import" }).click()
    await expect(dialog).toBeHidden()
    const response = await page.request.get(`/api/plans/${plan.id}`)
    expect(response.ok()).toBe(true)
    return (await response.json()) as Plan
  }
  const built = await apply(rows)
  expect(built.links).toHaveLength(1)
  expect(built.links[0]).toMatchObject({
    medium: "fiberOptic",
    protocol: "EtherCAT",
  })
  const edited = await apply([
    rows[0],
    "Switch,P8,Switch,,,,Controller,X1,Wired,",
    "Controller,X1,PLC,,,,Switch,P8,Wired,",
  ])
  expect(edited.links).toEqual([{ ...built.links[0], medium: "wired" }])
})

test("a clean move names both ports and an engineer can remove one installed connection", async ({
  page,
}) => {
  const plan = await createPlan(page, "Move a cable")
  const path = "/api/plans/" + plan.id
  const components = ["Controller", "Switch"].map((name) => ({
    id: name,
    name,
    type: "Other",
  }))
  const interfaces = ["X1", "P07", "P08", "P09"].map((name) => ({
    id: name,
    name,
    componentId: name === "X1" ? "Controller" : "Switch",
  }))
  const links = ["P07", "P08"].map((name) => ({
    id: name,
    source: { componentId: "Controller", interfaceId: "X1" },
    target: { componentId: "Switch", interfaceId: name },
    medium: "wired",
  }))
  expect(
    (
      await page.request.put(path, {
        data: { ...plan, components, interfaces, links },
      })
    ).ok()
  ).toBe(true)
  async function review(rows: string[]) {
    const dialog = await openImport(page, plan)
    await dialog
      .getByLabel("Spreadsheet rows")
      .fill(
        [
          "Component,Interface,Component type,Network,Network subnet,IPv4,Link partner,Partner port,Connection type,Link protocol",
          ...rows,
        ].join("\n")
      )
    await dialog.getByRole("button", { name: "Load pasted rows" }).click()
    await dialog.getByRole("button", { name: "Preview import" }).click()
    return dialog
  }
  const move = await review([
    "Controller,X1,,,,,Switch,P07,,",
    "Controller,X1,,,,,Switch,P09,,",
  ])
  await expect(
    move.getByRole("heading", { name: "Import summary" })
  ).toBeVisible()
  await expect(
    move.getByText(/Move.*Controller \/ X1.*Switch \/ P08.*Switch \/ P09/)
  ).toBeVisible()
  await move.getByRole("button", { name: "Apply import" }).click()
  await expect(move).toBeHidden()
  const removal = await review(["Controller,X1,,,,,,,,"])
  await expect(
    removal.getByRole("heading", { name: "No changes" })
  ).toBeVisible()
  await removal.getByText("Review rows").click()
  await removal
    .getByRole("button", { name: /Remove connection.*Switch \/ P09/ })
    .click()
  await expect(
    removal
      .getByText(/Remove .*Controller \/ X1.*Switch \/ P09/, { exact: false })
      .first()
  ).toBeVisible()
  await removal.getByRole("button", { name: "Apply import" }).click()
  await expect(removal).toBeHidden()
  const saved: Plan = await (await page.request.get(path)).json()
  expect(saved.links.map((link) => link.id)).toEqual(["P07"])
})
