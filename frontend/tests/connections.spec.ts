import { expect, test, type Page } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase, signOut } from "./workspace-settings"

async function openPlan(page: Page) {
  const session = await page.request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
  })
  expect(session.ok()).toBe(true)
  const created = await page.request.post("/api/plans", {
    data: { name: "Virtual machine connections" },
  })
  expect(created.status()).toBe(201)
  const plan: Plan = await created.json()
  const snapshot: Plan = {
    ...plan,
    components: [
      {
        id: "server",
        name: "Edge server",
        type: "Server",
        position: { x: 24, y: 80 },
        hostId: null,
      },
      {
        id: "runtime",
        name: "Runtime VM",
        type: "VM",
        position: null,
        hostId: "server",
      },
      {
        id: "historian",
        name: "Historian VM",
        type: "VM",
        position: null,
        hostId: "server",
      },
    ],
    interfaces: [
      {
        id: "server-vswitch",
        componentId: "server",
        name: "Virtual switch",
        networkId: null,
        ipv4: null,
      },
      {
        id: "runtime-vnic",
        componentId: "runtime",
        name: "vNIC 1",
        networkId: null,
        ipv4: "192.0.2.10",
        protocolProfiles: {
          profinet: { stationName: "line-runtime", roles: ["device"] },
          modbusTcp: {
            role: "server",
            serverPort: 1502,
            downstreamDevices: [{ name: "Flow meter", unitId: 12 }],
          },
        },
      },
      {
        id: "historian-vnic",
        componentId: "historian",
        name: "vNIC 1",
        networkId: null,
        ipv4: null,
      },
    ],
    links: [
      {
        id: "runtime-link",
        source: { componentId: "server", interfaceId: null },
        target: { componentId: "runtime", interfaceId: "runtime-vnic" },
        medium: "virtual",
        protocol: "Generic IP",
      },
    ],
  }
  const saved = await page.request.put(`/api/plans/${plan.id}`, {
    data: snapshot,
  })
  expect(saved.ok()).toBe(true)
  await page.goto(`/?plan=${plan.id}`)
  return (await saved.json()) as Plan
}

test("show the interface inventory without a connections panel", async ({
  page,
}) => {
  await openPlan(page)
  await signOut(page)
  await page.getByRole("button", { name: "Table", exact: true }).click()
  const connections = page.getByRole("table", {
    name: "Connections",
    exact: true,
  })
  await expect(page.getByRole("table", { name: "Interfaces" })).toBeVisible()
  await expect(connections).toHaveCount(0)
})

test("inspect all endpoint profiles after activating a diagram link once", async ({
  page,
}, info) => {
  await openPlan(page)
  await signOut(page)
  const enclosure = page.getByRole("group", {
    name: "Edge server host enclosure",
  })
  await expect(
    enclosure.getByRole("button", { name: "Runtime VM" })
  ).toBeVisible()
  await expect(
    enclosure.getByRole("button", { name: "Historian VM" })
  ).toBeVisible()
  const diagramLink = page.getByRole("button", {
    name: "Edge server to Runtime VM / vNIC 1 (Virtual)",
    exact: true,
  })
  if (info.project.use.hasTouch) await diagramLink.tap()
  else await diagramLink.click()

  const inspector = page.getByRole("dialog", { name: "Link details" })
  await expect(
    inspector.getByText("Edge server", { exact: true })
  ).toBeVisible()
  await expect(
    inspector.getByText("Port unspecified", { exact: true })
  ).toBeVisible()
  await expect(
    inspector.getByText("Runtime VM / vNIC 1", { exact: true })
  ).toBeVisible()
  await expect(inspector.getByText("Virtual", { exact: true })).toBeVisible()
  await expect(inspector.getByText("Generic IP", { exact: true })).toBeVisible()
  await expect(
    inspector.getByRole("button", { name: "Remove link" })
  ).toHaveCount(0)
  const profiles = inspector.getByRole("region", { name: "Protocol profiles" })
  for (const detail of [
    "PROFINET",
    "line-runtime",
    "IO device",
    "Modbus TCP",
    "Server",
    "1502",
    "Flow meter",
    "Unit ID 12",
  ]) {
    await expect(profiles.getByText(detail, { exact: true })).toBeVisible()
  }
  await expect(inspector.getByText("192.0.2.10", { exact: true })).toBeVisible()
  await expect(
    inspector.getByRole("button", { name: "Save link" })
  ).toHaveCount(0)
})

