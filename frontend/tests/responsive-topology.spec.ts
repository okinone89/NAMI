import { expect, test, type Locator } from "@playwright/test"
import type { Plan } from "../src/lib/plans"
import {
  createBaselinePlan,
  sharedMachineAddress,
} from "./fixtures/baseline-plan"

const firstNetwork = "Filler A / Machine LAN"
const lastNetwork = "Filler B / Machine LAN"
const topologyCanvas = "Topology canvas"

for (const width of [360, 390, 1024]) {
  test.describe(`baseline at ${width}px`, () => {
    test.skip(({ hasTouch }) => Boolean(hasTouch) !== width < 640)
    test.use({ viewport: { width, height: width < 640 ? 844 : 768 } })

    test("opens the appropriate topology and keeps component names and VM enclosures", async ({
      page,
      request,
    }) => {
      const plan = await createBaselinePlan(request)
      await page.goto(`/?plan=${plan.id}`)
      await expect(
        page.getByText("10 networks · 200 components · 250 interfaces")
      ).toBeVisible()
      const picker = page.getByRole("button", {
        name: lastNetwork,
        exact: true,
      })
      const canvas = page.getByRole("region", { name: topologyCanvas })
      const farPlc = canvas.getByRole("button", {
        name: "Filler B PLC",
        exact: true,
      })
      const enclosure = canvas.getByRole("group", {
        name: "Edge server host enclosure",
      })
      async function expectReadableName(container: Locator, name: string) {
        await expect(
          container.getByRole("button", { name, exact: true }).getByText(name)
        ).toBeVisible()
      }

      await expect(picker).toHaveAttribute("aria-pressed", "false")
      await expect(farPlc).toHaveCount(1)
      await expectReadableName(enclosure, "Edge server")
      await expectReadableName(enclosure, "Historian VM")

      await picker.click()
      await expect(farPlc).toBeVisible()
      await expect(enclosure).toHaveCount(0)
      const networks = page.getByRole("region", {
        name: "Networks",
        exact: true,
      })
      await networks.getByRole("button", { name: "Collapse networks" }).click()
      await expect(networks.getByRole("list")).toBeHidden()
      await expect(
        networks.getByText(`Active network filter: ${lastNetwork}`, {
          exact: true,
        })
      ).toBeVisible()
      await expect(enclosure).toHaveCount(0)
      await networks.getByRole("button", { name: "Expand networks" }).click()
      await expect(picker).toHaveAttribute("aria-pressed", "true")
      await picker.click()
      await expectReadableName(enclosure, "Edge server")
      await expectReadableName(enclosure, "Historian VM")
      await expect(farPlc).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBe(width)
    })

    test("edits interfaces and preserves the linked HMI after Move and drag", async ({
      page,
      hasTouch,
    }) => {
      const plan = await createBaselinePlan(page.request)
      await page.goto(`/?plan=${plan.id}`)
      const canvas = page.getByRole("region", { name: topologyCanvas })
      const hmi = canvas.getByRole("button", {
        name: "Filler A HMI",
        exact: true,
      })
      const editor = page.getByRole("dialog", { name: "Filler A HMI" })
      const activate = (control: Locator) =>
        hasTouch ? control.tap() : control.click()
      const openEditor = async () => {
        await activate(hmi)
        await expect(editor).toBeVisible()
      }
      const savedPlan = async (): Promise<Plan> => {
        const response = await page.request.get(`/api/plans/${plan.id}`)
        expect(response.ok()).toBe(true)
        return response.json()
      }
      const hmiPosition = async () =>
        (await savedPlan()).components.find(({ id }) => id === "device-1")
          ?.position

      await openEditor()
      const ethernet = editor.getByRole("group", {
        name: "Ethernet",
        exact: true,
      })
      await ethernet.getByLabel("IPv4 address").fill("192.168.1.81")
      await activate(editor.getByRole("button", { name: "Add interface" }))
      const newInterface = editor.getByRole("group", { name: "New interface" })
      await newInterface.getByLabel("Interface name").fill("Service port")
      await activate(editor.getByRole("button", { name: "Save component" }))
      await expect(editor).toBeHidden()
      await openEditor()
      await expect(ethernet.getByLabel("IPv4 address")).toHaveValue(
        "192.168.1.81"
      )
      await expect(
        editor.getByRole("group", { name: "Service port" })
      ).toBeVisible()

      const move = editor.getByRole("button", { name: "Move", exact: true })
      await activate(move)
      await expect(editor).toBeHidden()
      await expect(
        page.getByRole("status").filter({ hasText: "Filler A HMI" })
      ).toBeVisible()
      await activate(page.getByRole("button", { name: "Cancel move" }))
      expect(await hmiPosition()).toEqual({ x: 24, y: 235 })

      await openEditor()
      await activate(move)
      await expect(editor).toBeHidden()
      const destination = { x: 100, y: 259 }
      await canvas.evaluate((element) => element.scrollTo(0, 90))
      const viewportDestination = { x: 100, y: 169 }
      if (hasTouch) await canvas.tap({ position: viewportDestination })
      else await canvas.click({ position: viewportDestination })
      await expect.poll(hmiPosition).toEqual(destination)

      await hmi.scrollIntoViewIfNeeded()
      const start = (await hmi.boundingBox())!
      const pointer = {
        x: Math.round(start.x + 60),
        y: Math.round(start.y + 25),
      }
      if (hasTouch) {
        const touch = await page.context().newCDPSession(page)
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [pointer],
        })
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: pointer.x + 20, y: pointer.y + 34 }],
        })
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        })
        await touch.detach()
      } else {
        await page.mouse.move(pointer.x, pointer.y)
        await page.mouse.down()
        await page.mouse.move(pointer.x + 20, pointer.y + 34, { steps: 4 })
        await page.mouse.up()
      }
      const dragged = { x: 120, y: 293 }
      await expect.poll(hmiPosition).toEqual(dragged)
      await expect(editor).toBeHidden()
      expect((await savedPlan()).links).toEqual(plan.links)

      await page.reload()
      await hmi.scrollIntoViewIfNeeded()
      const reopened = (await hmi.boundingBox())!
      const viewport = (await canvas.boundingBox())!
      const scroll = await canvas.evaluate((element) => ({
        x: element.scrollLeft,
        y: element.scrollTop,
      }))
      expect(reopened.x - viewport.x + scroll.x).toBeCloseTo(dragged.x)
      expect(reopened.y - viewport.y + scroll.y).toBeCloseTo(dragged.y)
      await activate(
        canvas
          .getByRole("button", {
            name: "Filler A PLC / Ethernet to Filler A HMI / Ethernet (Wired)",
          })
          .locator("circle")
      )
      await expect(
        page.getByRole("dialog", { name: "Link details" })
      ).toBeVisible()
    })

    test("finds an off-screen match across networks and reveals link endpoints and protocol", async ({
      page,
      request,
      hasTouch,
    }) => {
      const plan = await createBaselinePlan(request)
      await page.goto(`/?plan=${plan.id}`)
      const activate = (control: Locator) =>
        hasTouch ? control.tap() : control.click()
      const picker = page.getByRole("button", {
        name: lastNetwork,
        exact: true,
      })
      await page
        .getByRole("button", { name: firstNetwork, exact: true })
        .click()
      const search = page.getByRole("searchbox", { name: "Search plan" })
      const results = page.getByRole("list", { name: "Search results" })
      const farResult = results.getByRole("button", {
        name: /Filler B PLC.*Filler B \/ Machine LAN/,
      })
      const canvas = page.getByRole("region", { name: topologyCanvas })
      const farPlc = canvas.getByRole("button", {
        name: "Filler B PLC",
        exact: true,
      })
      await expect(farPlc).toHaveCount(0)

      await search.fill("PLC")
      await expect(farResult).toBeVisible()
      await search.fill(sharedMachineAddress)
      await expect(results.getByRole("button")).toHaveCount(2)
      await expect(
        results.getByRole("button", {
          name: /Filler A PLC.*Filler A \/ Machine LAN/,
        })
      ).toBeVisible()
      await activate(farResult)
      await expect(picker).toHaveAttribute("aria-pressed", "true")
      await expect(farPlc).toBeInViewport({ ratio: 0.9 })
      await expect(farPlc).toHaveAttribute("aria-current", "true")

      await search.clear()
      await activate(
        canvas
          .getByRole("button", {
            name: "Filler B PLC / Ethernet to Controller 184 / Ethernet (Wireless)",
          })
          .locator("circle")
      )
      const inspector = page.getByRole("dialog", { name: "Link details" })
      await expect(
        inspector.getByText("Filler B PLC / Ethernet", { exact: true })
      ).toBeVisible()
      await expect(
        inspector.getByText("Controller 184 / Ethernet", { exact: true })
      ).toBeVisible()
      await expect(
        inspector.getByText("Generic IP", { exact: true })
      ).toBeVisible()
      await activate(inspector.getByRole("button", { name: "Close" }))

      await activate(farPlc)
      const component = page.getByRole("dialog", { name: "Filler B PLC" })
      await expect(component).toBeVisible()
      await expect(
        component.getByRole("button", { name: "Move", exact: true })
      ).toHaveCount(0)
    })

    test("edits a filtered and sorted interface and inspects its connection", async ({
      page,
      hasTouch,
    }) => {
      const plan = await createBaselinePlan(page.request)
      await page.goto(`/?plan=${plan.id}`)
      const activate = (control: Locator) =>
        hasTouch ? control.tap() : control.click()
      await activate(page.getByRole("button", { name: "Table", exact: true }))
      const table = page.getByRole("table", { name: "Interfaces", exact: true })
      const rows = table.getByRole("rowgroup").last().getByRole("row")
      await expect(rows).toHaveCount(250)
      const filter = page.getByRole("searchbox", { name: "Search component" })
      await filter.fill("Filler A HMI")
      await expect(rows).toHaveCount(2)
      const sort = table.getByRole("button", {
        name: "IPv4 address",
        exact: true,
      })
      await activate(sort)
      await expect(rows.first()).toContainText("Auxiliary")
      const ethernetAddress = table.getByRole("textbox", {
        name: "IPv4 address for Filler A HMI / Ethernet",
      })
      await ethernetAddress.fill("192.168.1.73")
      await activate(sort)
      await expect(rows.first()).toContainText("Ethernet")
      await filter.fill("Auxiliary")
      await expect(ethernetAddress).toHaveCount(0)
      const save = page.getByRole("button", {
        name: "Save interface",
        exact: true,
      })
      await activate(save)
      await expect(save).toBeHidden()
      await filter.fill("Filler A HMI")
      await expect(ethernetAddress).toHaveValue("192.168.1.73")
      await filter.fill("")

      await activate(page.getByRole("button", { name: "Diagram", exact: true }))
      await activate(
        page
          .getByRole("button", { name: /Filler A PLC.* to Filler A HMI/ })
          .locator("circle")
      )
      const inspector = page.getByRole("dialog", { name: "Link details" })
      const target = inspector.getByRole("group", { name: "Target" })
      await expect(
        target.getByText("192.168.1.73", { exact: true })
      ).toBeVisible()
      await expect(inspector.getByLabel("Protocol (optional)")).toHaveValue(
        "PROFINET"
      )
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBe(width)
    })
  })
}

