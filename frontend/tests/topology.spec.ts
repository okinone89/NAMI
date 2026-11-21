import { expect, test, type Page } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import {
  editorPassword,
  signOut,
  workspaceAction,
} from "./workspace-settings"

async function openPlan(page: Page, snapshot: Partial<Plan>) {
  const session = await page.request.post("/api/editor-session", {
    data: { password: editorPassword },
  })
  expect(session.ok()).toBe(true)
  const created = await page.request.post("/api/plans", {
    data: { name: "Topology workshop" },
  })
  expect(created.status()).toBe(201)
  const plan: Plan = await created.json()
  const saved = await page.request.put(`/api/plans/${plan.id}`, {
    data: { ...plan, ...snapshot },
  })
  await expect(saved).toBeOK()
  await page.goto(`/?plan=${plan.id}`)
  return plan.id
}

test("refine a component-only link and inspect the saved connection as a visitor", async ({
  page,
}) => {
  const planId = await openPlan(page, {
    components: [
      {
        id: "sw",
        name: "Main switch",
        type: "Switch",
        position: { x: 24, y: 96 },
        hostId: null,
      },
      {
        id: "hmi",
        name: "Line HMI",
        type: "HMI",
        position: { x: 324, y: 96 },
        hostId: null,
      },
    ],
    interfaces: [
      {
        id: "port",
        componentId: "sw",
        name: "Port 1",
        networkId: null,
        ipv4: null,
      },
    ],
  })

  await page.getByRole("button", { name: "Add", exact: true }).click()

  await page.getByRole("menuitem", { name: "Add link", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Add link" })
  await editor
    .getByRole("group", { name: "Source" })
    .getByLabel("Component")
    .selectOption("sw")
  await editor
    .getByRole("group", { name: "Target" })
    .getByLabel("Component")
    .selectOption("hmi")
  await editor.getByLabel("Medium").selectOption("fiberOptic")
  await editor.getByLabel("Protocol (optional)").fill("PROFINET")
  await editor.getByRole("button", { name: "Save link" }).click()

  await expect(editor).toBeHidden()
  const initial = await page.request.get(`/api/plans/${planId}`)
  const saved: Plan = await initial.json()
  expect(saved.links).toHaveLength(1)
  const [link] = saved.links
  expect(link.source).toEqual({ componentId: "sw", interfaceId: null })
  expect(link.protocol).toBe("PROFINET")

  await page
    .getByRole("button", { name: "Main switch to Line HMI (Fiber optic)" })
    .click()
  const inspector = page.getByRole("dialog", { name: "Link details" })
  await inspector
    .getByRole("group", { name: "Source" })
    .getByLabel("Interface")
    .selectOption("port")
  await inspector.getByLabel("Medium").selectOption("wireless")
  const protocol = inspector.getByLabel("Protocol (optional)")
  await expect(protocol).toHaveValue("PROFINET")
  await protocol.fill("Modbus TCP")
  await inspector.getByRole("button", { name: "Save link" }).click()

  await expect(inspector).toBeHidden()
  const updated = await page.request.get(`/api/plans/${planId}`)
  const changed: Plan = await updated.json()
  expect(changed.links).toEqual([
    {
      ...link,
      source: { componentId: "sw", interfaceId: "port" },
      medium: "wireless",
      protocol: "Modbus TCP",
    },
  ])

  await signOut(page)
  await page.reload()
  await page
    .getByRole("button", {
      name: "Main switch / Port 1 to Line HMI (Wireless)",
    })
    .click()
  await expect(
    inspector.getByText("Main switch / Port 1", { exact: true })
  ).toBeVisible()
  await expect(inspector.getByText("Line HMI", { exact: true })).toBeVisible()
  await expect(inspector.getByText("Wireless", { exact: true })).toBeVisible()
  await expect(inspector.getByText("Modbus TCP", { exact: true })).toBeVisible()
  await expect(
    inspector.getByRole("button", { name: "Save link" })
  ).toBeHidden()
})

test("move a component with its link attached and retain the layout after reload", async ({
  page,
}) => {
  const planId = await openPlan(page, {
    components: [
      {
        id: "plc",
        name: "Line PLC",
        type: "PLC",
        position: { x: 30, y: 72 },
        hostId: null,
      },
      {
        id: "sw",
        name: "Cabinet switch",
        type: "Switch",
        position: { x: 315, y: 72 },
        hostId: null,
      },
    ],
    links: [
      {
        id: "cable",
        source: { componentId: "plc", interfaceId: null },
        target: { componentId: "sw", interfaceId: null },
        medium: "wired",
        protocol: null,
      },
    ],
  })

  const plc = page.getByRole("button", { name: "Line PLC", exact: true })
  const cable = page.getByRole("button", {
    name: "Line PLC to Cabinet switch (Wired)",
  })
  await plc.scrollIntoViewIfNeeded()
  const initial = (await plc.boundingBox())!
  const sourceAnchor = () =>
    cable
      .locator("path[stroke='currentColor']")
      .evaluate((path: SVGPathElement) => {
        const point = path
          .getPointAtLength(0)
          .matrixTransform(path.getScreenCTM()!)
        return { x: point.x, y: point.y }
      })
  const initialAnchor = await sourceAnchor()

  await page.mouse.move(initial.x + 70, initial.y + 30)
  await page.mouse.down()
  await page.mouse.move(initial.x + 70, initial.y + 110, { steps: 6 })
  await expect
    .poll(async () => (await plc.boundingBox())!.y - initial.y)
    .toBeCloseTo(80)
  await expect
    .poll(async () => (await sourceAnchor()).y - initialAnchor.y)
    .toBeGreaterThan(30)
  const anchor = await sourceAnchor()
  const moved = (await plc.boundingBox())!
  expect(anchor.x).toBeCloseTo(moved.x + moved.width)
  expect(anchor.y).toBeGreaterThan(moved.y)
  expect(anchor.y).toBeLessThan(moved.y + moved.height)

  await page.mouse.up()
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/plans/${planId}`)
      const saved: Plan = await response.json()
      return saved.components.find(({ id }) => id === "plc")?.position
    })
    .toEqual({ x: 30, y: 152 })
  await expect(page.getByRole("dialog", { name: "Line PLC" })).toBeHidden()

  await page.reload()
  await plc.scrollIntoViewIfNeeded()
  const topology = page.getByRole("region", { name: "Topology canvas" })
  const canvas = (await topology.boundingBox())!
  const reopened = (await plc.boundingBox())!
  expect(reopened.y - canvas.y).toBeCloseTo(152)
  const reopenedAnchor = await sourceAnchor()
  expect(reopenedAnchor.x).toBeCloseTo(reopened.x + reopened.width)
})

test("place a component and manage networks in their panel", async ({
  page,
}) => {
  const planId = await openPlan(page, {})
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  await page.getByRole("button", { name: "Add", exact: true }).dragTo(canvas, {
    targetPosition: { x: 24, y: 80 },
  })
  const component = page.getByRole("dialog", { name: "Add component" })
  await component.getByLabel("Component name").fill("Packaging PLC")
  await component.getByLabel("Component type").fill("PLC")
  await component.getByRole("button", { name: "Save component" }).click()
  await expect(
    canvas.getByRole("button", { name: "Packaging PLC" })
  ).toBeVisible()

  const panel = page.getByRole("region", { name: "Networks" })
  await panel.getByRole("button", { name: "Add network" }).click()
  const network = page.getByRole("dialog", { name: "Add network" })
  await network.getByLabel("Network name").fill("Cabinet LAN")
  await network.getByRole("button", { name: "Save network" }).click()
  await expect(
    panel.getByRole("button", { name: "Cabinet LAN", exact: true })
  ).toBeVisible()

  const response = await page.request.get(`/api/plans/${planId}`)
  const saved: Plan = await response.json()
  expect(saved.components[0].position).toEqual({ x: 24, y: 80 })
  expect(saved.networks[0].position).toBeNull()

  await page.reload()
  await panel.getByRole("button", { name: "Edit network Cabinet LAN" }).click()
  const rename = page.getByRole("dialog", { name: "Edit network" })
  await rename.getByLabel("Network name").fill("Controls LAN")
  await rename.getByRole("button", { name: "Save network" }).click()
  await expect(
    panel.getByRole("button", { name: "Controls LAN", exact: true })
  ).toBeVisible()
})

test("placing a component clears filters without moving the viewport", async ({
  page,
}) => {
  const planId = await openPlan(page, {
    networks: [
      { id: "existing", name: "Existing LAN", subnet: null, position: null },
    ],
    components: [
      {
        id: "plc",
        name: "Existing PLC",
        type: "PLC",
        position: { x: 900, y: 620 },
        hostId: null,
      },
    ],
    interfaces: [
      {
        id: "port",
        componentId: "plc",
        name: "Ethernet",
        networkId: "existing",
        ipv4: null,
      },
    ],
  })
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  const existing = page.getByRole("button", {
    name: "Existing LAN",
    exact: true,
  })
  await existing.click()
  const search = page.getByRole("searchbox", { name: "Search plan" })
  await search.fill("Existing PLC")
  await page.getByRole("button", { name: "Zoom in" }).click()
  await canvas.scrollIntoViewIfNeeded()
  const readPan = () =>
    canvas.evaluate((element) => ({
      x: element.scrollLeft,
      y: element.scrollTop,
    }))
  await canvas.evaluate((element) => element.scrollTo(300, 240))
  const pan = await readPan()
  expect(pan).toEqual({ x: 300, y: 240 })

  await page.getByRole("button", { name: "Add", exact: true }).dragTo(canvas, {
    targetPosition: { x: 80, y: 80 },
  })
  const component = page.getByRole("dialog", { name: "Add component" })
  await component.getByLabel("Component name").fill("Unassigned PLC")
  await component.getByLabel("Component type").fill("PLC")
  await component.getByRole("button", { name: "Save component" }).click()
  await expect(component).toBeHidden()
  await expect(
    canvas.getByRole("button", { name: "Unassigned PLC" })
  ).toBeInViewport()
  await expect(existing).toHaveAttribute("aria-pressed", "false")
  await expect(search).toHaveValue("")
  await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveText(
    "125%"
  )
  expect(await readPan()).toEqual(pan)
  const saved: Plan = await (
    await page.request.get("/api/plans/" + planId)
  ).json()
  expect(
    saved.components.find(({ name }) => name === "Unassigned PLC")?.position
  ).toEqual({ x: 304, y: 256 })
})

test("moving a component at the canvas edge preserves the viewport", async ({
  page,
}) => {
  const planId = await openPlan(page, {
    components: [
      {
        id: "plc",
        name: "Edge PLC",
        type: "PLC",
        position: { x: 900, y: 620 },
        hostId: null,
      },
    ],
  })
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  const plc = canvas.getByRole("button", { name: "Edge PLC" })
  await page.getByRole("button", { name: "Zoom in" }).click()
  await canvas.scrollIntoViewIfNeeded()
  const readPan = () =>
    canvas.evaluate((element) => ({
      x: element.scrollLeft,
      y: element.scrollTop,
    }))
  await canvas.evaluate((element) =>
    element.scrollTo(element.scrollWidth, element.scrollHeight)
  )
  const pan = await readPan()
  expect(pan.x).toBeGreaterThan(0)
  expect(pan.y).toBeGreaterThan(0)
  const start = (await plc.boundingBox())!
  const x = start.x + start.width / 2
  const y = start.y + start.height / 2
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/plans/${planId}`) &&
      response.request().method() === "PUT"
  )
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 60, y - 60, { steps: 4 })
  const previewPan = await readPan()
  await page.mouse.up()

  const response = await saved
  expect(response.ok()).toBe(true)
  const plan: Plan = await response.json()
  expect(plan.components[0].position).toEqual({ x: 852, y: 572 })
  expect(previewPan).toEqual(pan)
  // Let the browser paint the refreshed snapshot after the drag preview.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveText(
    "125%"
  )
  expect((await plc.boundingBox())!.x).toBeCloseTo(start.x - 60)
  expect(await readPan()).toEqual(pan)
})

