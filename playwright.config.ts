import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/layout",
  testMatch: "**/*.pw.ts",
  fullyParallel: true,
  workers: 2,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: "chromium",
    headless: true,
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
});
