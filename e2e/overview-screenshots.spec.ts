/**
 * Overview screenshots: light and dark themes showing bigger rooms (HEX_R = 7),
 * 6-desk pods (2 rows of 3), and the lounge scoreboard placement facing the camera.
 *
 * Runs when AGENTICVIEW_SCREENSHOTS=1 npm run test:e2e.
 * Saved to e2e/screenshots/ (gitignored).
 */
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  const inst = JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string };
  return inst.token;
}

function ensureScreenshotsDir() {
  mkdirSync("e2e/screenshots", { recursive: true });
}

test.describe("office overview screenshots", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("light overview showing bigger rooms and scoreboard", async ({ page }) => {
    ensureScreenshotsDir();
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    // Let R3F scene and textures settle
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "e2e/screenshots/overview-light-1920x1080.png", fullPage: false });
  });

  test("dark overview showing bigger rooms and scoreboard", async ({ page }) => {
    ensureScreenshotsDir();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    // Let R3F scene and textures settle
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "e2e/screenshots/overview-dark-1920x1080.png", fullPage: false });
  });
});
