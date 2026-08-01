import { defineConfig } from "@playwright/test";

const requestedPort = process.env.PLAYWRIGHT_PORT;
const port = requestedPort && /^\d+$/.test(requestedPort)
  ? Number(requestedPort)
  : 5173;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/layout",
  testMatch: "**/*.pw.ts",
  fullyParallel: true,
  workers: 2,
  reporter: "line",
  use: {
    baseURL,
    channel: "chromium",
    headless: true,
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
  },
});
