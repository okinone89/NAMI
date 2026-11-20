import { expect, test, type APIRequestContext } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase, expectReadOnly } from "./workspace-settings"

type Topology = Pick<Plan, "networks" | "components" | "interfaces">

async function createPlan(request: APIRequestContext, topology: Topology) {
  const session = await request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
  })
  expect(session.ok()).toBe(true)
  const created = await request.post("/api/plans", {
    data: { name: "Packaging line topology" },
  })
  expect(created.status()).toBe(201)
  const plan: Plan = await created.json()
  const saved = await request.put(`/api/plans/${plan.id}`, {
    data: { ...plan, ...topology },
  })
  expect(saved.ok()).toBe(true)
  return plan.id
}

function createSearchPlan(request: APIRequestContext) {
  return createPlan(request, {
    networks: [
      {
        id: "a",
        name: "Filler A / Machine LAN",
        subnet: null,
        position: null,
      },
      {
        id: "b",
        name: "Filler B / Machine LAN",
        subnet: null,
        position: null,
      },
    ],
    components: [
      {
        id: "plc-a",
        name: "Filler A PLC",
        type: "PLC",
        hostId: null,
        position: { x: 28, y: 140 },
      },
      {
        id: "plc-b",
        name: "Filler B PLC",
        type: "PLC",
        hostId: null,
        position: { x: 470, y: 780 },
      },
      {
        id: "switch-b",
        name: "Filler B Switch",
        type: "Switch",
        hostId: null,
        position: { x: 40, y: 780 },
      },
    ],
    interfaces: [
      {
        id: "ip-a",
        componentId: "plc-a",
        name: "Ethernet",
        networkId: "a",
        ipv4: "192.168.1.10",
      },
      {
        id: "ip-b",
        componentId: "plc-b",
        name: "Ethernet",
        networkId: "b",
        ipv4: "192.168.1.10",
      },
      {
        id: "port-b",
        componentId: "switch-b",
        name: "Port 1",
        networkId: "b",
        ipv4: null,
      },
    ],
  })
}

test("an anonymous visitor finds both isolated PLCs by their shared IPv4 address", async ({
  page,
  request,
}) => {
  const planId = await createSearchPlan(request)
  await page.goto(`/?plan=${planId}`)
  await expectReadOnly(page)

  await page
    .getByRole("searchbox", { name: "Search plan" })
    .fill("192.168.1.10")
  const results = page.getByRole("list", { name: "Search results" })
  await expect(results.getByRole("button")).toHaveCount(2)
  await expect(
    results.getByRole("button", {
      name: /Filler A PLC.*Filler A \/ Machine LAN/,
    })
  ).toBeVisible()
  await expect(
    results.getByRole("button", {
      name: /Filler B PLC.*Filler B \/ Machine LAN/,
    })
  ).toBeVisible()
})

