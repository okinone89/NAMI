import { expect, test, type Page } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase } from "./workspace-settings"

async function openInventory(page: Page) {
  const session = await page.request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
  })
  expect(session.ok()).toBe(true)
  const created = await page.request.post("/api/plans", {
    data: { name: "Packaging inventory" },
  })
  expect(created.status()).toBe(201)
  const plan: Plan = await created.json()
  const saved = await page.request.put(`/api/plans/${plan.id}`, {
    data: {
      ...plan,
      networks: [
        { id: "pack", name: "Packaging", subnet: null, position: null },
      ],
      components: [
        {
          id: "plc-a",
          name: 'Filler, "Line A"',
          type: "PLC",
          position: null,
          hostId: null,
        },
        {
          id: "plc-b",
          name: "Capper PLC",
          type: "PLC",
          position: null,
          hostId: null,
        },
      ],
      interfaces: [
        {
          id: "port-a",
          componentId: "plc-a",
          name: "LAN A",
          networkId: "pack",
          ipv4: "192.168.1.10",
        },
        {
          id: "port-b",
          componentId: "plc-b",
          name: "LAN B",
          networkId: "pack",
          ipv4: "192.168.1.20",
        },
        {
          id: "port-d",
          componentId: "plc-b",
          name: "LAN D",
          networkId: "pack",
          ipv4: null,
        },
      ],
    } satisfies Plan,
  })
  expect(saved.ok()).toBe(true)
  await page.goto(`/?plan=${plan.id}`)
  await page.getByRole("button", { name: "Table", exact: true }).click()
  return plan.id
}

test("an exported inventory CSV previews its unchanged interfaces", async ({
  page,
}) => {
  await openInventory(page)
  const download = page.waitForEvent("download")
  await page.getByRole("link", { name: "Export inventory CSV" }).click()
  const path = await (await download).path()
  await page.getByRole("button", { name: "Import inventory" }).click()
  const dialog = page.getByRole("dialog", { name: "Import inventory" })
  await dialog.getByLabel("CSV file").setInputFiles(path)
  await dialog.getByRole("button", { name: "Preview import" }).click()
  const filler = dialog.getByRole("region", { name: "Row 2" })
  await expect(filler.getByText('Filler, "Line A" / LAN A')).toBeVisible()
  await expect(filler.getByText("Matched by ID")).toBeVisible()
  await expect(filler.getByText("No changes")).toBeVisible()
  await expect(
    dialog.getByRole("region", { name: "Row 3" }).getByText("No changes")
  ).toBeVisible()
})

test("pasted rows can be mapped, reviewed, corrected, cleared, or skipped", async ({
  page,
}) => {
  const planId = await openInventory(page)
  await page.getByRole("button", { name: "Import inventory" }).click()
  const dialog = page.getByRole("dialog", { name: "Import inventory" })
  await dialog
    .getByLabel("Spreadsheet rows")
    .fill(
      [
        "Asset\tAdapter\tAddress\tSegment",
        "Capper PLC\tLAN B\t192.168.1.10\tPackaging",
        "Packer PLC\tLAN C\t\tPackaging",
        "Capper PLC\tLAN D\t\tPackaging",
      ].join("\n")
    )
  await dialog.getByRole("button", { name: "Load pasted rows" }).click()
  await dialog.getByLabel("Asset").selectOption({ label: "Component" })
  await dialog.getByLabel("Adapter").selectOption({ label: "Interface" })
  await dialog
    .getByLabel("Address", { exact: true })
    .selectOption({ label: "IPv4 address" })
  await dialog.getByLabel("Segment").selectOption({ label: "Network" })
  await dialog.getByRole("button", { name: "Preview import" }).click()

  const capper = dialog.getByRole("region", { name: "Row 2" })
  const packer = dialog.getByRole("region", { name: "Row 3" })
  const unassigned = dialog.getByRole("region", { name: "Row 4" })
  await expect(capper.getByText("Matched by name")).toBeVisible()
  await expect(capper.getByRole("group", { name: "Before" })).toContainText(
    "192.168.1.20"
  )
  await expect(capper.getByRole("group", { name: "After" })).toContainText(
    "192.168.1.10"
  )
  await expect(capper.getByText('Filler, "Line A" / LAN A')).toBeVisible()
  await expect(packer.getByText("Add component and interface")).toBeVisible()
  await capper.getByRole("button", { name: "Keep conflict flagged" }).click()
  await expect(capper.getByText("Conflict kept and flagged")).toBeVisible()

  await capper.getByRole("button", { name: "Correct row" }).click()
  await capper.getByLabel("IPv4 address", { exact: true }).fill("192.168.1.22")
  await dialog.getByRole("button", { name: "Update preview" }).click()
  await expect(capper.getByRole("group", { name: "After" })).toContainText(
    "192.168.1.22"
  )
  await expect(capper.getByText("Conflict kept and flagged")).toHaveCount(0)

  await capper.getByLabel("Clear IPv4 value").check()
  await packer.getByLabel("Skip row").check()
  await unassigned.getByRole("button", { name: "Correct row" }).click()
  await unassigned.getByLabel("Clear IPv4 value").check()
  await dialog.getByRole("button", { name: "Update preview" }).click()
  await expect(capper.getByRole("group", { name: "After" })).toContainText(
    "Clear value"
  )
  await expect(packer.getByText("Skipped", { exact: true })).toBeVisible()
  await expect(unassigned.getByRole("group", { name: "After" })).toContainText(
    "Clear value"
  )

  const current: Plan = await (
    await page.request.get(`/api/plans/${planId}`)
  ).json()
  expect(current.interfaces.map((port) => port.ipv4)).toEqual([
    "192.168.1.10",
    "192.168.1.20",
    null,
  ])
})
