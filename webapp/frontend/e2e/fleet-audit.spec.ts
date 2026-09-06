import { test, expect } from "@playwright/test";

const BE = "http://127.0.0.1:11056";
const FE = "http://127.0.0.1:11057";

test.describe("Fleet Audit", () => {
  test("Backend health", async ({ request }) => {
    const resp = await request.get(`${BE}/health`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("giskard-mcp");
  });

  test("API: list tools", async ({ request }) => {
    const resp = await request.get(`${BE}/api/v1/tools`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.tools.some((t: any) => t.name === "run_fleet_scan")).toBe(true);
  });

  test("API: list scans", async ({ request }) => {
    const resp = await request.get(`${BE}/api/v1/scans`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.scans)).toBe(true);
  });

  test("API: diagnostics", async ({ request }) => {
    const resp = await request.get(`${BE}/api/v1/diagnostics`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(typeof body.total_scans).toBe("number");
  });

  test("Frontend loads", async ({ page }) => {
    await page.goto(FE, { timeout: 15000 });
    await page.waitForTimeout(3000);
    await expect(page.locator("#root")).toBeAttached();
  });
});