test("edit a diagram connection and reopen the saved link as a visitor", async ({
  page,
}) => {
  const before = await openPlan(page)
  await page
    .getByRole("button", {
      name: "Edge server to Runtime VM / vNIC 1 (Virtual)",
      exact: true,
    })
    .click()

  const inspector = page.getByRole("dialog", { name: "Link details" })
  const source = inspector.getByRole("group", { name: "Source" })
  const target = inspector.getByRole("group", { name: "Target" })
  await expect(source.getByLabel("Interface")).toHaveValue("")
  await expect(target.getByLabel("Interface")).toHaveValue("runtime-vnic")
  await expect(target.getByText("line-runtime", { exact: true })).toBeVisible()
  await source.getByLabel("Interface").selectOption("server-vswitch")
  await target.getByLabel("Component").selectOption("historian")
  await target.getByLabel("Interface").selectOption("historian-vnic")
  await expect(target.getByText("line-runtime", { exact: true })).toHaveCount(0)
  await inspector.getByLabel("Medium").selectOption("wireless")
  await inspector.getByRole("button", { name: "Save link" }).click()
  await expect(inspector).toBeHidden()

  const response = await page.request.get(`/api/plans/${before.id}`)
  expect(response.ok()).toBe(true)
  const after: Plan = await response.json()
  expect(after.links).toEqual([
    {
      lineType: "elbow",
      id: "runtime-link",
      source: { componentId: "server", interfaceId: "server-vswitch" },
      target: { componentId: "historian", interfaceId: "historian-vnic" },
      medium: "wireless",
      protocol: "Generic IP",
    },
  ])
  expect(after.components).toEqual(before.components)
  expect(after.interfaces).toEqual(before.interfaces)

  await signOut(page)
  await page.reload()
  await page
    .getByRole("button", {
      name: "Edge server / Virtual switch to Historian VM / vNIC 1 (Wireless)",
      exact: true,
    })
    .click()
  await expect(inspector.getByText("Generic IP", { exact: true })).toBeVisible()
  await expect(inspector.getByText("Wireless", { exact: true })).toBeVisible()
  await expect(inspector.getByText("Generic IP", { exact: true })).toBeVisible()
  await expect(
    inspector.getByRole("button", { name: "Save link" })
  ).toHaveCount(0)
})

test("cancel and then remove a diagram link without changing its endpoints", async ({
  page,
}) => {
  const before = await openPlan(page)
  const connection = page.getByRole("button", {
    name: "Edge server to Runtime VM / vNIC 1 (Virtual)",
    exact: true,
  })
  await connection.click()
  const inspector = page.getByRole("dialog", { name: "Link details" })
  const remove = inspector.getByRole("button", { name: "Remove link" })
  page.once("dialog", (dialog) => dialog.dismiss())
  await remove.click()
  await expect(inspector).toBeVisible()
  page.once("dialog", (dialog) => dialog.accept())
  await remove.click()
  await expect(inspector).toBeHidden()
  await page.reload()
  await expect(
    page.getByRole("button", { name: "Runtime VM", exact: true })
  ).toBeVisible()
  await expect(connection).toHaveCount(0)
  const after: Plan = await (
    await page.request.get(`/api/plans/${before.id}`)
  ).json()
  expect(after.links).toEqual([])
  expect(after.components).toEqual(before.components)
  expect(after.interfaces).toEqual(before.interfaces)
  expect(after.networks).toEqual(before.networks)
})

test("edit or remove a link from its canvas context menu", async ({ page }) => {
  await openPlan(page)
  const connection = page.getByRole("button", {
    name: "Edge server to Runtime VM / vNIC 1 (Virtual)",
  })
  await connection.click({ button: "right" })
  const menu = page.getByRole("group", { name: "Connection actions" })
  await menu.getByRole("button", { name: "Edit link" }).click()
  const editor = page.getByRole("dialog", { name: "Link details" })
  await editor.getByLabel("Medium").selectOption("wireless")
  await editor.getByRole("button", { name: "Save link" }).click()
  const saved = page.getByRole("button", {
    name: "Edge server to Runtime VM / vNIC 1 (Wireless)",
  })
  await saved.focus()
  await saved.press("Shift+F10")
  page.once("dialog", (dialog) => dialog.accept())
  await menu.getByRole("button", { name: "Remove link" }).click()
  await expect(saved).toHaveCount(0)
  await expect(editor).toBeHidden()
})

