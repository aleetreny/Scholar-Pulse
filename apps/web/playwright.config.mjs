import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  use: {
    channel: "chromium",
    baseURL: "http://127.0.0.1:4175/Scholar-Pulse",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve-static.mjs",
    url: "http://127.0.0.1:4175/Scholar-Pulse/",
    reuseExistingServer: false,
  },
});
