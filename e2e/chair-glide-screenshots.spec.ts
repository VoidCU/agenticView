/**
 * A pushed chair left alone glides back to its desk pose (after CHAIR_HOME_AFTER_MS; the test backdates
 * the last push instead of waiting five minutes). Screenshots: pushed, mid-glide, home.
 */
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  return (JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string }).token;
}

type Chair = { id: string; x: number; z: number; baseX: number; baseZ: number; spin: number; pushable: boolean; touchedAt: number; gliding: boolean; dirty: boolean };
type Probe = { chairs(): Chair[]; chairField: { get(id: string): Chair | undefined } };

test("a pushed chair glides home smoothly", async ({ page }) => {
  if (!existsSync("e2e/screenshots")) mkdirSync("e2e/screenshots", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#token=${launchToken()}`);
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("1"); // focus the manager's office
  await page.waitForTimeout(1_500);
  const id = await page.evaluate(() => (window as unknown as { __agenticviewTest: Probe }).__agenticviewTest.chairs().find((c) => c.pushable && c.id.endsWith("#v0"))!.id);
  // "Push" it: 0.9 units off with a swivel, touched just now.
  await page.evaluate((cid) => {
    const c = (window as unknown as { __agenticviewTest: Probe }).__agenticviewTest.chairField.get(cid)!;
    c.x += 0.9;
    c.z -= 0.5;
    c.spin = 0.45;
    c.touchedAt = performance.now();
    c.dirty = true;
  }, id);
  await page.waitForTimeout(1_500);
  // Still pushed: five minutes have not passed.
  expect((await page.evaluate((cid) => (window as unknown as { __agenticviewTest: Probe }).__agenticviewTest.chairs().find((c) => c.id === cid)!, id)).gliding).toBe(false);
  await page.screenshot({ path: "e2e/screenshots/chair-pushed-light-1440x900.png" });
  // Backdate the push past the idle time: the next once-a-second check starts the glide.
  await page.evaluate((cid) => { (window as unknown as { __agenticviewTest: Probe }).__agenticviewTest.chairField.get(cid)!.touchedAt = performance.now() - 5 * 60_000 - 1; }, id);
  await expect.poll(() => page.evaluate((cid) => (window as unknown as { __agenticviewTest: Probe }).__agenticviewTest.chairs().find((c) => c.id === cid)!.gliding, id), { timeout: 3_000, intervals: [50] }).toBe(true);
  // Sample the glide: it moves toward home monotonically, never teleports.
  const samples: number[] = [];
  for (let i = 0; i < 8; i++) {
    samples.push(await page.evaluate((cid) => { const c = (window as unknown as { __agenticviewTest: Probe }).__agenticviewTest.chairs().find((ch) => ch.id === cid)!; return Math.hypot(c.x - c.baseX, c.z - c.baseZ); }, id));
    if (i === 2) await page.screenshot({ path: "e2e/screenshots/chair-gliding-light-1440x900.png" });
    await page.waitForTimeout(120);
  }
  for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]! + 1e-9);
  expect(samples.some((d) => d > 0.02 && d < 1.0)).toBe(true); // caught mid-way, not a jump
  await expect.poll(() => page.evaluate((cid) => { const c = (window as unknown as { __agenticviewTest: Probe }).__agenticviewTest.chairs().find((ch) => ch.id === cid)!; return [c.gliding, Math.hypot(c.x - c.baseX, c.z - c.baseZ), c.spin]; }, id), { timeout: 5_000 }).toEqual([false, 0, 0]);
  await page.screenshot({ path: "e2e/screenshots/chair-home-light-1440x900.png" });
});
