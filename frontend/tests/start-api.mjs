import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const directory = await mkdtemp(join(tmpdir(), "nami-browser-"))
const api = spawn(
  "../run",
  ["--dev", "--urls", process.env.NAMI_TEST_API_ORIGIN],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      Database__Provider: "SQLite",
      Database__File: join(directory, "nami.db"),
    },
  }
)

api.on("error", (error) => {
  console.error(error)
  process.exitCode = 1
})
api.on("close", async (code) => {
  await rm(directory, { force: true, recursive: true })
  process.exitCode ||= code ?? 0
})
process.on("SIGTERM", () => api.kill())