test("choosing a result reveals and highlights its component for anonymous inspection", async ({
  page,
  request,
}) => {
  const planId = await createSearchPlan(request)
  await page.goto(`/?plan=${planId}`)
  const search = page.getByRole("searchbox", { name: "Search plan" })
  await search.fill("192.168.1.10")
  const results = page.getByRole("list", { name: "Search results" })
  const topology = page.getByRole("region", { name: "Topology canvas" })
  const plcB = topology.getByRole("button", { name: "Filler B PLC" })
  const switchB = topology.getByRole("button", { name: "Filler B Switch" })

  await expect(plcB).not.toBeInViewport()
  await results.getByRole("button", { name: /Filler B PLC/ }).click()

  await expect(
    page.getByRole("button", { name: "Filler B / Machine LAN", exact: true })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(plcB).toBeInViewport({ ratio: 0.9 })
  await expect(plcB).toHaveAttribute("aria-current", "true")
  await expect(plcB).toHaveCSS("opacity", "1")
  await expect(switchB).toBeHidden()
  await expect(
    topology.getByRole("button", { name: "Filler A PLC" })
  ).toBeHidden()

  await plcB.click()
  const inspector = page.getByRole("dialog", { name: "Filler B PLC" })
  await expect(
    inspector.getByText("192.168.1.10", { exact: true })
  ).toBeVisible()
  await expect(
    inspector.getByRole("button", { name: "Save component" })
  ).toBeHidden()
  await inspector.getByRole("button", { name: "Close" }).click()

  await results.getByRole("button", { name: /Filler A PLC/ }).click()
  await expect(
    page.getByRole("button", { name: "Filler A / Machine LAN", exact: true })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(
    topology.getByRole("button", { name: "Filler A PLC" })
  ).toHaveAttribute("aria-current", "true")

  await page
    .getByRole("button", { name: "Filler A / Machine LAN", exact: true })
    .click()
  await search.clear()
  await expect(results).toBeHidden()
  await expect(switchB).toHaveCSS("opacity", "1")
  await expect(plcB).not.toHaveAttribute("aria-current", "true")
})

test("type search finds a hosted VM outside the focused network at baseline size", async ({
  page,
  request,
}) => {
  const networks = Array.from({ length: 10 }, (_, index) => ({
    id: `cell-${index + 1}`,
    name: `Machine LAN ${index + 1}`,
    subnet: null,
    position: null,
  }))
  const components = Array.from({ length: 200 }, (_, index) => ({
    id: `device-${index}`,
    name:
      index === 180
        ? "Edge server"
        : index === 181
          ? "Reports runtime"
          : `Controller ${index + 1}`,
    type: index === 180 ? "Server" : index === 181 ? "VM" : "PLC",
    hostId: index === 181 ? "device-180" : null,
    position: {
      x: 28 + (index % 3) * 236,
      y: 320 + Math.floor(index / 3) * 120,
    },
  }))
  const interfaces = components.flatMap(({ id }, index) => {
    const network = index === 180 ? 0 : Math.floor(index / 20)
    const port = {
      id: `${id}-eth0`,
      componentId: id,
      name: "Ethernet",
      networkId: networks[network].id,
      ipv4: `10.40.${network}.${index + 1}`,
    }
    return index < 50
      ? [port, { ...port, id: `${id}-aux`, name: "Auxiliary", ipv4: null }]
      : [port]
  })
  const planId = await createPlan(request, { networks, components, interfaces })
  await page.goto(`/?plan=${planId}`)
  const picker = page.getByRole("button", {
    name: "Machine LAN 10",
    exact: true,
  })
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  await page.getByRole("button", { name: "Machine LAN 1", exact: true }).click()
  await expect(
    canvas.getByRole("button", { name: "Reports runtime" })
  ).toBeHidden()

  await page.getByRole("searchbox", { name: "Search plan" }).fill(" vm ")
  const result = page
    .getByRole("list", { name: "Search results" })
    .getByRole("button")
  await expect(result).toHaveText(/Reports runtime.*Machine LAN 10/)
  await result.click()

  await expect(picker).toHaveAttribute("aria-pressed", "true")
  const enclosure = canvas.getByRole("group", {
    name: "Edge server host enclosure",
  })
  const vm = enclosure.getByRole("button", { name: "Reports runtime" })
  await expect(vm).toBeInViewport({ ratio: 0.9 })
  await expect(vm).toHaveAttribute("aria-current", "true")
  await expect(
    enclosure.getByRole("button", { name: "Edge server" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Clear search" }).click()
  await expect(vm).not.toHaveAttribute("aria-current", "true")
  await expect(picker).toHaveAttribute("aria-pressed", "true")
})

test("moving a component in its focused network keeps the new canvas position", async ({
  page,
  request,
}) => {
  const planId = await createSearchPlan(request)
  const session = await page.request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
  })
  expect(session.ok()).toBe(true)
  await page.goto(`/?plan=${planId}`)
  await page
    .getByRole("button", { name: "Filler A / Machine LAN", exact: true })
    .click()
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  const plc = canvas.getByRole("button", { name: "Filler A PLC" })
  await plc.scrollIntoViewIfNeeded()
  const start = (await plc.boundingBox())!
  const initialTop = start.y - (await canvas.boundingBox())!.y
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/plans/${planId}`) &&
      response.request().method() === "PUT"
  )
  await page.mouse.move(start.x + 50, start.y + 30)
  await page.mouse.down()
  await page.mouse.move(start.x + 50, start.y + 100, { steps: 4 })
  await page.mouse.up()
  const response = await saved
  expect(response.ok()).toBe(true)
  const plan: Plan = await response.json()
  expect(plan.components.find(({ id }) => id === "plc-a")?.position).toEqual({
    x: 28,
    y: 210,
  })
  // Let the browser paint the refreshed snapshot after the drag preview.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  expect(
    (await plc.boundingBox())!.y - (await canvas.boundingBox())!.y
  ).toBeCloseTo(initialTop + 70)
})
