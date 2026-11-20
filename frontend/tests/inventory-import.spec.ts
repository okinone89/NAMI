import { expect, test, type Page } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase, workspaceAction } from "./workspace-settings"

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
        {
          id: "test",
          name: "Isolated packaging",
          subnet: null,
          position: null,
        },
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

const csvHeader =
  "Component,Interface,Component type,Network,Network subnet,IPv4,Link partner,Partner port,Connection type,Link protocol"

async function previewRows(page: Page, ...rows: string[]) {
  await workspaceAction(page, "Import inventory")
  const dialog = page.getByRole("dialog", { name: "Import inventory" })
  await dialog
    .getByLabel("Spreadsheet rows")
    .fill([csvHeader, ...rows].join("\n"))
  await dialog.getByRole("button", { name: "Load pasted rows" }).click()
  await dialog.getByRole("button", { name: "Preview import" }).click()
  return dialog
}

test("clean changes go directly to one expandable import summary", async ({
  page,
}) => {
  await openInventory(page)
  const dialog = await previewRows(page, "Capper PLC,LAN B,,,,192.168.1.25,,,,")
  await expect(
    dialog.getByRole("heading", { name: "Import summary" })
  ).toBeVisible()
  const row = dialog.getByRole("region", { name: "Row 2" })
  await expect(row).toBeHidden()
  await dialog.getByText("Review rows", { exact: true }).click()
  await expect(row.getByRole("group", { name: "Before" })).toContainText(
    "192.168.1.20"
  )
  await expect(row.getByRole("group", { name: "After" })).toContainText(
    "192.168.1.25"
  )
  await dialog.getByRole("button", { name: "Apply import" }).click()
  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole("textbox", { name: "IPv4 address for Capper PLC / LAN B" })
  ).toHaveValue("192.168.1.25")
})

test("skipping the last unresolved row closes an unchanged plan without creating undo", async ({
  page,
}) => {
  const path = "/api/plans/" + (await openInventory(page))
  const before: Plan = await (await page.request.get(path)).json()
  const dialog = await previewRows(page, ",LAN B,,,,192.168.1.50,,,,")
  await expect(dialog.getByText("Provide the component name.")).toBeVisible()
  await expect(dialog.getByRole("heading", { name: "No changes" })).toHaveCount(
    0
  )
  await dialog.getByRole("radio", { name: "Skip affected rows" }).check()
  await dialog.getByRole("button", { name: "Next" }).click()
  await expect(
    dialog.getByRole("heading", { name: "No changes" })
  ).toBeVisible()
  await expect(dialog.getByText("Skipped row 2")).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Next" })).toHaveCount(0)
  await expect(
    dialog.getByRole("button", { name: "Apply import" })
  ).toHaveCount(0)
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await (await page.request.get(path)).json()).toEqual(before)
  expect((await page.request.get(path + "/inventory/undo")).status()).toBe(204)
  await expect(page.getByRole("button", { name: "Undo import" })).toHaveCount(0)
})

