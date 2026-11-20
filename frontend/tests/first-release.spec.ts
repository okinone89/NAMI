import { expect, test } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import {
  createBaselinePlan,
  sharedMachineAddress,
} from "./fixtures/baseline-plan"
import {
  editorPassphrase,
  workspaceAction,
  expectReadOnly,
} from "./workspace-settings"

test("browse isolated PLCs and keep, reopen, and resolve a baseline address conflict", async ({
  page,
  request,
}) => {
  const plan = await createBaselinePlan(request)
  const planPath = `/api/plans/${plan.id}`
  await page.goto(`/?plan=${plan.id}`)
  const heading = page.getByRole("heading", { name: plan.name, exact: true })
  await expect(heading).toBeVisible()
  await expect(
    page.getByText("10 networks · 200 components · 250 interfaces")
  ).toBeVisible()

  await expectReadOnly(page)
  const denied = await page.request.put(planPath, {
    data: { ...plan, name: "Anonymous change" },
  })
  expect(denied.status()).toBe(401)
  expect(await (await page.request.get(planPath)).json()).toEqual(plan)

  const search = page.getByRole("searchbox", { name: "Search plan" })
  const results = page.getByRole("list", { name: "Search results" })
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  await search.fill(sharedMachineAddress)
  await expect(results.getByRole("button")).toHaveCount(2)
  await expect(
    results.getByRole("button", {
      name: /Filler A PLC.*Filler A \/ Machine LAN/,
    })
  ).toBeVisible()
  await results
    .getByRole("button", { name: /Filler B PLC.*Filler B \/ Machine LAN/ })
    .click()
  await expect(
    page.getByRole("button", { name: "Filler B / Machine LAN", exact: true })
  ).toHaveAttribute("aria-pressed", "true")
  await canvas
    .getByRole("button", { name: "Filler B PLC", exact: true })
    .click()
  const plc = page.getByRole("dialog", { name: "Filler B PLC" })
  await expect(
    plc.getByText(sharedMachineAddress, { exact: true })
  ).toBeVisible()
  await expect(plc.getByRole("button", { name: "Save component" })).toBeHidden()
  await plc.getByRole("button", { name: "Close" }).click()
  await search.clear()

  await workspaceAction(page, "Unlock editing")
  const session = page.getByRole("dialog", { name: "Unlock editing" })
  await session.getByLabel("Shared editor passphrase").fill(editorPassphrase)
  await session.getByRole("button", { name: "Unlock editing" }).click()
  await expect(page.getByText("Editing unlocked")).toBeVisible()

  const tableButton = page.getByRole("button", { name: "Table", exact: true })
  await tableButton.click()
  await page
    .getByRole("button", { name: "Filler B / Machine LAN", exact: true })
    .click()
  const table = page.getByRole("table", { name: "Interfaces" })
  const address = table.getByRole("textbox", {
    name: "IPv4 address for Filler A HMI / Ethernet",
    exact: true,
  })
  const tableFlags = table.getByText("IPv4 address conflict", { exact: true })
  const filter = page.getByLabel("Search component")
  await filter.fill("Filler A")
  await expect(address).toHaveValue("192.168.1.11")
  await expect(tableFlags).toHaveCount(0)
  await address.fill(sharedMachineAddress)
  await page
    .getByRole("button", { name: "Save interface", exact: true })
    .click()
  const warning = page.getByRole("alert")
  await expect(warning).toContainText("Filler A PLC / Ethernet")
  await expect(warning).toContainText("Filler A HMI / Ethernet")
  const beforeApproval: Plan = await (await page.request.get(planPath)).json()
  expect(beforeApproval.revision).toBe(plan.revision)
  await page.getByRole("button", { name: "Keep conflicts flagged" }).click()
  await expect(tableFlags).toHaveCount(2)

  await page.reload()
  await expect(heading).toBeVisible()
  await page
    .getByRole("button", { name: "Filler A / Machine LAN", exact: true })
    .click()
  const diagramFlags = canvas.getByRole("img", {
    name: "IPv4 address conflict",
  })
  await expect(diagramFlags).toHaveCount(2)
  await canvas
    .getByRole("button", { name: "Filler A HMI", exact: true })
    .click()
  const hmi = page.getByRole("dialog", { name: "Filler A HMI" })
  const ethernet = hmi.getByRole("group", { name: "Ethernet", exact: true })
  await expect(ethernet.getByText("Filler A PLC / Ethernet")).toBeVisible()
  const correctedAddress = "192.168.1.81"
  await ethernet.getByLabel("IPv4 address").fill(correctedAddress)
  await hmi.getByRole("button", { name: "Save component" }).click()
  await expect(hmi).toBeHidden()
  await expect(diagramFlags).toHaveCount(0)

  await tableButton.click()
  await filter.fill("Filler A")
  await expect(address).toHaveValue(correctedAddress)
  await expect(tableFlags).toHaveCount(0)
  await workspaceAction(page, "Sign out")
  await expectReadOnly(page)
  await expect(
    table.getByRole("row", { name: /Filler A HMI.*Ethernet/ })
  ).toContainText(correctedAddress)
  await page.reload()
  await expect(heading).toBeVisible()
  await expectReadOnly(page)
  await search.fill(sharedMachineAddress)
  await expect(results.getByRole("button")).toHaveCount(2)
})
