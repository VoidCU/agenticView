/**
 * Round 12: walk mode now starts in My Office, facing WALL_SCREEN (the social hub screen), instead
 * of in front of the manager: one step behind the pushable desk chair, so the chair stays put.
 * This captures that first-person view in light and dark.
 *
 * Runs when AGENTICVIEW_SCREENSHOTS=1 npm run test:e2e.
 * Saved to e2e/screenshots/ (gitignored).
 */
import { test, expect, type Page } from "@playwright/test";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";

// See overview-screenshots.spec.ts: tracing is not useful for screenshot-only specs and can error
// on Windows when test-results/ does not exist.
test.use({ trace: "off" });

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  return (JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string }).token;
}

function ensureScreenshotsDir() {
  mkdirSync("e2e/screenshots", { recursive: true });
}

type Win = { __setWalking?: (v: boolean) => void; __walkPos?: () => { x: number; z: number; yaw: number } };

test.describe("walk mode starts in My Office, facing the wall screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme}: first-person view of the My Office wall screen`, async ({ page }) => {
      ensureScreenshotsDir();
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/#token=${launchToken()}`);
      await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1_500);

      await page.evaluate(() => (window as unknown as Win).__setWalking?.(true));
      await expect.poll(() => page.evaluate(() => typeof (window as unknown as Win).__walkPos)).toBe("function");
      // Give the WalkMode camera a couple of frames to settle at its My Office start position.
      await page.waitForTimeout(500);

      // The walker starts a step behind the pushable desk chair (walkStartPose), inside My Office,
      // and arriving there never shoves the chair off its home spot.
      const probe = await page.evaluate(() => {
        const w = window as unknown as Win & {
          __agenticviewTest?: {
            spaces(): { id: string; kind: string; x: number; z: number }[];
            chairs(): { id: string; x: number; z: number; baseX: number; baseZ: number; gliding: boolean }[];
          };
        };
        const room = w.__agenticviewTest!.spaces().find((s) => s.kind === "myoffice")!;
        const chair = w.__agenticviewTest!.chairs().find((c) => c.id === `${room.id}#u`);
        return { room, pos: w.__walkPos!(), chair };
      });
      expect(Math.hypot(probe.pos.x - probe.room.x, probe.pos.z - probe.room.z)).toBeLessThan(1);
      expect(probe.chair, "My Office desk chair").toBeDefined();
      expect(Math.hypot(probe.chair!.x - probe.chair!.baseX, probe.chair!.z - probe.chair!.baseZ)).toBeLessThan(0.02);
      expect(probe.chair!.gliding).toBe(false);

      await page.screenshot({ path: `e2e/screenshots/round12-walk-myoffice-wallscreen-${theme}-1440x900.png` });

      await page.evaluate(() => (window as unknown as Win).__setWalking?.(false));
    });
  }
});
