import { expect, type APIRequestContext } from "@playwright/test"
import type { Component, Plan, PlanLink } from "../../src/lib/plans"
import { editorPassword } from "../workspace-settings"

export const sharedMachineAddress = "192.168.1.10"

export async function createBaselinePlan(request: APIRequestContext) {
  const session = await request.post("/api/editor-session", {
    data: { password: editorPassword },
  })
  expect(session.ok()).toBe(true)
  const created = await request.post("/api/plans", {
    data: { name: "Packaging line baseline" },
  })
  expect(created.status()).toBe(201)
  const plan: Plan = await created.json()

  const networks = Array.from({ length: 10 }, (_, index) => ({
    id: `cell-${index}`,
    name:
      index === 0
        ? "Filler A / Machine LAN"
        : index === 9
          ? "Filler B / Machine LAN"
          : `Machine LAN ${index + 1}`,
    subnet: index === 0 || index === 9 ? "192.168.1.0/24" : null,
    position: { x: 24, y: 24 + index * 1100 },
  }))
  const featured: Record<number, Partial<Component>> = {
    0: { name: "Filler A PLC", type: "PLC" },
    1: { name: "Filler A HMI", type: "HMI", position: { x: 24, y: 235 } },
    2: { name: "Cell switch", type: "Switch", position: { x: 320, y: 94 } },
    3: { name: "Edge server", type: "Server", position: { x: 24, y: 390 } },
    4: {
      name: "Historian VM",
      type: "VM",
      hostId: "device-3",
      position: { x: 24, y: 518 },
    },
    180: { name: "Filler B PLC", type: "PLC" },
  }
  const components: Component[] = Array.from({ length: 200 }, (_, index) => {
    const cell = Math.floor(index / 20)
    const slot = index % 20
    return {
      id: `device-${index}`,
      name: `Controller ${index + 1}`,
      type: "PLC",
      hostId: null,
      position: {
        x:
          cell === 0 && slot >= 5
            ? 320 + (slot % 2) * 208
            : 24 + (slot % 3) * 236,
        y:
          cell === 0 && slot >= 5
            ? 209 + Math.floor((slot - 5) / 2) * 115
            : networks[cell].position.y + 70 + Math.floor(slot / 3) * 115,
      },
      ...featured[index],
    }
  })
  const interfaces = components.flatMap(({ id }, index) => {
    const cell = Math.floor(index / 20)
    const port = {
      id: `${id}-eth0`,
      componentId: id,
      name: index === 4 ? "vNIC 1" : "Ethernet",
      networkId: networks[cell].id,
      ipv4: networks[cell].subnet
        ? `192.168.1.${10 + (index % 20)}`
        : `10.40.${cell}.${10 + (index % 20)}`,
      ...(index === 0 && {
        protocolProfiles: {
          profinet: { stationName: "filler-a", roles: ["device"] },
        },
      }),
    }
    return index < 50
      ? [
          port,
          {
            ...port,
            id: `${id}-aux`,
            name: "Auxiliary",
            ipv4: null,
            protocolProfiles: undefined,
          },
        ]
      : [port]
  })
  const links: PlanLink[] = [
    {
      id: "filler-a-link",
      source: { componentId: "device-0", interfaceId: "device-0-eth0" },
      target: { componentId: "device-1", interfaceId: "device-1-eth0" },
      medium: "wired",
      protocol: "PROFINET",
    },
    {
      id: "historian-link",
      source: { componentId: "device-3", interfaceId: null },
      target: { componentId: "device-4", interfaceId: "device-4-eth0" },
      medium: "virtual",
      protocol: "Generic IP",
    },
    {
      id: "filler-b-link",
      source: { componentId: "device-180", interfaceId: "device-180-eth0" },
      target: { componentId: "device-183", interfaceId: "device-183-eth0" },
      medium: "wireless",
      protocol: "Generic IP",
    },
  ]
  const saved = await request.put(`/api/plans/${plan.id}`, {
    data: { ...plan, networks, components, interfaces, links },
  })
  expect(saved.status(), await saved.text()).toBe(200)
  return (await saved.json()) as Plan
}
