import { expect, test, type Page } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase } from "./workspace-settings"

const plc = {
  id: "plc",
  name: "Packaging PLC",
  type: "PLC",
  position: { x: 24, y: 80 },
  hostId: null,
}
const hmi = {
  id: "hmi",
  name: "Operator HMI",
  type: "HMI",
  position: { x: 248, y: 80 },
  hostId: null,
}
const port = {
  id: "plc-lan",
  componentId: plc.id,
  name: "LAN",
  networkId: null,
  ipv4: "192.0.2.18",
}
const link = {
  id: "cable",
  source: { componentId: plc.id, interfaceId: port.id },
  target: { componentId: hmi.id, interfaceId: null },
  medium: "wired",
  protocol: "EtherNet/IP",
}

async function openPlan(page: Page) {
  const session = await page.request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
  })
  expect(session.ok()).toBe(true)
  const created = await page.request.post("/api/plans", {
    data: { name: "Packaging cell" },
  })
  expect(created.status()).toBe(201)
  const plan: Plan = await created.json()
  const path = `/api/plans/${plan.id}`
  const saved = await page.request.put(path, {
    data: {
      ...plan,
      components: [plc, hmi],
      interfaces: [port],
      links: [link],
    },
  })
  expect(saved.ok()).toBe(true)
  await page.goto(`/?plan=${plan.id}`)
  return path
}

test("choose a built-in symbol while keeping the component name, interface, and link", async ({
  page,
}) => {
  const path = await openPlan(page)
  const node = page.getByRole("button", { name: plc.name, exact: true })
  await node.click()
  const editor = page.getByRole("dialog", { name: plc.name })
  await editor.getByLabel("Representation").selectOption("builtIn")
  await editor.getByLabel("Built-in symbol").selectOption("router")
  await editor.getByRole("button", { name: "Save component" }).click()
  await expect(editor).toBeHidden()

  await page.reload()
  await expect(node.getByText(plc.name, { exact: true })).toBeVisible()
  await expect(node.getByRole("img", { name: "Router symbol" })).toBeVisible()
  const response = await page.request.get(path)
  expect(response.ok()).toBe(true)
  const saved: Plan = await response.json()
  expect(saved.components[0]).toEqual({
    ...plc,
    appearance: { kind: "builtIn", symbol: "router" },
  })
  expect(saved.interfaces).toEqual([port])
  expect(saved.links).toEqual([{ ...link, lineType: "elbow" }])
})

test("import an icon and reopen its named component as a visitor", async ({
  page,
}) => {
  const path = await openPlan(page)
  const node = page.getByRole("button", { name: hmi.name, exact: true })
  await node.click()
  const editor = page.getByRole("dialog", { name: hmi.name })
  await editor.getByLabel("Representation").selectOption("custom")
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="
  await editor.getByLabel("Custom icon").setInputFiles({
    name: "operator-panel.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  })
  await editor.getByRole("button", { name: "Save component" }).click()
  await expect(editor).toBeHidden()

  await page.getByRole("button", { name: "Sign out" }).click()
  await page.reload()
  await expect(node.getByText(hmi.name, { exact: true })).toBeVisible()
  const icon = node.getByRole("img", { name: "Custom icon" })
  await expect(icon).toBeVisible()
  await expect
    .poll(() => icon.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1)

  const response = await page.request.get(path)
  expect(response.ok()).toBe(true)
  const saved: Plan = await response.json()
  expect(saved.components[1]).toEqual({
    ...hmi,
    appearance: {
      kind: "custom",
      imageData: `data:image/png;base64,${base64}`,
    },
  })
})

test("save a labeled shape and reopen its name, label, and settings", async ({
  page,
}) => {
  await openPlan(page)
  const node = page.getByRole("button", { name: plc.name, exact: true })
  const editor = page.getByRole("dialog", { name: plc.name })
  await node.click()
  await editor.getByLabel("Representation").selectOption("shape")
  await editor.getByLabel("Shape", { exact: true }).selectOption("diamond")
  await editor.getByLabel("Shape label").fill("Safety zone A")
  await editor.getByRole("button", { name: "Save component" }).click()
  await expect(editor).toBeHidden()

  await page.reload()
  await expect(node.getByRole("img", { name: "Diamond shape" })).toBeVisible()
  await expect(node.getByText(plc.name, { exact: true })).toBeVisible()
  await expect(node.getByText("Safety zone A", { exact: true })).toBeVisible()
  await node.click()
  await expect(editor.getByLabel("Shape", { exact: true })).toHaveValue(
    "diamond"
  )
  await expect(editor.getByLabel("Shape label")).toHaveValue("Safety zone A")
  await editor.getByRole("button", { name: "Cancel" }).click()
  await page.getByRole("button", { name: "Sign out" }).click()
  await page.reload()

  await expect(node.getByRole("img", { name: "Diamond shape" })).toBeVisible()
  await expect(node.getByText(plc.name, { exact: true })).toBeVisible()
  await expect(node.getByText("Safety zone A", { exact: true })).toBeVisible()
  await node.click()
  await expect(editor.getByText("192.0.2.18")).toBeVisible()
})

test("create industrial library components and reopen their symbols", async ({
  page,
}) => {
  const path = await openPlan(page)
  await page.getByRole("button", { name: "Component library" }).click()
  const library = page.getByRole("complementary", { name: "Component library" })
  const types = [
    "VFD",
    "Servo drive",
    "IO-Link master",
    "IO-Link I/O hub",
    "IO-Link device",
    "Remote I/O station",
    "Safety PLC",
    "Protocol gateway",
    "Vision camera",
    "Barcode reader",
  ]
  for (const type of types) {
    await library.getByRole("button", { name: type, exact: true }).click()
    const editor = page.getByRole("dialog")
    await expect(editor.getByLabel("Component type")).toHaveValue(type)
    await editor.getByLabel("Component name").fill(type + " 1")
    await editor.getByLabel("Representation").selectOption("builtIn")
    await expect(
      editor.getByLabel("Built-in symbol").locator("option:checked")
    ).toHaveText(type)
    await editor.getByRole("button", { name: "Save component" }).click()
    await expect(editor).toBeHidden()
  }
  await page.reload()
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  for (const type of types) {
    await expect(
      canvas
        .getByRole("button", { name: type + " 1", exact: true })
        .getByRole("img", { name: type + " symbol" })
    ).toBeVisible()
  }
  const saved: Plan = await (await page.request.get(path)).json()
  expect(saved.interfaces).toEqual([port])
})
