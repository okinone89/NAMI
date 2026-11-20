import { expect, test } from "@playwright/test"
import { editorPassphrase, workspaceAction } from "./workspace-settings"

test("edit independent profiles on one gateway interface and reopen them in either view", async ({
  page,
}) => {
  const session = await page.request.post("/api/editor-session", {
    data: { passphrase: editorPassphrase },
  })
  expect(session.ok()).toBe(true)
  const created = await page.request.post("/api/plans", {
    data: { name: "Meter skid" },
  })
  expect(created.status()).toBe(201)
  const plan = await created.json()
  const initialized = await page.request.put(`/api/plans/${plan.id}`, {
    data: {
      ...plan,
      networks: [{ id: "plant", name: "Plant" }],
      components: [{ id: "gateway", name: "Main gateway", type: "Gateway" }],
      interfaces: [
        {
          id: "gateway-lan",
          componentId: "gateway",
          name: "LAN",
          networkId: "plant",
          ipv4: "192.0.2.10",
        },
      ],
    },
  })
  expect(initialized.ok()).toBe(true)

  await page.goto(`/?plan=${plan.id}`)
  const diagram = page.getByRole("region", { name: "Diagram", exact: true })
  await diagram
    .getByRole("button", { name: "Main gateway", exact: true })
    .click()
  const editor = page.getByRole("dialog", { name: "Main gateway" })
  const port = editor.getByRole("group", { name: "LAN", exact: true })
  const addProfile = async (name: string) => {
    await port.getByRole("button", { name: "Add protocol profile" }).click()
    await port.getByRole("button", { name: `Add ${name}`, exact: true }).click()
  }
  const save = async () => {
    await editor.getByRole("button", { name: "Save component" }).click()
    await expect(editor).toBeHidden()
  }

  await addProfile("EtherNet/IP")
  await addProfile("PROFINET")
  await port.getByLabel("Station name").fill("skid-a")
  await port.getByLabel("IO controller").check()
  await port.getByLabel("IO device").check()
  await addProfile("Modbus TCP")
  await port.getByLabel("Modbus role").selectOption("server")
  await port.getByLabel("Server TCP port").fill("1502")
  for (const [index, name, unitId] of [
    [1, "Meter A", "1"],
    [2, "Meter B", "2"],
  ] as const) {
    await port.getByRole("button", { name: "Add downstream device" }).click()
    const row = port.getByRole("group", { name: `Downstream device ${index}` })
    await row.getByLabel("Device name").fill(name)
    await row.getByLabel("Unit ID").fill(unitId)
  }
  await save()
  await page.reload()
  await page.getByRole("button", { name: "Table", exact: true }).click()
  const table = page.getByRole("region", { name: "Table", exact: true })
  await table.getByRole("button", { name: "Main gateway", exact: true }).click()
  await expect(port.getByLabel("EtherNet/IP device class")).toHaveValue("")
  await port.getByLabel("EtherNet/IP device class").selectOption("scanner")
  await save()

  await workspaceAction(page, "Sign out")
  await table.getByRole("button", { name: "Main gateway", exact: true }).click()
  await expect(editor.getByText("Scanner", { exact: true })).toBeVisible()
  await expect(editor.getByText("skid-a", { exact: true })).toBeVisible()
  await expect(editor.getByText("IO controller, IO device")).toBeVisible()
  await expect(editor.getByText("Server", { exact: true })).toBeVisible()
  await expect(editor.getByText("1502", { exact: true })).toBeVisible()
  await expect(editor.getByText("Meter A")).toBeVisible()
  await expect(editor.getByText("Meter B")).toBeVisible()
  await expect(editor.getByText("Unit ID 1")).toBeVisible()
  await expect(editor.getByText("Unit ID 2")).toBeVisible()
  await expect(editor.getByText("192.0.2.10", { exact: true })).toHaveCount(1)
  await expect(editor.getByText("Plant", { exact: true })).toHaveCount(1)
  await expect(
    editor.getByRole("button", { name: "Save component" })
  ).toBeHidden()
})
