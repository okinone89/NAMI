import { expect, test, type Page } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase, workspaceAction } from "./workspace-settings"

async function openPlan(page: Page, snapshot: Partial<Plan>) {
  const session = await page.request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
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

  await workspaceAction(page, "Sign out")
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

test("keeps new items on screen when placed in a focused topology", async ({
  page,
}) => {
  const planId = await openPlan(page, {
    networks: [
      { id: "existing", name: "Existing LAN", subnet: null, position: null },
    ],
  })
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  const existing = page.getByRole("button", {
    name: "Existing LAN",
    exact: true,
  })
  await existing.click()
  await canvas.evaluate((element) => element.scrollTo(0, 0))
  await canvas.scrollIntoViewIfNeeded()

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
  const saved: Plan = await (
    await page.request.get("/api/plans/" + planId)
  ).json()
  expect(saved.components[0].position).toEqual({ x: 80, y: 80 })
  expect(saved.interfaces).toEqual([])
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
  await workspaceAction(page, "Sign out")
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

  await workspaceAction(page, "Sign out")
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
  const copy = canvas.getByRole("button", { name: "PLC copy", exact: true })
  await expect(copy).toBeVisible()
  const snapshot = await saved()
  const copyPort = snapshot.interfaces.find(
    (p) =>
      p.componentId ===
      snapshot.components.find((c) => c.name === "PLC copy")?.id
  )
  expect(copyPort).toMatchObject({
    networkId: "Controls",
    ipv4: null,
    protocolProfiles: snapshot.interfaces[0].protocolProfiles,
  })
  await copy.click({ button: "right" })
  page.once("dialog", (dialog) => dialog.accept())
  await button("Delete").click()
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

test("duplicate gives a component a free name when a copy already exists", async ({
  page,
}) => {
  await openPlan(page, {
    components: ["Switch", " SWITCH COPY "].map((name, index) => ({
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
    canvas.getByRole("button", { name: "Switch copy 2", exact: true })
  ).toBeVisible()
})