test("one decision covers a shared address conflict and Back preserves its answer", async ({
  page,
}) => {
  await openInventory(page)
  const dialog = await previewRows(
    page,
    "Capper PLC,LAN B,,,,192.168.1.10,,,,",
    "Capper PLC,LAN D,,,,192.168.1.10,,,,",
    "Packer PLC,LAN C,PLC,,,,,,,"
  )
  await expect(dialog.getByText("Decision 1 of 1")).toBeVisible()
  await expect(dialog.getByRole("region", { name: "Row 2" })).toBeVisible()
  await expect(dialog.getByRole("region", { name: "Row 3" })).toBeVisible()
  await expect(dialog.getByRole("region", { name: "Row 4" })).toHaveCount(0)
  await expect(dialog.getByText('Filler, "Line A" / LAN A')).toBeVisible()
  const keep = dialog.getByRole("radio", { name: "Keep conflict flagged" })
  const next = dialog.getByRole("button", { name: "Next" })
  await expect(keep).not.toBeChecked()
  await expect(next).toBeDisabled()
  await keep.check()
  await dialog.getByRole("button", { name: "Back" }).click()
  await dialog.getByRole("button", { name: "Preview import" }).click()
  await expect(keep).toBeChecked()
  await next.click()
  await expect(
    dialog.getByRole("heading", { name: "Import summary" })
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Back" }).click()
  await expect(keep).toBeChecked()
  await dialog.getByRole("radio", { name: "Skip affected rows" }).check()
  await next.click()
  await expect(dialog.getByText("Skipped rows 2, 3")).toBeVisible()
  await dialog.getByRole("button", { name: "Apply import" }).click()
  await expect(dialog).toBeHidden()
  const table = page.getByRole("table", { name: "Interfaces" })
  await expect(
    table.getByRole("textbox", { name: "IPv4 address for Capper PLC / LAN B" })
  ).toHaveValue("192.168.1.20")
  await expect(table.getByRole("row", { name: /Packer PLC/ })).toBeVisible()
  await page.getByRole("button", { name: "Undo import" }).click()
  await expect(table.getByRole("row", { name: /Packer PLC/ })).toHaveCount(0)
})

test("changing a correction replaces the downstream decision and Cancel discards the draft", async ({
  page,
}) => {
  await openInventory(page)
  const dialog = await previewRows(
    page,
    "Capper PLC,LAN D,,,,bad,,,,",
    "Capper PLC,LAN B,,,,192.168.1.10,,,,"
  )
  const next = dialog.getByRole("button", { name: "Next" })
  const back = dialog.getByRole("button", { name: "Back" })
  const keep = dialog.getByRole("radio", { name: "Keep conflict flagged" })
  await dialog.getByRole("radio", { name: "Correct values" }).check()
  const ipv4 = dialog
    .getByRole("region", { name: "Row 2" })
    .getByLabel(/^IPv4( address)?$/)
  await ipv4.fill("192.168.1.11")
  await next.click()
  await expect(dialog.getByText("Decision 2 of 2")).toBeVisible()
  await keep.check()
  await next.click()
  await back.click()
  await expect(keep).toBeChecked()
  await back.click()
  await expect(ipv4).toHaveValue("192.168.1.11")
  await ipv4.fill("192.168.1.10")
  await next.click()
  await expect(dialog.getByRole("region", { name: "Row 2" })).toBeVisible()
  await expect(dialog.getByRole("region", { name: "Row 3" })).toBeVisible()
  await expect(keep).not.toBeChecked()
  await expect(next).toBeDisabled()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  const table = page.getByRole("table", { name: "Interfaces" })
  await expect(
    table.getByRole("textbox", { name: "IPv4 address for Capper PLC / LAN B" })
  ).toHaveValue("192.168.1.20")
  await expect(
    table.getByRole("textbox", { name: "IPv4 address for Capper PLC / LAN D" })
  ).toHaveValue("")
})

test("a stale apply reopens the new conflict and preserves unrelated answers through undo", async ({
  page,
  request,
}) => {
  const path = "/api/plans/" + (await openInventory(page))
  const dialog = await previewRows(
    page,
    "Capper PLC,LAN B,,,,192.168.1.10,,,,",
    "Capper PLC,LAN D,,,,192.168.1.25,,,,",
    "Packer PLC,LAN C,PLC,,,,,,,"
  )
  await dialog.getByRole("radio", { name: "Keep conflict flagged" }).check()
  await dialog.getByRole("button", { name: "Next" }).click()
  await expect(
    dialog.getByRole("heading", { name: "Import summary" })
  ).toBeVisible()

  // A second editor assigns the previously available address during review.
  await request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
  })
  const current: Plan = await (await request.get(path)).json()
  current.interfaces.push({
    id: "extra",
    componentId: "plc-a",
    name: "Service",
    networkId: "pack",
    ipv4: "192.168.1.25",
  })
  expect((await request.put(path, { data: current })).ok()).toBe(true)

  const apply = dialog.getByRole("button", { name: "Apply import" })
  await apply.click()
  await expect(dialog.getByText(/The plan changed/)).toBeVisible()
  await expect(dialog.getByRole("region", { name: "Row 3" })).toBeVisible()
  await expect(dialog.getByRole("region", { name: "Row 2" })).toHaveCount(0)
  await expect(
    dialog.getByRole("radio", { name: "Keep conflict flagged" })
  ).not.toBeChecked()
  await dialog.getByRole("radio", { name: "Skip affected rows" }).check()
  await dialog.getByRole("button", { name: "Next" }).click()
  await apply.click()
  await expect(dialog).toBeHidden()
  const table = page.getByRole("table", { name: "Interfaces" })
  const capper = table.getByRole("textbox", {
    name: "IPv4 address for Capper PLC / LAN B",
  })
  await expect(capper).toHaveValue("192.168.1.10")
  await expect(
    table.getByRole("textbox", { name: "IPv4 address for Capper PLC / LAN D" })
  ).toHaveValue("")
  await expect(table.getByRole("row", { name: /Packer PLC/ })).toBeVisible()
  await page.reload()
  await page.getByRole("button", { name: "Table", exact: true }).click()
  await page.getByRole("button", { name: "Undo import" }).click()
  await expect(capper).toHaveValue("192.168.1.20")
  await expect(table.getByRole("row", { name: /Packer PLC/ })).toHaveCount(0)
  await expect(
    table.getByRole("textbox", { name: /IPv4 address for .*Service/ })
  ).toHaveValue("192.168.1.25")
})

