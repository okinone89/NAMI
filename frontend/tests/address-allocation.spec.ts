import { expect, test, type Page } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassword, expectReadOnly } from "./workspace-settings"

async function openAllocationPlan(page: Page, subnet: string | null = null) {
  const session = await page.request.post("/api/editor-session", {
    data: { password: editorPassword },
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
      networks: [{ id: "cell", name: "Cell LAN", subnet, position: null }],
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
  await network.getByLabel("IPv4 network address").fill("192.168.1.0")
  await network.getByLabel("Subnet mask").fill("255.255.255.192")
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

test("suggest an IPv4 address for a draft interface without saving the component", async ({
  page,
}) => {
  const path = await openAllocationPlan(page, "192.168.1.0/24")
  await page.getByRole("button", { name: "Filler PLC", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Filler PLC" })
  await editor
    .getByRole("group", { name: "LAN B" })
    .getByLabel("IPv4 address")
    .fill("192.168.1.1")
  await editor.getByRole("button", { name: "Add interface" }).click()
  const port = editor.getByRole("group", { name: "New interface" })
  await port.getByLabel("Network", { exact: true }).selectOption("cell")
  const name = port.getByLabel("Interface name")
  expect(
    await port
      .getByLabel("Network", { exact: true })
      .evaluate((select) => select.getBoundingClientRect().height)
  ).toBe(await name.evaluate((input) => input.getBoundingClientRect().height))
  await port.getByRole("button", { name: "Suggest IPv4" }).click()
  const suggestion = page.getByRole("dialog", { name: "Suggest IPv4 address" })
  await expect(
    suggestion.getByText("192.168.1.2", { exact: true })
  ).toBeVisible()
  await suggestion.getByRole("button", { name: "Accept suggestion" }).click()
  await expect(port.getByLabel("IPv4 address")).toHaveValue("192.168.1.2")
  const before: Plan = await (await page.request.get(path)).json()
  expect(before.interfaces).toHaveLength(4)
  expect(before.interfaces.find(({ id }) => id === "plc-b")?.ipv4).toBeNull()
  await name.fill("LAN E")
  await editor.getByRole("button", { name: "Save component" }).click()
  await expect(editor).toBeHidden()
  const after: Plan = await (await page.request.get(path)).json()
  expect(after.interfaces.find((item) => item.name === "LAN E")?.ipv4).toBe(
    "192.168.1.2"
  )
})

test("automatic assignment is shared across views and saves blank after pool exhaustion", async ({
  page,
}) => {
  const path = await openAllocationPlan(page, "192.168.1.0/24")
  const plan: Plan = await (await page.request.get(path)).json()
  const [network] = plan.networks
  const configured = await page.request.put(path, {
    data: {
      ...plan,
      networks: [
        {
          ...network,
          allocationPool: { start: "192.168.1.20", end: "192.168.1.24" },
          excludedIpv4Ranges: [{ start: "192.168.1.21" }],
        },
      ],
      interfaces: [
        ...plan.interfaces.map((port) =>
          port.id === "plc-d" ? { ...port, networkId: null } : port
        ),
        {
          id: "plc-e",
          componentId: "plc",
          name: "LAN E",
          networkId: null,
          ipv4: null,
        },
      ],
    } satisfies Plan,
  })
  expect(configured.ok()).toBe(true)
  await page.reload()
  const automatic = page.getByRole("checkbox", {
    name: "Automatic IP assignment",
  })
  await expect(automatic).not.toBeChecked()
  await automatic.check()
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await page.getByRole("menuitem", { name: "Add component" }).click()

  async function saveComponent(name: string, manualAddress?: string) {
    const editor = page.getByRole("dialog", { name: "Add component" })
    await editor.getByLabel("Component name").fill(name)
    await editor.getByLabel("Component type").fill("PLC")
    for (const [portName, address] of [
      ["LAN A", ""],
      ["LAN B", manualAddress],
    ] as const) {
      if (address === undefined) continue
      await editor.getByRole("button", { name: "Add interface" }).click()
      const port = editor.getByRole("group", { name: "New interface" })
      await port.getByLabel("Network", { exact: true }).selectOption("cell")
      if (address) await port.getByLabel("IPv4 address").fill(address)
      await port.getByLabel("Interface name").fill(portName)
    }
    await editor.getByRole("button", { name: "Save component" }).click()
    await expect(editor).toBeHidden()
  }

  await saveComponent("New PLC", "192.168.1.50")
  await expect(page.getByText("192.168.1.22/24", { exact: true })).toBeVisible()
  await expect(page.getByText("192.168.1.50/24", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Table", exact: true }).click()
  await expect(automatic).toBeChecked()
  await expect(
    page.getByLabel("IPv4 address for Filler PLC / LAN B", { exact: true })
  ).toHaveValue("")
  await page
    .getByRole("combobox", { name: "Network for Filler PLC / LAN D" })
    .selectOption("cell")
  await page.getByRole("button", { name: "Save interface" }).click()
  await expect(
    page.getByLabel("IPv4 address for Filler PLC / LAN D", { exact: true })
  ).toHaveValue("192.168.1.23")

  const bulkAddress = page.getByLabel("IPv4 address for Filler PLC / LAN E", {
    exact: true,
  })
  await page
    .getByRole("checkbox", { name: "Select Filler PLC / LAN E" })
    .check()
  await page.getByRole("button", { name: "Edit selected interfaces" }).click()
  const bulk = page.getByRole("dialog", { name: "Bulk edit interfaces" })
  await bulk
    .getByLabel("Network membership")
    .selectOption({ label: "Cell LAN" })
  await bulk.getByRole("button", { name: "Preview changes" }).click()
  await expect(bulk.getByRole("group", { name: "After" })).toContainText(
    "192.168.1.24"
  )
  const pending: Plan = await (await page.request.get(path)).json()
  expect(pending.interfaces.find(({ id }) => id === "plc-e")?.ipv4).toBeNull()
  await bulk.getByRole("button", { name: "Apply bulk changes" }).click()
  await expect(bulkAddress).toHaveValue("192.168.1.24")

  await page.getByRole("button", { name: "Add component", exact: true }).click()
  await saveComponent("Queued PLC")
  await expect(
    page.getByText("1 interface was saved without IPv4.")
  ).toBeVisible()
  await expect(
    page.getByLabel("IPv4 address for Queued PLC / LAN A", { exact: true })
  ).toHaveValue("")
  await page.reload()
  await expect(automatic).toBeChecked()
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
    data: { password: editorPassword },
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
    page.getByRole("textbox", {
      name: "IPv4 address for Filler PLC / LAN A",
      exact: true,
    })
  ).toHaveValue("192.168.1.20")
  await expect(
    page.getByRole("textbox", {
      name: "IPv4 address for Filler PLC / LAN B",
      exact: true,
    })
  ).toHaveValue("192.168.1.31")
  await expect(
    page.getByRole("textbox", {
      name: "IPv4 address for Filler PLC / LAN C",
      exact: true,
    })
  ).toHaveValue("192.168.1.32")
  await expect(
    page.getByRole("textbox", {
      name: "IPv4 address for Filler PLC / LAN D",
      exact: true,
    })
  ).toHaveValue("192.168.1.30")
})

for (const step of ["preview", "commit"]) {
  test(`switches to read-only when the editor session expires before allocation ${step}`, async ({
    page,
  }) => {
    const path = await openAllocationPlan(page, "192.168.1.0/24")
    await page.getByRole("button", { name: "Table", exact: true }).click()
    const suggest = page.getByRole("button", {
      name: "Suggest IPv4 address for Filler PLC / LAN B",
    })
    const dialog = page.getByRole("dialog", { name: "Suggest IPv4 address" })
    const confirm = dialog.getByRole("button", { name: "Accept suggestion" })
    if (step === "commit") {
      await suggest.click()
      await expect(confirm).toBeVisible()
    }

    await page.context().clearCookies()
    await (step === "preview" ? suggest : confirm).click()
    await expect(dialog).toBeHidden()
    await expect(suggest).toHaveCount(0)
    await expectReadOnly(page)
    await expect(
      page.getByRole("heading", { name: "Allocation exercise" })
    ).toBeVisible()
    const saved: Plan = await (await page.request.get(path)).json()
    expect(saved.interfaces.find(({ id }) => id === "plc-b")?.ipv4).toBeNull()
  })
}
