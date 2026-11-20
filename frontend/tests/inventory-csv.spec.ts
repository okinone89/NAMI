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
    dialog.getByText("No changes", { exact: true }).first()
  ).toBeVisible()
  await expect(
    dialog
      .getByRole("button", { name: "Apply import" })
      .and(page.locator(":enabled"))
  ).toHaveCount(0)
})
