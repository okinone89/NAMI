import { request, type FullConfig } from "@playwright/test"
import { editorPassword } from "./workspace-settings"

export default async function setupEditor(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL
  if (!baseURL) throw new Error("The browser tests require a base URL.")
  await ensurePassword(baseURL)
  const destination = process.env.NAMI_TEST_TRANSFER_DESTINATION
  if (destination) await ensurePassword(destination)
}

async function ensurePassword(baseURL: string) {
  const api = await request.newContext({ baseURL })
  try {
    const response = await api.post("/api/editor-session/setup", {
      data: { password: editorPassword, confirmation: editorPassword },
    })
    if (response.status() === 201) return
    if (response.status() === 409) {
      const unlock = await api.post("/api/editor-session", {
        data: { password: editorPassword },
      })
      if (unlock.ok()) return
      throw new Error(
        "The browser test database has a different editor password."
      )
    }
    throw new Error(
      `Editor password setup failed with HTTP ${response.status()}.`
    )
  } finally {
    await api.dispose()
  }
}