test("drag empty canvas space to scroll in both directions", async ({
  page,
}) => {
  const plan = await openPlan(page)
  const response = await page.request.put(`/api/plans/${plan.id}`, {
    data: {
      ...plan,
      components: [
        ...plan.components,
        {
          ...plan.components[0],
          id: "remote",
          name: "Far server",
          position: { x: 2200, y: 1800 },
        },
      ],
    },
  })
  expect(response.ok()).toBe(true)
  await page.reload()
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  await expect(
    canvas.getByRole("button", { name: "Far server", exact: true })
  ).toBeAttached()
  await canvas.scrollIntoViewIfNeeded()
  const bounds = (await canvas.boundingBox())!
  const x = bounds.x + bounds.width - 25
  const y = bounds.y + bounds.height - 25
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 100, y - 75, { steps: 5 })
  await page.mouse.up()
  expect(await canvas.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([
    100, 75,
  ])
  const after = await (await page.request.get(`/api/plans/${plan.id}`)).json()
  expect(after.revision).toBe((await response.json()).revision)
})

test("route legacy direct links around components and jump at crossings", async ({
  page,
}) => {
  const before = await openPlan(page)
  const component = (id: string, x: number, y: number) => ({
    id,
    name: id,
    type: "PLC",
    hostId: null,
    position: { x, y },
  })
  const connection = (id: string, source: string, target: string) => ({
    id,
    source: { componentId: source, interfaceId: null },
    target: { componentId: target, interfaceId: null },
    medium: "wired",
    protocol: null,
  })
  const url = "/api/plans/" + before.id
  expect(
    (
      await page.request.put(url, {
        data: {
          ...before,
          components: [
            component("A", 20, 200),
            component("Obstacle", 260, 200),
            component("B", 700, 200),
            component("C", 490, 20),
            component("D", 490, 400),
          ],
          interfaces: [],
          links: [
            connection("v", "C", "D"),
            { ...connection("h", "A", "B"), lineType: "direct" },
          ],
        },
      })
    ).ok()
  ).toBe(true)
  await page.reload()
  const link = page.getByRole("button", { name: "A to B (Wired)", exact: true })
  const obstacle = page.getByRole("button", { name: "Obstacle", exact: true })
  await obstacle.scrollIntoViewIfNeeded()
  expect(
    await obstacle.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return el.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      )
    })
  ).toBe(true)
  const stroke = link.locator("path[stroke='currentColor']")
  await expect(stroke).toHaveAttribute("d", /Q/)
  const box = await obstacle.boundingBox()
  expect(
    await stroke.evaluate((element, rect) => {
      const path = element as SVGPathElement
      for (let n = 0; n < path.getTotalLength(); n += 2) {
        const p = path.getPointAtLength(n).matrixTransform(path.getScreenCTM()!)
        if (
          p.x > rect.x &&
          p.x < rect.x + rect.width &&
          p.y > rect.y &&
          p.y < rect.y + rect.height
        )
          return true
      }
      return false
    }, box!)
  ).toBe(false)
  await link.focus()
  await link.press("Enter")
  await expect(page.getByLabel("Line type")).toHaveCount(0)
  const saved: Plan = await (await page.request.get(url)).json()
  expect(saved.links.every((link) => link.lineType === "elbow")).toBe(true)
})

