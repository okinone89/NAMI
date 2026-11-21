import { expect, test, type Page } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassword } from "./workspace-settings"

async function openAddressPlan(page: Page) {
  const session = await page.request.post("/api/editor-session", {
    data: { password: editorPassword },
  })
  expect(session.ok()).toBe(true)
  const created = await page.request.post("/api/plans", {
    data: { name: "Cell addressing" },
  })
  expect(created.status()).toBe(201)
  const plan: Plan = await created.json()
  const saved = await page.request.put(`/api/plans/${plan.id}`, {
    data: {
      ...plan,
      networks: [
        { id: "filler", name: "Filler LAN", subnet: null, position: null },
        { id: "capper", name: "Capper LAN", subnet: null, position: null },
      ],
      components: [
        {
          id: "filler-plc",
          name: "Filler PLC",
          type: "PLC",
          position: { x: 30, y: 120 },
          hostId: null,
        },
        {
          id: "capper-plc",
          name: "Capper PLC",
          type: "PLC",
          position: { x: 215, y: 120 },
          hostId: null,
        },
      ],
      interfaces: [
        {
          id: "filler-lan",
          componentId: "filler-plc",
          name: "LAN A",
          networkId: "filler",
          ipv4: "192.168.1.10",
        },
        {
          id: "capper-lan",
          componentId: "capper-plc",
          name: "LAN B",
          networkId: "capper",
          ipv4: "192.168.1.10",
        },
      ],
    } satisfies Plan,
  })
  expect(saved.ok()).toBe(true)
  await page.goto(`/?plan=${plan.id}`)
}

test("keeping and correcting a network membership conflict updates both plan views", async ({
  page,
}) => {
  await openAddressPlan(page)
  await page.getByRole("button", { name: "Table", exact: true }).click()
  const table = page.getByRole("table", { name: "Interfaces" })
  const capper = table.getByRole("row").filter({ hasText: "Capper PLC" })
  const flags = table.getByText("IPv4 address conflict", { exact: true })
  await expect(capper).toBeVisible()
  await expect(flags).toHaveCount(0)

  await capper.getByRole("combobox").selectOption({ label: "Filler LAN" })
  await page
    .getByRole("button", { name: "Save interface", exact: true })
    .click()
  const warning = page.getByRole("alert")
  await expect(warning).toContainText("192.168.1.10 is already assigned")
  await expect(warning).toContainText("Filler PLC / LAN A")
  await expect(warning).toContainText("Capper PLC / LAN B")
  await expect(flags).toHaveCount(0)
  await page.getByRole("button", { name: "Keep conflicts flagged" }).click()
  await expect(flags).toHaveCount(2)

  await page.reload()
  const diagram = page.getByRole("region", { name: "Diagram", exact: true })
  const diagramFlags = diagram.getByRole("img", {
    name: "IPv4 address conflict",
  })
  await expect(diagramFlags).toHaveCount(2)
  await diagram.getByRole("button", { name: "Capper PLC", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Capper PLC" })
  await expect(
    editor.getByText("IPv4 address conflict", { exact: true })
  ).toBeVisible()
  await expect(editor.getByText("Filler PLC / LAN A")).toBeVisible()
  await editor.getByLabel("IPv4 address").fill("192.168.1.11")
  await editor.getByRole("button", { name: "Save component" }).click()
  await expect(editor).toBeHidden()
  await expect(diagramFlags).toHaveCount(0)
  await page.getByRole("button", { name: "Table", exact: true }).click()
  await expect(capper.getByRole("textbox")).toHaveValue("192.168.1.11")
  await expect(flags).toHaveCount(0)
})

test("editors can add and clear a subnet and correct an out-of-range address", async ({
  page,
}) => {
  await openAddressPlan(page)
  const editNetwork = page.getByRole("button", {
    name: "Edit network Filler LAN",
  })
  await editNetwork.click()
  const network = page.getByRole("dialog", { name: "Edit network" })
  const base = network.getByLabel("IPv4 network address")
  const mask = network.getByLabel("Subnet mask")
  const saveNetwork = network.getByRole("button", { name: "Save network" })
  await base.fill("192.168.1.0")
  await mask.fill("255.0.255.0")
  await saveNetwork.click()
  await expect(network.getByRole("alert")).toContainText(
    "contiguous subnet mask"
  )
  await mask.fill("255.255.255.128")
  await saveNetwork.click()
  await expect(network).toBeHidden()
  for (const [region, address] of [
    ["Networks", "192.168.1.0/25"],
    ["Diagram", "192.168.1.10/25"],
  ]) {
    await expect(
      page
        .getByRole("region", { name: region, exact: true })
        .getByText(address, { exact: true })
    ).toBeVisible()
  }
  await expect(
    page.getByText("Mask 255.255.255.128", { exact: true })
  ).toHaveCount(0)

  await page.getByRole("button", { name: "Table", exact: true }).click()
  const address = page.getByRole("textbox", {
    name: "IPv4 address for Filler PLC / LAN A",
  })
  const saveInterface = page.getByRole("button", { name: "Save interface" })
  const discard = page.getByRole("button", { name: "Discard changes" })
  await address.fill("192.168.1.180")
  await saveInterface.click()
  await expect(page.getByRole("alert")).toContainText(
    "outside Filler LAN's subnet (192.168.1.0/25)"
  )
  await expect(
    page.getByRole("button", { name: "Keep conflicts flagged" })
  ).toHaveCount(0)
  await address.fill("192.168.1.15")
  await saveInterface.click()
  await expect(discard).toBeHidden()

  await editNetwork.click()
  await expect(base).toHaveValue("192.168.1.0")
  await expect(mask).toHaveValue("255.255.255.128")
  await base.clear()
  await mask.clear()
  await saveNetwork.click()
  await expect(network).toBeHidden()
  await address.fill("192.168.1.180")
  await saveInterface.click()
  await expect(discard).toBeHidden()
  await expect(address).toHaveValue("192.168.1.180")
})
