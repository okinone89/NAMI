import { expect, test, type Page } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase } from "./workspace-settings"

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

  await page.getByRole("button", { name: "Add link" }).click()
  const editor = page.getByRole("dialog", { name: "Add link" })
  await editor
    .getByRole("group", { name: "Source" })
    .getByLabel("Component")
    .selectOption("sw")
  await editor
    .getByRole("group", { name: "Target" })
    .getByLabel("Component")
    .selectOption("hmi")
  await editor.getByLabel("Medium").selectOption("wired")
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
    .getByRole("button", { name: "Main switch to Line HMI (Wired)" })
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

  await page.getByRole("button", { name: "Sign out" }).click()
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

test("place new components and networks by dragging their add controls onto the canvas", async ({
  page,
}) => {
  const planId = await openPlan(page, {})
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  await page.getByRole("button", { name: "Add component" }).dragTo(canvas, {
    targetPosition: { x: 24, y: 80 },
  })
  const component = page.getByRole("dialog", { name: "Add component" })
  await component.getByLabel("Component name").fill("Packaging PLC")
  await component.getByLabel("Component type").fill("PLC")
  await component.getByRole("button", { name: "Save component" }).click()
  await expect(
    canvas.getByRole("button", { name: "Packaging PLC" })
  ).toBeVisible()

  // Scroll before the drag so the drop point does not move the source off the pointer.
  await canvas.scrollIntoViewIfNeeded()
  await page.getByRole("button", { name: "Add network" }).dragTo(canvas, {
    targetPosition: { x: 54, y: 208 },
  })
  const network = page.getByRole("dialog", { name: "Add network" })
  await network.getByLabel("Network name").fill("Cabinet LAN")
  await network.getByRole("button", { name: "Save network" }).click()
  await expect(
    canvas.getByRole("button", { name: "Cabinet LAN" })
  ).toBeVisible()

  const response = await page.request.get(`/api/plans/${planId}`)
  const saved: Plan = await response.json()
  expect(saved.components[0].position).toEqual({ x: 24, y: 80 })
  expect(saved.networks[0].position).toEqual({ x: 54, y: 208 })

  await page.reload()
  await canvas.getByRole("button", { name: "Cabinet LAN" }).click()
  const rename = page.getByRole("dialog", { name: "Edit network" })
  await rename.getByLabel("Network name").fill("Controls LAN")
  await rename.getByRole("button", { name: "Save network" }).click()
  await expect(
    canvas.getByRole("button", { name: "Controls LAN" })
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
  const picker = page.getByLabel("Topology network")
  const selectedNetwork = picker.locator("option:checked")
  await picker.selectOption("existing")
  await canvas.evaluate((element) => element.scrollTo(0, 0))

  await page.getByRole("button", { name: "Add component" }).dragTo(canvas, {
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

  await picker.selectOption("existing")
  await canvas.evaluate((element) => element.scrollTo(0, 0))
  await canvas.scrollIntoViewIfNeeded()
  await page.getByRole("button", { name: "Add network" }).dragTo(canvas, {
    targetPosition: { x: 40, y: 200 },
  })
  const network = page.getByRole("dialog", { name: "Add network" })
  await network.getByLabel("Network name").fill("New LAN")
  await network.getByRole("button", { name: "Save network" }).click()
  await expect(network).toBeHidden()
  await expect(selectedNetwork).toHaveText("New LAN")
  await expect(canvas.getByRole("button", { name: "New LAN" })).toBeInViewport()

  const saved: Plan = await (
    await page.request.get("/api/plans/" + planId)
  ).json()
  expect(saved.components[0].position).toEqual({ x: 80, y: 80 })
  expect(saved.interfaces).toEqual([])
  expect(
    saved.networks.find(({ name }) => name === "New LAN")?.position
  ).toEqual({ x: 40, y: 200 })
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
  await page.getByRole("button", { name: "Sign out" }).click()
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

  await page.getByRole("button", { name: "Sign out" }).click()
  const picker = page.getByLabel("Topology network")
  await picker.selectOption("plant")
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

  await picker.selectOption("control")
  await expect(
    enclosure.getByRole("button", { name: "Control VM", exact: true })
  ).toBeVisible()
  await expect(
    enclosure.getByRole("button", { name: "Unassigned VM", exact: true })
  ).toHaveCount(0)
  await expect(virtualLink).toHaveCount(0)
})
