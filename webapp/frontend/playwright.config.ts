import { defineConfig } from "@playwright/test";

const BE = "http://127.0.0.1:11056";
const FE = "http://127.0.0.1:11057";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  retries: 1,
  use: {
    baseURL: FE,
    headless: true,
    screenshot: "only-on-failure",
  },
});