test("enclose guests with their host and distinguish selectable virtual, wired, and wireless links", async ({
  page,
}) => {
  await openPlan(page, {
    components: [
      {
        id: "host",
        name: "Edge server",
        type: "Server",
        position: { x: 136, y: 90 },
        hostId: null,
      },
      {
        id: "vm1",
        name: "Runtime VM",
        type: "VM",
        position: null,
        hostId: "host",
      },
      {
        id: "vm2",
        name: "Historian VM",
        type: "VM",
        position: null,
        hostId: "host",
      },
      {
        id: "sw",
        name: "Cell switch",
        type: "Switch",
        position: { x: 450, y: 90 },
        hostId: null,
      },
      {
        id: "hmi",
        name: "Operator HMI",
        type: "HMI",
        position: { x: 450, y: 242 },
        hostId: null,
      },
    ],
    links: [
      {
        id: "v1",
        source: { componentId: "host", interfaceId: null },
        target: { componentId: "vm1", interfaceId: null },
        medium: "virtual",
        protocol: null,
      },
      {
        id: "v2",
        source: { componentId: "host", interfaceId: null },
        target: { componentId: "vm2", interfaceId: null },
        medium: "virtual",
        protocol: null,
      },
      {
        id: "w1",
        source: { componentId: "host", interfaceId: null },
        target: { componentId: "sw", interfaceId: null },
        medium: "wired",
        protocol: null,
      },
      {
        id: "w2",
        source: { componentId: "sw", interfaceId: null },
        target: { componentId: "hmi", interfaceId: null },
        medium: "wireless",
        protocol: null,
      },
    ],
  })
  await signOut(page)
  const enclosure = page.getByRole("group", {
    name: "Edge server host enclosure",
  })
  for (const name of ["Edge server", "Runtime VM", "Historian VM"]) {
    await expect(enclosure.getByRole("button", { name })).toBeVisible()
  }
  const virtualA = page.getByRole("button", {
    name: "Edge server to Runtime VM (Virtual)",
  })
  const virtualB = page.getByRole("button", {
    name: "Edge server to Historian VM (Virtual)",
  })
  const wired = page.getByRole("button", {
    name: "Edge server to Cell switch (Wired)",
  })
  const wireless = page.getByRole("button", {
    name: "Cell switch to Operator HMI (Wireless)",
  })

  await expect(wired.locator("path[stroke='currentColor']")).toHaveCSS(
    "stroke-dasharray",
    "none"
  )
  await expect(wireless.locator("path[stroke='currentColor']")).toHaveCSS(
    "stroke-dasharray",
    "9px, 6px"
  )
  const dotted = virtualA.locator("path[stroke='currentColor']")
  await expect(dotted).toHaveCSS("stroke-dasharray", "1px, 6px")
  await expect(dotted).toHaveCSS("stroke-linecap", "round")

  const inspector = page.getByRole("dialog", { name: "Link details" })
  await virtualA.click()
  await expect(inspector.getByText("Runtime VM", { exact: true })).toBeVisible()
  await inspector.getByRole("button", { name: "Close" }).click()
  await virtualB.click()
  await expect(
    inspector.getByText("Historian VM", { exact: true })
  ).toBeVisible()
})