test("elbows avoid unrelated VM enclosures and reach hosted endpoints", async ({
  page,
}) => {
  const plan = await openPlan(page)
  const component = (
    id: string,
    x: number,
    y: number,
    hostId: string | null = null
  ) => ({
    id,
    name: id,
    type: hostId ? "VM" : "Server",
    hostId,
    position: { x, y },
  })
  const connection = (from: string, to: string) => ({
    id: from + to,
    source: { componentId: from },
    target: { componentId: to },
    medium: "wired",
    lineType: "elbow",
  })
  const saved = await page.request.put("/api/plans/" + plan.id, {
    data: {
      ...plan,
      interfaces: [],
      components: [
        component("Left", 20, 200),
        component("Right", 740, 200),
        component("Host", 350, 60),
        component("Guest", 350, 340, "Host"),
      ],
      links: [
        connection("Left", "Right"),
        connection("Right", "Guest"),
        connection("Host", "Guest"),
      ],
    },
  })
  expect(saved.ok()).toBe(true)
  await page.reload()
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  const enclosure = (await canvas
    .getByRole("group", { name: "Host host enclosure" })
    .boundingBox())!
  const stroke = (from: string, to: string) =>
    canvas
      .getByRole("button", { name: `${from} to ${to} (Wired)`, exact: true })
      .locator("path[stroke='currentColor']")
  expect(
    await stroke("Left", "Right").evaluate((element, rect) => {
      const path = element as SVGPathElement
      for (let i = 0; i <= path.getTotalLength(); i += 2) {
        const p = path.getPointAtLength(i).matrixTransform(path.getScreenCTM()!)
        if (
          p.x > rect.x &&
          p.x < rect.x + rect.width &&
          p.y > rect.y &&
          p.y < rect.y + rect.height
        )
          return true
      }
      return false
    }, enclosure)
  ).toBe(false)
  const guest = (await canvas
    .getByRole("button", { name: "Guest", exact: true })
    .boundingBox())!
  for (const from of ["Right", "Host"]) {
    const point = await stroke(from, "Guest").evaluate((element) => {
      const path = element as SVGPathElement
      const { x, y } = path
        .getPointAtLength(path.getTotalLength())
        .matrixTransform(path.getScreenCTM()!)
      return { x, y }
    })
    expect(point.x).toBeGreaterThanOrEqual(guest.x - 1)
    expect(point.x).toBeLessThanOrEqual(guest.x + guest.width + 1)
    expect(point.y).toBeGreaterThanOrEqual(guest.y - 1)
    expect(point.y).toBeLessThanOrEqual(guest.y + guest.height + 1)
  }
})

test("give elbow links separate tracks past a host enclosure and distinct VM ports", async ({
  page,
}) => {
  const plan = await openPlan(page)
  const component = (
    id: string,
    x: number,
    y: number,
    hostId: string | null = null
  ) => ({
    id,
    name: id,
    type: hostId ? "VM" : "Server",
    hostId,
    position: { x, y },
  })
  const link = (from: string, to: string) => ({
    id: from + to,
    source: { componentId: from },
    target: { componentId: to },
    lineType: "elbow",
    medium: "wired",
  })
  const sources = ["Input A", "Input B", "Input C"]
  const links = [
    link(sources[0], "VM"),
    link("VM", sources[1]),
    link(sources[2], "VM"),
  ]
  const response = await page.request.put("/api/plans/" + plan.id, {
    data: {
      ...plan,
      interfaces: [],
      components: [
        ...sources.map((name, i) => component(name, 10, 100 + i * 95)),
        component("Transit host", 450, 75),
        component("Transit VM", 450, 850, "Transit host"),
        component("Destination host", 1000, 20),
        component("VM", 1000, 220, "Destination host"),
      ],
      links,
    },
  })
  expect(response.ok()).toBe(true)
  await page.reload()
  const heights: number[] = []
  const anchors: string[] = []
  for (const link of links) {
    const name =
      link.source.componentId + " to " + link.target.componentId + " (Wired)"
    const line = page
      .getByRole("button", { name, exact: true })
      .locator("path[stroke='currentColor']")
    const { y, anchor } = await line.evaluate((node, fromVM) => {
      const path = node as SVGPathElement
      const length = path.getTotalLength()
      const endpoint = path.getPointAtLength(fromVM ? 0 : length)
      for (let d = 0; d <= length; d += 1) {
        const point = path.getPointAtLength(d)
        if (Math.abs(point.x - 550) <= 1)
          return { y: point.y, anchor: [endpoint.x, endpoint.y].join(",") }
      }
      throw new Error("Link did not pass the enclosure")
    }, link.source.componentId === "VM")
    heights.push(y)
    anchors.push(anchor)
  }
  expect(new Set(anchors).size).toBe(3)
  heights.sort((a, b) => a - b)
  for (let i = 1; i < heights.length; i++)
    expect(heights[i] - heights[i - 1]).toBeGreaterThanOrEqual(15)
  expect(heights[2] - heights[0]).toBeLessThanOrEqual(34)
})
