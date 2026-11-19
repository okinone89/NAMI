import { expect, test, type Page } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase } from "./workspace-settings"

async function openAllocationPlan(page: Page) {
  const session = await page.request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
  })
  expect(session.ok()).toBe(true)
  const response = await page.request.post("/api/plans", {
    data: { name: "Allocation exercise" },
  })
  expect(response.status()).toBe(201)
  const plan: Plan = await response.json()
  const path = `/api/plans/${plan.id}`
  const saved = await page.request.put(path, {
    data: {
      ...plan,
      networks: [
        { id: "cell", name: "Cell LAN", subnet: null, position: null },
      ],
      components: [
        {
          id: "plc",
          name: "Filler PLC",
          type: "PLC",
          hostId: null,
          position: null,
        },
      ],
      interfaces: [
        {
          id: "plc-a",
          componentId: "plc",
          name: "LAN A",
          networkId: "cell",
          ipv4: "192.168.1.20",
        },
        {
          id: "plc-b",
          componentId: "plc",
          name: "LAN B",
          networkId: "cell",
          ipv4: null,
        },
        {
          id: "plc-c",
          componentId: "plc",
          name: "LAN C",
          networkId: "cell",
          ipv4: null,
        },
        {
          id: "plc-d",
          componentId: "plc",
          name: "LAN D",
          networkId: "cell",
          ipv4: null,
        },
      ],
    } satisfies Plan,
  })
  expect(saved.ok()).toBe(true)
  await page.goto(`/?plan=${plan.id}`)
  return path
}

test("a saved pool skips assigned, reserved, and excluded IPv4 addresses", async ({
  page,
}) => {
  const path = await openAllocationPlan(page)
  await page.getByRole("button", { name: "Table", exact: true }).click()
  const suggest = page.getByRole("button", {
    name: "Suggest IPv4 address for Filler PLC / LAN B",
  })
  await expect(suggest).toHaveCount(0)

  await page.getByRole("button", { name: "Edit network Cell LAN" }).click()
  const network = page.getByRole("dialog", { name: "Edit network" })
  await network.getByLabel("IPv4 subnet").fill("192.168.1.0/24")
  await network.getByText("Allocation pool and exclusions").click()
  await network.getByLabel("Pool start").fill("192.168.1.20", { timeout: 5000 })
  await network.getByLabel("Pool end").fill("192.168.1.40")
  await network
    .getByLabel("Excluded addresses and ranges")
    .fill("192.168.1.21\n192.168.1.22 - 192.168.1.29")
  await network.getByRole("button", { name: "Save network" }).click()
  await expect(network).toBeHidden()

  const address = page.getByLabel("IPv4 address for Filler PLC / LAN B", {
    exact: true,
  })
  await suggest.click()
  const suggestion = page.getByRole("dialog", { name: "Suggest IPv4 address" })
  await suggestion.getByRole("button", { name: "Preview suggestion" }).click()
  await expect(
    suggestion.getByText("192.168.1.30", { exact: true })
  ).toBeVisible()
  const saved: Plan = await (await page.request.get(path)).json()
  expect(saved.interfaces.find((port) => port.id === "plc-b")?.ipv4).toBeNull()
  await suggestion.getByRole("button", { name: "Accept suggestion" }).click()
  await expect(suggestion).toBeHidden()
  await expect(address).toHaveValue("192.168.1.30")

  await page.reload()
  await page.getByRole("button", { name: "Table", exact: true }).click()
  await expect(address).toHaveValue("192.168.1.30")
  await expect(
    page.getByLabel("IPv4 address for Filler PLC / LAN A", { exact: true })
  ).toHaveValue("192.168.1.20")
})

test("batch assignment shows exhaustion and requires confirmation of a refreshed preview", async ({
  page,
  request,
}) => {
  const path = await openAllocationPlan(page)
  const plan: Plan = await (await page.request.get(path)).json()
  const [network] = plan.networks
  const configured = await page.request.put(path, {
    data: {
      ...plan,
      networks: [
        {
          ...network,
          subnet: "192.168.1.0/24",
          allocationPool: { start: "192.168.1.30", end: "192.168.1.31" },
        },
      ],
    } satisfies Plan,
  })
  expect(configured.ok()).toBe(true)
  await page.reload()
  await page.getByRole("button", { name: "Table", exact: true }).click()
  await page
    .getByRole("button", { name: "Auto-assign IPv4", exact: true })
    .click()
  const dialog = page.getByRole("dialog", {
    name: "Auto-assign IPv4 addresses",
  })
  const checkbox = (port: string) =>
    dialog.getByRole("checkbox", { name: `Filler PLC / ${port} · Cell LAN` })
  const preview = dialog.getByRole("button", { name: "Preview assignment" })
  const confirm = dialog.getByRole("button", { name: "Assign addresses" })

  await expect(checkbox("LAN A")).toHaveCount(0)
  await checkbox("LAN B").check()
  await checkbox("LAN C").check()
  await checkbox("LAN D").check()
  await preview.click()
  await expect(
    dialog.getByText(
      "The allocation pool cannot satisfy the selected interfaces."
    )
  ).toBeVisible()
  await expect(dialog.getByText("No available address")).toBeVisible()
  await expect(confirm).toBeDisabled()

  await dialog.getByRole("button", { name: "Change selection" }).click()
  await checkbox("LAN D").uncheck()
  await preview.click()
  await expect(dialog.getByText("192.168.1.30", { exact: true })).toBeVisible()
  await expect(dialog.getByText("192.168.1.31", { exact: true })).toBeVisible()

  const session = await request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
  })
  expect(session.ok()).toBe(true)
  const saved: Plan = await configured.json()
  const competingSave = await request.put(path, {
    data: {
      ...saved,
      networks: saved.networks.map((network) => ({
        ...network,
        allocationPool: { start: "192.168.1.30", end: "192.168.1.32" },
      })),
      interfaces: saved.interfaces.map((port) =>
        port.id === "plc-d" ? { ...port, ipv4: "192.168.1.30" } : port
      ),
    } satisfies Plan,
  })
  expect(competingSave.ok()).toBe(true)

  await confirm.click()
  await expect(
    dialog.getByText(
      "The plan changed. Review the refreshed preview before confirming."
    )
  ).toBeVisible()
  await expect(dialog.getByText("192.168.1.31", { exact: true })).toBeVisible()
  await expect(dialog.getByText("192.168.1.32", { exact: true })).toBeVisible()
  const afterConflict: Plan = await (await page.request.get(path)).json()
  expect(afterConflict.interfaces.map(({ ipv4 }) => ipv4)).toEqual([
    "192.168.1.20",
    null,
    null,
    "192.168.1.30",
  ])

  await confirm.click()
  await expect(dialog).toBeHidden()
  await expect(
    page.getByLabel("IPv4 address for Filler PLC / LAN A")
  ).toHaveValue("192.168.1.20")
  await expect(
    page.getByLabel("IPv4 address for Filler PLC / LAN B")
  ).toHaveValue("192.168.1.31")
  await expect(
    page.getByLabel("IPv4 address for Filler PLC / LAN C")
  ).toHaveValue("192.168.1.32")
  await expect(
    page.getByLabel("IPv4 address for Filler PLC / LAN D")
  ).toHaveValue("192.168.1.30")
})