test("keeps unassigned guests and their links in the host network", async ({
  page,
  hasTouch,
}) => {
  await openPlan(page, {
    networks: [
      { id: "plant", name: "Plant LAN", subnet: null, position: null },
      { id: "control", name: "Control LAN", subnet: null, position: null },
    ],
    components: [
      {
        id: "host",
        name: "Edge server",
        type: "Server",
        position: null,
        hostId: null,
      },
      {
        id: "guest",
        name: "Unassigned VM",
        type: "VM",
        position: null,
        hostId: "host",
      },
      {
        id: "control-vm",
        name: "Control VM",
        type: "VM",
        position: null,
        hostId: "host",
      },
    ],
    interfaces: [
      {
        id: "mgmt",
        componentId: "host",
        name: "Management",
        networkId: "plant",
        ipv4: null,
      },
      {
        id: "vnic",
        componentId: "guest",
        name: "vNIC",
        networkId: null,
        ipv4: null,
      },
      {
        id: "control-vnic",
        componentId: "control-vm",
        name: "vNIC",
        networkId: "control",
        ipv4: null,
      },
    ],
    links: [
      {
        id: "virtual",
        source: { componentId: "host", interfaceId: null },
        target: { componentId: "guest", interfaceId: "vnic" },
        medium: "virtual",
        protocol: "Modbus TCP",
      },
    ],
  })

  await signOut(page)
  await page.getByRole("button", { name: "Plant LAN", exact: true }).click()
  const enclosure = page.getByRole("group", {
    name: "Edge server host enclosure",
  })
  await expect(
    enclosure.getByRole("button", { name: "Unassigned VM", exact: true })
  ).toBeVisible()
  await expect(
    enclosure.getByRole("button", { name: "Control VM", exact: true })
  ).toHaveCount(0)
  const virtualLink = page.getByRole("button", {
    name: "Edge server to Unassigned VM / vNIC (Virtual)",
  })
  if (hasTouch) await virtualLink.tap()
  else await virtualLink.click()
  const inspector = page.getByRole("dialog", { name: "Link details" })
  await expect(inspector.getByText("Modbus TCP", { exact: true })).toBeVisible()
  await inspector.getByRole("button", { name: "Close" }).click()

  const plant = page.getByRole("button", { name: "Plant LAN", exact: true })
  const control = page.getByRole("button", { name: "Control LAN", exact: true })
  await control.click()
  await expect(plant).toHaveAttribute("aria-pressed", "true")
  await expect(control).toHaveAttribute("aria-pressed", "true")
  await expect(
    enclosure.getByRole("button", { name: "Control VM", exact: true })
  ).toBeVisible()
  await expect(virtualLink).toBeVisible()
  await page.getByRole("button", { name: "Table", exact: true }).click()
  const table = page.getByRole("table", { name: "Interfaces" })
  await expect(
    table.getByRole("button", { name: "Edge server", exact: true })
  ).toBeVisible()
  await expect(
    table.getByRole("button", { name: "Control VM", exact: true })
  ).toBeVisible()
  await expect(
    table.getByRole("button", { name: "Unassigned VM", exact: true })
  ).toHaveCount(0)
  await page.reload()
  await expect(control).toHaveAttribute("aria-pressed", "true")
  await expect(plant).toHaveAttribute("aria-pressed", "true")
  await plant.click()
  await expect(
    enclosure.getByRole("button", { name: "Unassigned VM", exact: true })
  ).toHaveCount(0)
  await expect(virtualLink).toHaveCount(0)
})

