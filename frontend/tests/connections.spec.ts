import { expect, test, type Page } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import { editorPassphrase } from "./workspace-settings"

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

test("list documented connections by endpoint, medium, and protocol as a visitor", async ({
  page,
}) => {
  await openPlan(page)
  await page.getByRole("button", { name: "Sign out" }).click()
  await page.getByRole("button", { name: "Table", exact: true }).click()
  const connections = page.getByRole("table", {
    name: "Connections",
    exact: true,
  })
  const documentedLink = connections.getByRole("row", { name: /Edge server/ })

  await expect(documentedLink).toContainText("Port unspecified")
  await expect(documentedLink).toContainText("Runtime VM / vNIC 1")
  await expect(
    documentedLink.getByRole("cell", { name: "Virtual", exact: true })
  ).toBeVisible()
  await expect(documentedLink).toContainText("Generic IP")
  await expect(documentedLink).toContainText("PROFINET")
  await expect(documentedLink).toContainText("Modbus TCP")
  await expect(connections.getByRole("row")).toHaveCount(2)
  await expect(connections.getByText("Historian VM")).toHaveCount(0)
})

test("inspect all endpoint profiles after activating a diagram link once", async ({
  page,
}, info) => {
  await openPlan(page)
  await page.getByRole("button", { name: "Sign out" }).click()
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

test("edit a connection from the table and reopen the saved link in both views", async ({
  page,
}) => {
  const before = await openPlan(page)
  await page.getByRole("button", { name: "Table", exact: true }).click()
  const connections = page.getByRole("table", {
    name: "Connections",
    exact: true,
  })
  await connections
    .getByRole("button", { name: /Edge server.*Runtime VM/ })
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
      id: "runtime-link",
      source: { componentId: "server", interfaceId: "server-vswitch" },
      target: { componentId: "historian", interfaceId: "historian-vnic" },
      medium: "wireless",
      protocol: "Generic IP",
    },
  ])
  expect(after.components).toEqual(before.components)
  expect(after.interfaces).toEqual(before.interfaces)

  await page.getByRole("button", { name: "Sign out" }).click()
  await page.reload()
  await page
    .getByRole("button", {
      name: "Edge server / Virtual switch to Historian VM / vNIC 1 (Wireless)",
      exact: true,
    })
    .click()
  await expect(inspector.getByText("Generic IP", { exact: true })).toBeVisible()
  await inspector.getByRole("button", { name: "Close" }).click()

  await page.getByRole("button", { name: "Table", exact: true }).click()
  await connections
    .getByRole("button", { name: /Edge server.*Historian VM/ })
    .click()
  await expect(inspector.getByText("Wireless", { exact: true })).toBeVisible()
  await expect(inspector.getByText("Generic IP", { exact: true })).toBeVisible()
  await expect(
    inspector.getByRole("button", { name: "Save link" })
  ).toHaveCount(0)
})
