import { defineConfig } from "@playwright/test"
import { editorPassphrase } from "./tests/workspace-settings"

const webPort = process.env.NAMI_TEST_WEB_PORT ?? "5174"
const webOrigin = `http://127.0.0.1:${webPort}`
const apiOrigin = `http://127.0.0.1:${process.env.NAMI_TEST_API_PORT ?? "5081"}`

const apiServer = {
  command: "node tests/start-api.mjs",
  env: {
    NAMI_TEST_API_ORIGIN: webOrigin,
    Editor__Passphrase: editorPassphrase,
  },
  url: `${webOrigin}/health`,
  timeout: 120_000,
  gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
} as const

export default defineConfig({
  testDir: "./tests",
  use: { baseURL: webOrigin },
  projects: [
    { name: "desktop", use: { viewport: { width: 1024, height: 768 } } },
    {
      name: "phone",
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
  webServer:
    process.env.NAMI_TEST_USE_EXTERNAL_API === "1"
      ? [
          {
            command: `npm run dev -- --host 127.0.0.1 --port ${Number(webPort)} --strictPort`,
            env: { NAMI_API_ORIGIN: apiOrigin },
            url: webOrigin,
          },
        ]
      : [apiServer],
})