test("rename, duplicate and connect from the canvas with confirmed network changes", async ({
  page,
}) => {
  const planId = await openPlan(page, {
    networks: ["Controls", "Safety"].map((name) => ({
      id: name,
      name,
      position: null,
      subnet: null,
    })),
    components: ["PLC", "Switch"].map((name, i) => ({
      id: name,
      name,
      type: name,
      position: { x: 30 + i * 240, y: 40 },
      hostId: null,
    })),
    interfaces: [
      {
        id: "eth",
        componentId: "PLC",
        name: "Ethernet",
        networkId: "Controls",
        ipv4: "10.0.0.1",
        protocolProfiles: { profinet: { roles: ["device"] } },
      },
      {
        id: "port",
        componentId: "Switch",
        name: "P1",
        networkId: "Safety",
        ipv4: null,
      },
    ],
  })
  const saved = async (): Promise<Plan> =>
    (await page.request.get("/api/plans/" + planId)).json()
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true })
  await workspaceAction(page, "Edit plan")
  await page.getByLabel("Plan name").fill("Packaging cell")
  await button("Save plan").click()
  await expect(
    page.getByRole("heading", { name: "Packaging cell" })
  ).toBeVisible()
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  const plc = canvas.getByRole("button", { name: "PLC", exact: true })
  const originalWidth = (await plc.boundingBox())!.width
  await button("Zoom in").click()
  expect((await plc.boundingBox())!.width).toBeCloseTo(originalWidth * 1.25)
  const slider = page.getByRole("slider", { name: "Diagram zoom" })
  await slider.press("ArrowRight")
  await expect(button("Reset zoom")).toHaveText("126%")
  await button("Reset zoom").click()
  await expect(button("Reset zoom")).toHaveText("100%")
  await plc.click({ button: "right" })
  await button("Duplicate").click()
  const duplication = page.getByRole("dialog", { name: "Duplicate component" })
  await duplication
    .getByRole("button", { name: "Duplicate", exact: true })
    .click()
  await duplication
    .getByRole("button", { name: "Keep conflicts flagged" })
    .click()
  const copy = canvas.getByRole("button", { name: "PLC_1", exact: true })
  await expect(copy).toBeVisible()
  const snapshot = await saved()
  const copyPort = snapshot.interfaces.find(
    (p) =>
      p.componentId === snapshot.components.find((c) => c.name === "PLC_1")?.id
  )
  expect(copyPort).toMatchObject({
    networkId: "Controls",
    ipv4: "10.0.0.1",
    protocolProfiles: snapshot.interfaces[0].protocolProfiles,
  })
  await copy.click({ button: "right" })
  page.once("dialog", (dialog) => dialog.accept())
  await page
    .getByRole("group", { name: "Selection actions" })
    .getByRole("button", { name: "Delete selected", exact: true })
    .click()
  await expect(copy).toBeHidden()
  async function beginLink() {
    await plc.click({ button: "right" })
    await button("Link from Ethernet").click()
    await canvas.getByRole("button", { name: "Switch", exact: true }).click()
  }
  await beginLink()
  await expect(
    page.getByText("Move Switch / P1 from Safety to Controls?")
  ).toBeVisible()
  await button("Cancel").click()
  expect((await saved()).interfaces[1].networkId).toBe("Safety")
  await beginLink()
  await button("Accept change and link").click()
  await expect(canvas.locator("svg text")).toHaveText("Controls")
  expect((await saved()).interfaces[1].networkId).toBe("Controls")
  await button("Controls").click()
  await page.getByRole("searchbox", { name: "Search plan" }).fill("PROFINET")
  await button("Table").click()
  await expect(page.getByLabel("Search component")).toHaveValue("PROFINET")
  await expect(
    page
      .getByRole("table", { name: "Interfaces", exact: true })
      .getByRole("cell", { name: "PROFINET", exact: true })
  ).toBeVisible()
  await page.reload()
  await expect(button("Controls")).toHaveAttribute("aria-pressed", "true")
  await expect(
    page.getByRole("searchbox", { name: "Search plan" })
  ).toHaveValue("PROFINET")
  await expect(plc).toBeVisible()
  await expect(
    canvas.getByRole("button", { name: "Switch", exact: true })
  ).toBeHidden()
})

