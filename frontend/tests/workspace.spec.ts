import { expect, test, type Page, type Locator } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import {
  editorPassword,
  signOut,
  unlockEditing,
  workspaceAction,
} from "./workspace-settings"

test("switch views while loading and browse the empty plan", async ({
  page,
  playwright,
  baseURL,
}) => {
  const visitor = await playwright.request.newContext({
    baseURL,
  })
  const session = await visitor.post("/api/editor-session", {
    data: { password: editorPassword },
  })
  expect(session.ok()).toBe(true)
  const created = await visitor.post("/api/plans", {
    data: { name: "Empty plan" },
  })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  await visitor.dispose()

  let release!: () => void
  const loading = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/plans", async (route) => {
    await loading
    await route.continue()
  })
  await page.goto(`/?plan=${id}`)
  try {
    await expect(page.getByText("Loading plan…")).toBeVisible()
    await page.getByRole("button", { name: "Table" }).click()
    await expect(
      page.getByRole("button", { name: "Table", pressed: true })
    ).toBeVisible()
  } finally {
    release()
  }
  await expect(
    page.getByRole("heading", { name: "No interfaces yet" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Diagram" }).click()
  await expect(
    page.getByRole("heading", { name: "No components yet" })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

test("create the first plan from either empty view", async ({ page }, info) => {
  await page.route("**/api/plans", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: [] })
      : route.continue()
  )
  await page.goto("/")

  const toolbar = page.getByRole("banner")
  const viewMode = toolbar.getByRole("button", { name: "View mode" })
  await expect(viewMode).toBeVisible()
  const diagram = page.getByRole("region", { name: "Diagram", exact: true })
  await expect(
    diagram.getByRole("heading", { name: "No plans yet" })
  ).toBeVisible()
  await diagram.getByRole("button", { name: "Create plan" }).click()
  const unlock = page.getByRole("dialog", { name: "Unlock editing" })
  await unlock.getByRole("button", { name: "Cancel" }).click()
  await expect(viewMode).toBeVisible()

  await page.getByRole("button", { name: "Table", exact: true }).click()
  const table = page.getByRole("region", { name: "Table", exact: true })
  await expect(
    table.getByRole("heading", { name: "No plans yet" })
  ).toBeVisible()
  const createButton = table.getByRole("button", { name: "Create plan" })
  await createButton.click()
  await unlock.getByLabel("Shared editor password").fill(editorPassword)
  await unlock.getByRole("button", { name: "Unlock editing" }).click()
  const create = page.getByRole("dialog", { name: "New plan" })
  await create.getByRole("button", { name: "Cancel" }).click()
  await expect(toolbar.getByRole("button", { name: "Edit mode" })).toBeVisible()
  await createButton.click()
  const name = `First plan ${info.project.name}`
  await create.getByLabel("Plan name").fill(name)
  await create.getByRole("button", { name: "Create plan" }).click()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await expect(
    table.getByRole("heading", { name: "No interfaces yet" })
  ).toBeVisible()
  await expect(createButton).toHaveCount(0)
})

test("create a named plan and reopen it after signing out", async ({
  page,
}, info) => {
  const name = `Packaging ${info.project.name}`
  await page.goto("/")
  await unlockEditing(page)
  await workspaceAction(page, "New plan")
  const create = page.getByRole("dialog", { name: "New plan" })
  await create.getByLabel("Plan name").fill(name)
  await create.getByRole("button", { name: "Create plan" }).click()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await signOut(page)
  await expect(page.getByRole("button", { name: "New plan" })).toBeHidden()
  await page.reload()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
})

test("manage named networks in the open plan", async ({ page }, info) => {
  const opened = await createUnlockedPlan(
    page,
    `Network inventory ${info.project.name}`
  )
  await page.goto(`/?plan=${opened.id}`)
  await createNetwork(page, "Plant")
  const created: Plan = await (
    await page.request.get(`/api/plans/${opened.id}`)
  ).json()
  expect(created.networks[0].color).toMatch(/^#[0-9a-f]{6}$/)
  await page
    .getByRole("button", { name: "Edit network Plant", exact: true })
    .click()
  const network = page.getByRole("dialog", { name: "Edit network" })
  await network
    .getByLabel("Network type")
    .selectOption({ label: "Fiber optic" })
  await network.getByLabel("Network name").fill("Plant Backbone")
  await network.getByLabel("Network color").fill("#123456")
  await network.getByRole("button", { name: "Save network" }).click()
  await expect(
    page.getByRole("button", { name: "Edit network Plant Backbone" })
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("button", { name: "Plant Backbone", exact: true })
  ).toContainText("Fiber optic")
  await expect(
    page.getByRole("button", { name: "Edit network Plant Backbone" })
  ).toBeVisible()
  await expect(
    page.getByRole("listitem").filter({
      has: page.getByRole("button", { name: "Plant Backbone", exact: true }),
    })
  ).toHaveCSS("border-left-color", "rgb(18, 52, 86)")
  const exported = await page.request.get(`/api/plans/${opened.id}/package`)
  expect(exported.ok()).toBe(true)
  const imported = await page.request.post("/api/plans/import", {
    data: await exported.json(),
  })
  expect(imported.status()).toBe(201)
  const copy: Plan = await imported.json()
  expect(copy.id).not.toBe(opened.id)
  expect(copy.networks[0].color).toBe("#123456")
})

test("read import and export guidance in either view without unlocking editing", async ({
  page,
}) => {
  await page.goto("/")
  const help = page.getByRole("dialog", { name: "Import/export help" })
  for (const view of ["Diagram", "Table"]) {
    await page.getByRole("button", { name: view, exact: true }).click()
    await workspaceAction(page, "Import/export help")
    await expect(help).toBeVisible()
    await expect(help.getByText(/Blank cells preserve/)).toBeVisible()
    await expect(help.getByText(/Duplicate IPv4 addresses/)).toBeVisible()
    await expect(help.getByText(/independent copy/)).toBeVisible()
    await expect(
      help.getByRole("heading", { name: "PDF", exact: true })
    ).toBeVisible()
    await help.getByRole("button", { name: "Close", exact: true }).click()
    await expect(help).toBeHidden()
  }
})

async function createUnlockedPlan(page: Page, name: string) {
  const session = await page.request.post("/api/editor-session", {
    data: { password: editorPassword },
  })
  expect(session.ok()).toBe(true)
  const created = await page.request.post("/api/plans", { data: { name } })
  expect(created.status()).toBe(201)
  return created.json()
}

async function createNetwork(page: Page, name: string) {
  await page.getByRole("button", { name: "Add network" }).click()
  const network = page.getByRole("dialog", { name: "Add network" })
  await network.getByLabel("Network name").fill(name)
  await network.getByRole("button", { name: "Save network" }).click()
  await expect(network).toBeHidden()
}

test("edit server and VM interfaces through one editor and inspect them after signing out", async ({
  page,
}, info) => {
  const opened = await createUnlockedPlan(
    page,
    `Editor workshop ${info.project.name}`
  )
  await page.goto(`/?plan=${opened.id}`)
  await createNetwork(page, "Plant")
  await createNetwork(page, "Controls")

  const addComponent = async (name: string, type: string) => {
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await page
      .getByRole("menuitem", { name: "Add component", exact: true })
      .click()
    const editor = page.getByRole("dialog", { name: "Add component" })
    await editor.getByLabel("Component name").fill(name)
    await editor.getByLabel("Component type").fill(type)
    return editor
  }
  const saveComponent = async (editor: Locator) => {
    await editor.getByRole("button", { name: "Save component" }).click()
    await expect(editor).toBeHidden()
  }
  const addInterface = async (
    editor: Locator,
    name: string,
    network: string,
    ip?: string
  ) => {
    await editor
      .getByRole("button", { name: "Add interface", exact: true })
      .click()
    const port = editor.getByRole("group", {
      name: "New interface",
      exact: true,
    })
    await port.getByLabel("Network").selectOption({ label: network })
    if (ip) await port.getByLabel("IPv4 address").fill(ip)
    await port.getByLabel("Interface name").fill(name)
  }

  const host = await addComponent("Server A", "Server")
  await addInterface(host, "eth0", "Plant", "10.50.0.12")
  await addInterface(host, "eth1", "Controls", "10.51.0.12")
  await saveComponent(host)
  await saveComponent(await addComponent("Server B", "Server"))
  const switchEditor = await addComponent("Main switch", "Switch")
  await addInterface(switchEditor, "Port 1", "Plant")
  await saveComponent(switchEditor)
  let vm = await addComponent("Runtime", "VM")
  await vm.getByLabel("Hosted on").selectOption({ label: "Server A" })
  await addInterface(vm, "Adapter", "Plant", "10.50.0.34")
  await saveComponent(vm)

  const diagram = page.getByRole("region", { name: "Diagram", exact: true })
  await diagram.getByRole("button", { name: "Server A", exact: true }).click()
  const server = page.getByRole("dialog", { name: "Server A" })
  await expect(server.getByText("Runtime", { exact: true })).toBeVisible()
  await expect(
    server.getByRole("group", { name: "eth1" }).getByLabel("IPv4 address")
  ).toHaveValue("10.51.0.12")
  await server.getByRole("button", { name: "Cancel" }).click()

  await page
    .getByRole("button", { name: "Edit network Plant", exact: true })
    .click()
  const network = page.getByRole("dialog", { name: "Edit network" })
  await network.getByLabel("Network name").fill("Plant Backbone")
  await network.getByRole("button", { name: "Save network" }).click()

  await page.getByRole("button", { name: "Table", exact: true }).click()
  const table = page.getByRole("region", { name: "Table", exact: true })
  await table.getByRole("button", { name: "Runtime", exact: true }).click()
  vm = page.getByRole("dialog", { name: "Runtime" })
  await expect(vm.getByLabel("IPv4 address")).toHaveValue("10.50.0.34")
  await expect(vm.getByLabel("Network").locator("option:checked")).toHaveText(
    "Plant Backbone"
  )
  await vm.getByLabel("Hosted on").selectOption({ label: "Server B" })
  await vm.getByLabel("IPv4 address").fill("10.50.0.35")
  await saveComponent(vm)

  await signOut(page)
  await page.reload()
  await diagram.getByRole("button", { name: "Runtime", exact: true }).click()
  await expect(vm.getByText("Server B", { exact: true })).toBeVisible()
  await expect(vm.getByText("Plant Backbone", { exact: true })).toBeVisible()
  await expect(vm.getByText("10.50.0.35", { exact: true })).toBeVisible()
  await expect(vm.getByRole("button", { name: "Save component" })).toBeHidden()
  const bounds = await vm.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width
  )
  await vm.getByRole("button", { name: "Close" }).click()
  await diagram
    .getByRole("button", { name: "Main switch", exact: true })
    .click()
  await expect(
    page.getByRole("dialog", { name: "Main switch" }).getByText("Unassigned")
  ).toBeVisible()
})