test("fit all visible diagram items and refit a filtered network", async ({
  page,
}) => {
  const plan = await createBaselinePlan(page.request)
  await page.goto(`/?plan=${plan.id}`)
  const canvas = page.getByRole("region", { name: "Topology canvas" })
  const fit = page.getByRole("button", { name: "Fit to view" })
  async function verifyFit() {
    await fit.click()
    const clipped = await canvas.evaluate((frame) => {
      const rect = frame.getBoundingClientRect()
      return Array.from(
        frame.querySelectorAll('button, [role="button"], [role="group"]')
      )
        .filter((item) => {
          const box = item.getBoundingClientRect()
          return (
            box.left < rect.left - 1 ||
            box.top < rect.top - 1 ||
            box.right > rect.left + frame.clientWidth + 1 ||
            box.bottom > rect.top + frame.clientHeight + 1
          )
        })
        .map((item) => item.getAttribute("aria-label"))
    })
    expect(clipped).toEqual([])
  }
  await verifyFit()
  const zoom = page.getByRole("button", { name: "Reset zoom" })
  const allZoom = parseInt(await zoom.innerText())
  await page.getByRole("button", { name: lastNetwork, exact: true }).click()
  await verifyFit()
  expect(parseInt(await zoom.innerText())).toBeGreaterThan(allZoom)
  await page
    .getByRole("searchbox", { name: "Search plan" })
    .fill("no-such-device")
  await expect(fit).toBeDisabled()
})