test("create from the library at zoom and connect an edited interface using a new network", async ({
  page,
}) => {
  const id = await openPlan(page, {
    components: [
      {
        id: "target",
        name: "Cabinet switch",
        type: "Switch",
        position: { x: 32, y: 40 },
        hostId: null,
      },
    ],
    interfaces: [
      {
        id: "p1",
        componentId: "target",
        name: "P1",
        networkId: null,
        ipv4: null,
      },
    ],
  })
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true })
  await button("Component library").click()
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  const library = page.getByRole("complementary", { name: "Component library" })
  const search = library.getByRole("searchbox", {
    name: "Search component types",
  })
  const fieldCategory = library.getByRole("button", {
    name: "Field I/O",
    exact: true,
  })
  const master = library.getByRole("button", {
    name: "IO-Link master",
    exact: true,
  })
  await fieldCategory.click()
  await expect(master).toBeHidden()
  await page.reload()
  await button("Component library").click()
  await expect(fieldCategory).toHaveAttribute("aria-expanded", "false")
  await search.fill("iolink")
  await expect(master).toBeVisible()
  await search.fill("")
  await expect(master).toBeHidden()
  await fieldCategory.click()
  await expect(master).toBeVisible()
  await page.reload()
  await button("Component library").click()
  await expect(fieldCategory).toHaveAttribute("aria-expanded", "true")
  await button("Zoom out").click()
  await search.fill("iolink")
  await expect(library.getByRole("button")).toHaveCount(3)
  await search.fill("unlisted device")
  await expect(library.getByRole("status")).toHaveText(
    "No matching component types."
  )
  await search.fill("controllers plc")
  await expect(library.getByRole("button")).toHaveCount(2)
  await canvas.scrollIntoViewIfNeeded()
  await library
    .getByRole("region", { name: "Controllers & HMI" })
    .getByRole("button", { name: "PLC", exact: true })
    .dragTo(canvas, { targetPosition: { x: 90, y: 150 } })
  const editor = page.getByRole("dialog", { name: "Add component" })
  await expect(editor.getByLabel("Component type")).toHaveValue("PLC")
  await editor.getByLabel("Component name").fill("Mixer")
  await button("Add interface").click()
  await editor.getByLabel("Interface name").fill("Ethernet")
  await button("Add link from Ethernet").click()
  const link = page.getByRole("dialog", { name: "Connect interface" })
  await link
    .getByRole("combobox", { name: "Network", exact: true })
    .selectOption({ label: "Create network…" })
  await expect(link.getByLabel("Line type")).toHaveCount(0)
  await link.getByLabel("New network name").fill("Mixer LAN")
  await link.getByLabel("Target component").selectOption("target")
  await button("Create link").click()
  await expect(link).toBeHidden()
  const plan: Plan = await (await page.request.get("/api/plans/" + id)).json()
  expect(plan.components.find((c) => c.name === "Mixer")?.position).toEqual({
    x: 120,
    y: 200,
  })
  expect(plan.networks.map((n) => n.name)).toEqual(["Mixer LAN"])
  expect(plan.interfaces.map((p) => p.networkId)).toEqual([
    plan.networks[0].id,
    plan.networks[0].id,
  ])
  expect(plan.links).toHaveLength(1)
  expect(plan.links[0].lineType).toBe("elbow")
})

test("duplicate advances numbered names and skips case-insensitive conflicts", async ({
  page,
}) => {
  await openPlan(page, {
    components: ["Switch", " SWITCH_1 ", "switch_3"].map((name, index) => ({
      id: String(index),
      name,
      type: "Switch",
      position: { x: 30 + 240 * index, y: 40 },
      hostId: null,
    })),
  })
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  await canvas
    .getByRole("button", { name: "Switch", exact: true })
    .click({ button: "right" })
  await page.getByRole("button", { name: "Duplicate", exact: true }).click()
  await expect(
    canvas.getByRole("button", { name: "Switch_2", exact: true })
  ).toBeVisible()
  const actions = page.getByRole("group", { name: "Selected components" })
  await actions.getByRole("button", { name: "Duplicate selected" }).click()
  await expect(
    canvas.getByRole("button", { name: "Switch_4", exact: true })
  ).toHaveAttribute("aria-pressed", "true")
})