test("reviews table selections before bulk editing and reconfirms a stale change", async ({
  page,
}) => {
  const planId = await openInventory(page)
  const interfaces = page.getByRole("table", { name: "Interfaces" })
  await interfaces.getByRole("checkbox", { name: /Select Filler/ }).check()
  await page.getByLabel("Search component").fill("capper")
  await interfaces
    .getByRole("checkbox", { name: "Select Capper PLC / LAN B" })
    .check()
  await page.getByRole("button", { name: "Edit selected interfaces" }).click()
  const dialog = page.getByRole("dialog", { name: "Bulk edit interfaces" })
  await dialog
    .getByLabel("Network membership")
    .selectOption({ label: "Isolated packaging" })
  await dialog.getByRole("button", { name: "Preview changes" }).click()
  const filler = dialog.getByRole("region", { name: "Row 1" })
  const capper = dialog.getByRole("region", { name: "Row 2" })
  await expect(filler.getByRole("group", { name: "Before" })).toContainText(
    "192.168.1.10"
  )
  await expect(capper.getByRole("group", { name: "After" })).toContainText(
    "Isolated packaging"
  )

  const planPath = `/api/plans/${planId}`
  const plan: Plan = await (await page.request.get(planPath)).json()
  plan.interfaces[0].ipv4 = "192.168.1.11"
  const edited = await page.request.put(planPath, { data: plan })
  expect(edited.ok()).toBe(true)
  const apply = dialog.getByRole("button", { name: "Apply bulk changes" })
  await apply.click()
  await expect(dialog.getByRole("status")).toContainText(
    "Review the refreshed preview"
  )
  await expect(filler.getByRole("group", { name: "Before" })).toContainText(
    "192.168.1.11"
  )
  const afterFirstConfirm: Plan = await (
    await page.request.get(planPath)
  ).json()
  expect(afterFirstConfirm).toEqual(await edited.json())

  await apply.click()
  await expect(dialog).toBeHidden()
  await expect(
    interfaces.getByRole("combobox", { name: "Network for Capper PLC / LAN B" })
  ).toHaveValue("test")
  const saved: Plan = await (await page.request.get(planPath)).json()
  expect(
    saved.interfaces.map(({ id, networkId, ipv4 }) => [id, networkId, ipv4])
  ).toEqual([
    ["port-a", "test", "192.168.1.11"],
    ["port-b", "test", "192.168.1.20"],
    ["port-d", "pack", null],
  ])
  await expect(page.getByRole("button", { name: "Undo import" })).toHaveCount(0)
})

test("correcting a network-only subnet shows both network values and restores the old subnet on undo", async ({
  page,
}) => {
  const path = "/api/plans/" + (await openInventory(page))
  const dialog = await previewRows(page, ",,,Packaging,10.0.0.0/8,,,,,")
  await expect(
    dialog.getByRole("heading", { name: "Review network subnet" })
  ).toBeVisible()
  await expect(dialog.getByText(/192\.168\.1\.10 on Filler/)).toBeVisible()
  await dialog.getByRole("radio", { name: "Correct values" }).check()
  await dialog
    .getByRole("textbox", { name: "Network subnet" })
    .fill("192.168.1.0/24")
  await dialog.getByRole("button", { name: "Next" }).click()
  await dialog.getByText("Review rows", { exact: true }).click()
  await expect(dialog.getByRole("group", { name: "After" })).toContainText(
    "192.168.1.0/24"
  )
  await dialog.getByRole("button", { name: "Apply import" }).click()
  await expect(dialog).toBeHidden()
  const saved: Plan = await (await page.request.get(path)).json()
  expect(saved.networks.find((n) => n.id === "pack")?.subnet).toBe(
    "192.168.1.0/24"
  )
  await page.getByRole("button", { name: "Undo import" }).click()
  await expect
    .poll(async () => {
      const restored: Plan = await (await page.request.get(path)).json()
      return restored.networks.find((n) => n.id === "pack")?.subnet
    })
    .toBeNull()
})

test("confirms grouped component and port renames before applying and undoing them", async ({
  page,
}) => {
  await openInventory(page)
  const dialog = await previewRows(
    page,
    "Capper 2,Control,,Packaging,,192.168.1.20,,,,",
    "Capper 2,LAN D,,,,,,,,"
  )
  const next = dialog.getByRole("button", { name: "Next" })
  const rename = dialog.getByRole("radio", {
    name: "Rename existing component",
  })
  await expect(rename).not.toBeChecked()
  await expect(next).toBeDisabled()
  await expect(dialog.getByRole("region", { name: "Row 3" })).toBeVisible()
  await rename.check()
  await next.click()
  await dialog.getByRole("radio", { name: "Rename existing port" }).check()
  await next.click()
  await dialog.getByRole("button", { name: "Apply import" }).click()
  const table = page.getByRole("table", { name: "Interfaces" })
  await expect(
    table.getByRole("row", { name: /Capper 2.*Control/ })
  ).toBeVisible()
  await page.getByRole("button", { name: "Undo import" }).click()
  await expect(
    table.getByRole("row", { name: /Capper PLC.*LAN B/ })
  ).toBeVisible()
  await expect(table.getByRole("row", { name: /Capper 2/ })).toHaveCount(0)
})
