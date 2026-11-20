import { expect, test, type APIRequestContext } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase } from "./workspace-settings"

async function createInterfacePlan(request: APIRequestContext) {
  const session = await request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
  })
  expect(session.ok()).toBe(true)
  const created = await request.post("/api/plans", {
    data: { name: "Interface inventory" },
  })
  expect(created.status()).toBe(201)
  const plan: Plan = await created.json()
  const saved = await request.put(`/api/plans/${plan.id}`, {
    data: {
      ...plan,
      networks: [
        { id: "plant", name: "Plant", subnet: null, position: null },
        { id: "controls", name: "Controls", subnet: null, position: null },
      ],
      components: [
        {
          id: "runtime",
          name: "Runtime",
          type: "VM",
          position: null,
          hostId: null,
        },
        {
          id: "switch",
          name: "Main switch",
          type: "Switch",
          position: null,
          hostId: null,
        },
        {
          id: "pending",
          name: "New PLC",
          type: "PLC",
          position: null,
          hostId: null,
        },
      ],
      interfaces: [
        {
          id: "control-port",
          componentId: "runtime",
          name: "Adapter 2",
          networkId: "controls",
          ipv4: "10.50.0.10",
        },
        {
          id: "switch-port",
          componentId: "switch",
          name: "Port 1",
          networkId: "plant",
          ipv4: null,
        },
        {
          id: "plant-port",
          componentId: "runtime",
          name: "Adapter 1",
          networkId: "plant",
          ipv4: "10.50.0.9",
        },
      ],
    } satisfies Plan,
  })
  expect(saved.ok()).toBe(true)
  return plan.id
}

test("anonymous visitors can sort, filter and inspect interface rows", async ({
  page,
  playwright,
  baseURL,
}) => {
  const editorRequest = await playwright.request.newContext({ baseURL })
  const planId = await createInterfacePlan(editorRequest)
  await editorRequest.dispose()

  await page.goto(`/?plan=${planId}`)
  await page.getByRole("button", { name: "Table", exact: true }).click()
  const tableView = page.getByRole("region", { name: "Table", exact: true })
  const body = tableView
    .getByRole("table", { name: "Interfaces", exact: true })
    .getByRole("rowgroup")
    .last()
  const runtime = body.getByRole("row").filter({ hasText: "Runtime" })
  await expect(body.getByRole("row")).toHaveCount(3)
  await expect(runtime).toHaveCount(2)
  await expect(runtime.first().getByText("VM", { exact: true })).toBeVisible()
  await expect(runtime.first().getByRole("textbox")).toHaveCount(0)
  await expect(runtime.first().getByRole("combobox")).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await expect(
    page.getByRole("button", { name: "Unlock editing" })
  ).toBeVisible()

  const filter = tableView.getByRole("searchbox", { name: "Filter interfaces" })
  await filter.fill("  vm  ")
  await expect(body.getByRole("row")).toHaveCount(2)
  await expect(
    body.getByRole("row").filter({ hasText: "Main switch" })
  ).toHaveCount(0)
  const sortByAddress = tableView.getByRole("button", {
    name: "IPv4 address",
    exact: true,
  })
  await sortByAddress.click()
  await expect(runtime.first()).toContainText("Adapter 1")
  await expect(runtime.last()).toContainText("Adapter 2")
  await sortByAddress.click()
  await expect(runtime.first()).toContainText("Adapter 2")
  await expect(runtime.last()).toContainText("Adapter 1")

  await runtime
    .first()
    .getByRole("button", { name: "Runtime", exact: true })
    .click()
  const vm = page.getByRole("dialog", { name: "Runtime", exact: true })
  await expect(vm.getByText("10.50.0.10", { exact: true })).toBeVisible()
  await expect(vm.getByRole("button", { name: "Save component" })).toBeHidden()
  await vm.getByRole("button", { name: "Close" }).click()

  await filter.fill("unknown")
  await expect(tableView.getByText("No matching interfaces.")).toBeVisible()
  await filter.clear()
  await tableView.getByRole("button", { name: "New PLC", exact: true }).click()
  await expect(
    page.getByRole("dialog", { name: "New PLC", exact: true })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

test("editors save the same interface after sorting and filtering it out", async ({
  page,
}) => {
  const planId = await createInterfacePlan(page.request)
  await page.goto(`/?plan=${planId}`)
  const openTable = () =>
    page.getByRole("button", { name: "Table", exact: true }).click()
  await openTable()
  const tableView = page.getByRole("region", { name: "Table", exact: true })
  const table = tableView.getByRole("table", {
    name: "Interfaces",
    exact: true,
  })
  const runtime = table.getByRole("row").filter({ hasText: "Runtime" })
  const adapter = runtime.filter({ hasText: "Adapter 1" })
  const sortByAddress = table.getByRole("button", {
    name: "IPv4 address",
    exact: true,
  })
  await sortByAddress.click()
  await expect(runtime.first()).toContainText("Adapter 1")
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await adapter
    .getByRole("combobox", { name: "Network for Runtime / Adapter 1" })
    .selectOption({ label: "Controls" })
  await adapter
    .getByRole("textbox", { name: "IPv4 address for Runtime / Adapter 1" })
    .fill("10.50.0.35")
  await sortByAddress.click()
  await expect(runtime.first()).toContainText("Adapter 2")
  await expect(runtime.last().getByRole("textbox")).toHaveValue("10.50.0.35")

  const filter = tableView.getByRole("searchbox", { name: "Filter interfaces" })
  await filter.fill("Adapter 2")
  await expect(adapter).toHaveCount(0)
  const save = tableView.getByRole("button", {
    name: "Save interface",
    exact: true,
  })
  await save.click()
  await expect(save).toBeHidden()
  await filter.fill("Controls")
  await expect(adapter.getByRole("textbox")).toHaveValue("10.50.0.35")
  await expect(runtime.first()).toContainText("Adapter 1")
  await expect(
    adapter.getByRole("combobox").locator("option:checked")
  ).toHaveText("Controls")

  await page.reload()
  await openTable()
  await adapter.getByRole("button", { name: "Runtime", exact: true }).click()
  const vm = page.getByRole("dialog", { name: "Runtime", exact: true })
  const adapter1 = vm.getByRole("group", { name: "Adapter 1", exact: true })
  const adapter2 = vm.getByRole("group", { name: "Adapter 2", exact: true })
  await expect(adapter1.getByLabel("IPv4 address")).toHaveValue("10.50.0.35")
  await expect(
    adapter1.getByLabel("Network").locator("option:checked")
  ).toHaveText("Controls")
  await expect(adapter2.getByLabel("IPv4 address")).toHaveValue("10.50.0.10")
  await expect(
    adapter2.getByLabel("Network").locator("option:checked")
  ).toHaveText("Controls")

  await vm.getByRole("button", { name: "Add interface", exact: true }).click()
  await vm
    .getByRole("group", { name: "New interface", exact: true })
    .getByLabel("Interface name")
    .fill("Adapter 3")
  await vm.getByRole("button", { name: "Save component", exact: true }).click()
  await expect(vm).toBeHidden()
  await expect(filter).toHaveValue("Controls")
  await filter.clear()
  await expect(runtime).toHaveCount(3)
  await expect(runtime.filter({ hasText: "Adapter 3" })).toBeVisible()
})