test("delete selected confirms removal of connected links and detaches surviving VMs", async ({
  page,
}) => {
  const id = await openPlan(page, {
    components: [
      {
        id: "server",
        name: "Server",
        type: "Server",
        position: { x: 32, y: 48 },
        hostId: null,
      },
      {
        id: "vm",
        name: "Monitoring VM",
        type: "VM",
        position: { x: 32, y: 175 },
        hostId: "server",
      },
      {
        id: "plc",
        name: "Line PLC",
        type: "PLC",
        position: { x: 240, y: 48 },
        hostId: null,
      },
      {
        id: "hmi",
        name: "Operator panel",
        type: "HMI",
        position: { x: 240, y: 175 },
        hostId: null,
      },
    ],
    interfaces: ["server", "vm", "plc", "hmi"].map((id) => ({
      id: `${id}-port`,
      componentId: id,
      name: "Ethernet",
      networkId: null,
      ipv4: null,
    })),
    links: [
      {
        id: "internal",
        source: { componentId: "server", interfaceId: "server-port" },
        target: { componentId: "plc", interfaceId: "plc-port" },
        medium: "wired",
        protocol: null,
      },
      {
        id: "outgoing",
        source: { componentId: "plc", interfaceId: "plc-port" },
        target: { componentId: "hmi", interfaceId: "hmi-port" },
        medium: "wired",
        protocol: null,
      },
      {
        id: "incoming",
        source: { componentId: "vm", interfaceId: "vm-port" },
        target: { componentId: "server", interfaceId: "server-port" },
        medium: "virtual",
        protocol: null,
      },
      {
        id: "unrelated",
        source: { componentId: "vm", interfaceId: "vm-port" },
        target: { componentId: "hmi", interfaceId: "hmi-port" },
        medium: "wired",
        protocol: null,
      },
    ],
  })
  const saved = async (): Promise<Plan> =>
    (await page.request.get(`/api/plans/${id}`)).json()
  const before = await saved()
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  const card = (name: string) =>
    canvas.getByRole("button", { name, exact: true })
  const actions = page.getByRole("group", { name: "Selected components" })
  await card("Server").click({ modifiers: ["Shift"] })
  await card("Line PLC").click({ modifiers: ["Shift"] })
  await card("Server").click({ button: "right" })
  const dismissed = page.waitForEvent("dialog").then(async (dialog) => {
    const message = dialog.message()
    await dialog.dismiss()
    return message
  })
  await page
    .getByRole("group", { name: "Selection actions" })
    .getByRole("button", { name: "Delete selected" })
    .click()
  expect(await dismissed).toContain(
    "Delete the 2 selected components and remove all associated interfaces and connected links?"
  )
  expect(await saved()).toEqual(before)
  await expect(actions.getByRole("status")).toHaveText("2 selected")

  page.once("dialog", (dialog) => dialog.accept())
  await actions.getByRole("button", { name: "Delete selected" }).click()
  await expect(card("Line PLC")).toHaveCount(0)
  await expect(actions).toBeHidden()
  const after = await saved()
  expect(after.components.map(({ id, hostId }) => ({ id, hostId }))).toEqual([
    { id: "vm", hostId: null },
    { id: "hmi", hostId: null },
  ])
  expect(after.interfaces.map(({ id }) => id)).toEqual(["vm-port", "hmi-port"])
  expect(after.links.map(({ id }) => id)).toEqual(["unrelated"])
})

test("marquee selection moves each hosted VM once and edits selected appearances together", async ({
  page,
}) => {
  const items = [
    {
      id: "server",
      name: "Server",
      type: "Server",
      hostId: null,
      position: { x: 28, y: 48 },
    },
    {
      id: "vm",
      name: "Control VM",
      type: "VM",
      hostId: "server",
      position: { x: 28, y: 170 },
    },
    {
      id: "guest",
      name: "Audit VM",
      type: "VM",
      hostId: "server",
      position: { x: 28, y: 290 },
    },
    {
      id: "plc",
      name: "Controller",
      type: "PLC",
      hostId: null,
      position: { x: 240, y: 48 },
    },
  ]
  const id = await openPlan(page, { components: items })
  const saved = async (): Promise<Plan> =>
    (await page.request.get(`/api/plans/${id}`)).json()
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  const card = (name: string) =>
    canvas.getByRole("button", { name, exact: true })
  const actions = page.getByRole("group", { name: "Selected components" })
  await card("Controller").click({ modifiers: ["Shift"] })
  await expect(actions.getByRole("status")).toHaveText("1 selected")
  await canvas.scrollIntoViewIfNeeded()
  await canvas.evaluate((element) => element.scrollTo(0, 0))
  const host = (await card("Server").boundingBox())!
  const vm = (await card("Control VM").boundingBox())!
  await page.keyboard.down("Shift")
  await page.mouse.move(host.x - 8, host.y - 8)
  await page.mouse.down()
  await page.mouse.move(vm.x + 6, vm.y + 6, { steps: 7 })
  await page.mouse.up()
  await page.keyboard.up("Shift")
  await expect(actions.getByRole("status")).toHaveText("3 selected")
  await expect(card("Audit VM")).toHaveAttribute("aria-pressed", "false")

  const anchor = (await card("Control VM").boundingBox())!
  await page.mouse.move(anchor.x + 50, anchor.y + 25)
  await page.mouse.down()
  await page.mouse.move(anchor.x + 82, anchor.y + 49, { steps: 8 })
  await page.mouse.up()
  const positions = (x: number, y: number) =>
    items.map((item) => ({ x: item.position.x + x, y: item.position.y + y }))
  await expect
    .poll(async () => (await saved()).components.map((item) => item.position))
    .toEqual(positions(32, 24))

  await actions.getByRole("button", { name: "Move selected" }).click()
  await expect(canvas).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect
    .poll(async () => (await saved()).components.map((item) => item.position))
    .toEqual(positions(42, 34))

  await actions.getByRole("button", { name: "Edit selected" }).click()
  const editor = page.getByRole("dialog", { name: "Edit selected components" })
  await expect(
    editor.getByRole("button", { name: "Save changes" })
  ).toBeDisabled()
  await editor.getByLabel("Change type").check()
  await editor.getByLabel("Component type").fill("HMI")
  await editor.getByRole("button", { name: "Save changes" }).click()
  await expect(editor.getByRole("alert")).toContainText(
    "hosting for Control VM on Server"
  )
  expect((await saved()).components.map((item) => item.type)).toEqual(
    items.map((item) => item.type)
  )
  await editor.getByLabel("Change type").uncheck()
  await editor.getByLabel("Change appearance").check()
  await editor
    .getByLabel("Representation")
    .selectOption({ label: "Labeled shape" })
  await editor.getByLabel("Shape label").fill("Line A")
  await editor.getByRole("button", { name: "Save changes" }).click()
  await expect(editor).toBeHidden()
  const result = await saved()
  expect(
    result.components
      .filter((item) => item.appearance?.kind === "shape")
      .map((item) => item.id)
  ).toEqual(["server", "vm", "plc"])
  expect(result.components.find(({ id }) => id === "guest")?.hostId).toBe(
    "server"
  )
  await canvas.press("Escape")
  await expect(actions).toBeHidden()
})

test("automatic duplication copies only internal links and selects the copies", async ({
  page,
}, testInfo) => {
  const id = await openPlan(page, {
    networks: [
      {
        id: "plant",
        name: "Plant LAN",
        subnet: "192.0.2.0/29",
        position: null,
      },
    ],
    components: [
      {
        id: "host",
        name: "Edge server",
        type: "Server",
        position: { x: 32, y: 48 },
        hostId: null,
      },
      {
        id: "guest",
        name: "Edge VM",
        type: "VM",
        position: { x: 255, y: 180 },
        hostId: "host",
      },
      {
        id: "remote",
        name: "Remote PLC",
        type: "PLC",
        position: { x: 410, y: 48 },
        hostId: null,
      },
    ],
    interfaces: ["host", "guest", "remote"].map((id, index) => ({
      id: `${id}-port`,
      componentId: id,
      name: "Ethernet",
      networkId: "plant",
      ipv4: `192.0.2.${index + 1}`,
    })),
    links: [
      {
        id: "inside",
        source: { componentId: "host", interfaceId: "host-port" },
        target: { componentId: "guest", interfaceId: "guest-port" },
        medium: "virtual",
        protocol: "OPC UA",
        lineType: "elbow",
      },
      {
        id: "component-link",
        source: { componentId: "guest", interfaceId: null },
        target: { componentId: "host", interfaceId: "host-port" },
        medium: "wired",
        protocol: null,
      },
      {
        id: "outside",
        source: { componentId: "guest", interfaceId: "guest-port" },
        target: { componentId: "remote", interfaceId: "remote-port" },
        medium: "wired",
        protocol: null,
      },
    ],
  })
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  const card = (name: string) =>
    canvas.getByRole("button", { name, exact: true })
  await page.getByLabel("Automatic IP assignment").check()
  await page.getByRole("button", { name: "Select components" }).click()
  if (testInfo.project.use.hasTouch) await card("Edge server").tap()
  else await card("Edge server").press("Enter")
  await card("Edge VM").press("Space")
  const actions = page.getByRole("group", { name: "Selected components" })
  await expect(actions.getByRole("status")).toHaveText("2 selected")
  await card("Edge server").click({ button: "right" })
  await page
    .getByRole("group", { name: "Selection actions" })
    .getByRole("button", { name: "Duplicate selected" })
    .click()
  await expect(card("Edge server_1")).toHaveAttribute("aria-pressed", "true")
  await expect(card("Edge VM_1")).toHaveAttribute("aria-pressed", "true")
  await expect(card("Edge VM")).toHaveAttribute("aria-pressed", "false")
  const viewport = (await canvas.boundingBox())!
  const firstCopy = (await card("Edge server_1").boundingBox())!
  const lastCopy = (await card("Edge VM_1").boundingBox())!
  expect(firstCopy.x).toBeGreaterThanOrEqual(viewport.x)
  expect(lastCopy.x + lastCopy.width).toBeLessThanOrEqual(
    viewport.x + viewport.width
  )
  const plan: Plan = await (await page.request.get(`/api/plans/${id}`)).json()
  const host = plan.components.find(({ name }) => name === "Edge server_1")!
  const guest = plan.components.find(({ name }) => name === "Edge VM_1")!
  expect(guest.hostId).toBe(host.id)
  expect(guest.position).toEqual({
    x: host.position!.x + 223,
    y: host.position!.y + 132,
  })
  const hostPort = plan.interfaces.find(
    ({ componentId }) => componentId === host.id
  )!
  const guestPort = plan.interfaces.find(
    ({ componentId }) => componentId === guest.id
  )!
  expect([hostPort, guestPort].map(({ ipv4 }) => ipv4).sort()).toEqual([
    "192.0.2.4",
    "192.0.2.5",
  ])
  expect(plan.links.slice(3)).toMatchObject([
    {
      source: { componentId: host.id, interfaceId: hostPort.id },
      target: { componentId: guest.id, interfaceId: guestPort.id },
      medium: "virtual",
      protocol: "OPC UA",
      lineType: "elbow",
    },
    {
      source: { componentId: guest.id, interfaceId: null },
      target: { componentId: host.id, interfaceId: hostPort.id },
      medium: "wired",
    },
  ])
  await page.getByRole("searchbox", { name: "Search plan" }).fill("Remote PLC")
  await expect(actions).toBeHidden()
  await page.getByRole("searchbox", { name: "Search plan" }).fill("")
  await expect(card("Edge server_1")).toHaveAttribute("aria-pressed", "false")
})

test("manual duplication remaps networks and saves confirmed address conflicts atomically", async ({
  page,
}) => {
  const id = await openPlan(page, {
    networks: [
      {
        id: "plant",
        name: "Plant LAN",
        subnet: "192.0.2.0/24",
        position: null,
      },
      {
        id: "safety",
        name: "Safety LAN",
        subnet: "198.51.100.0/24",
        position: null,
      },
      { id: "spare", name: "Spare LAN", subnet: null, position: null },
    ],
    components: [
      {
        id: "plc",
        name: "Line PLC",
        type: "PLC",
        position: { x: 32, y: 40 },
        hostId: null,
      },
    ],
    interfaces: [
      {
        id: "controller",
        componentId: "plc",
        name: "Control",
        networkId: "plant",
        ipv4: "192.0.2.10",
      },
      {
        id: "safety-port",
        componentId: "plc",
        name: "Safety",
        networkId: "safety",
        ipv4: "198.51.100.10",
      },
      {
        id: "spare-port",
        componentId: "plc",
        name: "Spare",
        networkId: null,
        ipv4: "192.0.2.20",
      },
    ],
  })
  const saved = async (): Promise<Plan> =>
    (await page.request.get(`/api/plans/${id}`)).json()
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  await canvas
    .getByRole("button", { name: "Line PLC", exact: true })
    .click({ button: "right" })
  await page.getByRole("button", { name: "Duplicate", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Duplicate component" })
  const confirm = dialog.getByRole("button", { name: "Duplicate", exact: true })
  await dialog.getByLabel("Plant LAN", { exact: true }).selectOption("safety")
  await confirm.click()
  await expect(dialog.getByRole("alert")).toContainText(
    "192.0.2.10 on Line PLC_1 / Control is outside Safety LAN"
  )
  await expect(
    dialog.getByRole("button", { name: "Keep conflicts flagged" })
  ).toHaveCount(0)
  await dialog
    .getByLabel("Plant LAN", { exact: true })
    .selectOption({ label: "Create new network…" })
  await expect(dialog.getByLabel("IPv4 subnet (optional)")).toHaveValue(
    "192.0.2.0/24"
  )
  await dialog.getByLabel("New network name").fill("Isolated Plant LAN")
  await dialog.getByLabel("No network", { exact: true }).selectOption("spare")
  await confirm.click()
  await expect(dialog.getByRole("alert")).toContainText(
    "198.51.100.10 is already assigned"
  )
  const before = await saved()
  expect(before.components).toHaveLength(1)
  expect(before.networks).toHaveLength(3)
  await dialog.getByRole("button", { name: "Keep conflicts flagged" }).click()
  await expect(dialog).toBeHidden()
  const result = await saved()
  const network = result.networks.find(
    ({ name }) => name === "Isolated Plant LAN"
  )!
  expect(network.subnet).toBe("192.0.2.0/24")
  const copy = result.components.find(({ name }) => name === "Line PLC_1")!
  expect(
    result.interfaces.filter(({ componentId }) => componentId === copy.id)
  ).toMatchObject([
    { networkId: network.id, ipv4: "192.0.2.10" },
    { networkId: "safety", ipv4: "198.51.100.10" },
    { networkId: "spare", ipv4: "192.0.2.20" },
  ])
  expect(result.interfaces.slice(0, before.interfaces.length)).toEqual(
    before.interfaces
  )
  await expect(
    canvas
      .getByRole("button", { name: "Line PLC_1", exact: true })
      .getByRole("img", { name: "IPv4 address conflict" })
  ).toBeVisible()
})

test("an exhausted automatic allocation warns when the copy has no IPv4 address", async ({
  page,
}) => {
  const id = await openPlan(page, {
    networks: [
      { id: "lan", name: "Full LAN", subnet: "192.0.2.1/32", position: null },
    ],
    components: [
      {
        id: "plc",
        name: "Line PLC",
        type: "PLC",
        position: { x: 32, y: 40 },
        hostId: null,
      },
      {
        id: "switch",
        name: "Unattached switch",
        type: "Switch",
        position: { x: 272, y: 40 },
        hostId: null,
      },
    ],
    interfaces: [
      {
        id: "controller",
        componentId: "plc",
        name: "Control",
        networkId: "lan",
        ipv4: "192.0.2.1",
      },
      {
        id: "aux",
        componentId: "plc",
        name: "Auxiliary",
        networkId: "lan",
        ipv4: null,
      },
      {
        id: "port",
        componentId: "switch",
        name: "Port 1",
        networkId: null,
        ipv4: null,
      },
    ],
  })
  await page.getByLabel("Automatic IP assignment").check()
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  const card = (name: string) =>
    canvas.getByRole("button", { name, exact: true })
  const search = page.getByRole("searchbox", { name: "Search plan" })
  await search.fill("192.0.2.1")
  await card("Line PLC").click({ button: "right" })
  await page.getByRole("button", { name: "Duplicate", exact: true }).click()
  const hiddenNotice = page.getByText(
    "Duplicated successfully. The copies are hidden by the current filters."
  )
  await expect(hiddenNotice).toBeVisible()
  await expect(
    page.getByText("Affected network Full LAN.", { exact: true })
  ).toBeVisible()
  await expect(search).toHaveValue("192.0.2.1")
  await search.fill("")
  await expect(hiddenNotice).toBeHidden()
  const warning = (name: string) =>
    card(name).getByRole("img", { name: "No IPv4 address assigned" })
  await warning("Line PLC_1").scrollIntoViewIfNeeded()
  await expect(warning("Line PLC_1")).toBeInViewport()
  await expect(warning("Line PLC")).toHaveCount(0)
  await expect(warning("Unattached switch")).toHaveCount(0)
  const result: Plan = await (await page.request.get(`/api/plans/${id}`)).json()
  const copy = result.components.find(({ name }) => name === "Line PLC_1")!
  expect(
    result.interfaces
      .filter(({ componentId }) => componentId === copy.id)
      .map(({ ipv4 }) => ipv4)
  ).toEqual([null, null])
})
