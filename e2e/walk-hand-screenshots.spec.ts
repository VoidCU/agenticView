/**
 * Walk-mode screenshots for round 8: the first-person hand mid-slap, a greeting (wave + reply bubble),
 * and a board opened from walk mode with the mouse free (a hover highlight and a drawn cursor marker
 * show where the real pointer is; headless screenshots never include the OS cursor).
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

type Probe = {
  store: { getState(): { agents: Record<string, { id: string; name: string }> } };
  agentPos(id: string): { x: number; z: number; walking?: boolean } | undefined;
  boardPose(spaceId: string): { yaw: number; face: [number, number, number] } | undefined;
  hand: { gesture: "slap" | "wave" | null; start: number; pin: number | null };
};
type Win = { __agenticviewTest?: Probe; __setWalking?: (v: boolean) => void; __teleportWalk?: (x: number, z: number, yaw?: number, pitch?: number) => void };

const SHOTS = "e2e/screenshots";

/** Freeze the hand at a given point of its gesture while a screenshot is taken (test-only pin). */
async function pinHand(page: import("@playwright/test").Page, gesture: "slap" | "wave" | null, atMs: number | null) {
  await page.evaluate(([g, t]) => {
    const h = (window as unknown as Win).__agenticviewTest!.hand;
    h.gesture = g as "slap" | "wave" | null;
    h.pin = t as number | null;
  }, [gesture, atMs] as const);
  await page.waitForTimeout(400);
}

/** Software-rendered frames are slow: keep the agents' current speech bubbles up for the screenshot. */
async function holdBubbles(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const store = (window as unknown as { __agenticviewTest: { store: { getState(): { bubbles: Record<string, { until: number }> }; setState(p: object): void } } }).__agenticviewTest.store;
    const bubbles = Object.fromEntries(Object.entries(store.getState().bubbles).map(([k, b]) => [k, { ...b, until: Date.now() + 8_000 }]));
    store.setState({ bubbles });
  });
}

/** The reaction bubble must be fully inside the viewport (it used to float above the top edge up close). */
async function expectInView(page: import("@playwright/test").Page, testId: string) {
  const vp = page.viewportSize()!;
  const b = (await page.getByTestId(testId).boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
}

test("walk mode: hand mid-slap, greeting, board with a free mouse", async ({ page }) => {
  test.setTimeout(240_000); // Atlas may first walk a round trip to a worker (two doorways each way).
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#token=${launchToken()}`);
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
  const bar = page.getByLabel(/Tell Atlas what to build/);
  await bar.fill("design the settings page");
  await bar.press("Enter");
  await expect(page.locator(".task-row", { hasText: "design the settings page" }).locator(".task-status", { hasText: /done/i }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-status='idle'] .tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });

  await page.evaluate(() => (window as unknown as Win).__setWalking?.(true));
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Win).__teleportWalk)).toBe("function");
  // Atlas may still be walking back to his desk from a visit (the office is no longer the centre room).
  await expect.poll(() => page.evaluate(() => {
    const w = window as unknown as Win;
    const atlas = Object.values(w.__agenticviewTest!.store.getState().agents).find((a) => a.name === "Atlas")!;
    return w.__agenticviewTest!.agentPos(atlas.id)?.walking;
  }), { timeout: 150_000 }).toBe(false);
  // Stand right next to Atlas (1.5 units), at eye height, looking at the robot.
  const face = (pitch = -0.12) => page.evaluate((pt) => {
    const w = window as unknown as Win;
    const atlas = Object.values(w.__agenticviewTest!.store.getState().agents).find((a) => a.name === "Atlas")!;
    const p = w.__agenticviewTest!.agentPos(atlas.id)!;
    const x = p.x + 1.05, z = p.z + 1.05;
    w.__teleportWalk!(x, z, Math.atan2(-(p.x - x), -(p.z - z)), pt);
  }, pitch);
  await face();
  await page.waitForTimeout(400);
  await expect(page.getByTestId("walk-hint")).toContainText("E slap · H say hi · G play RPS · C chat · Esc exit");

  // Slap: freeze the hand on its hit frame, press E, shoot while the agent's bubble is up.
  await pinHand(page, "slap", 130);
  await page.keyboard.press("e");
  await expect(page.getByTestId("bonk-bubble")).toBeVisible({ timeout: 3_000 });
  await holdBubbles(page);
  await page.waitForTimeout(250);
  await expect(page.getByTestId("bonk-bubble")).toBeVisible();
  await expectInView(page, "bonk-bubble");
  await page.screenshot({ path: `${SHOTS}/walk-hand-slap-light-1440x900.png` });
  await pinHand(page, null, null);

  // Greeting: wait out the shared cooldown, then H (hand frozen mid-wave).
  await page.waitForTimeout(2_200);
  await face();
  await pinHand(page, "wave", 380);
  await page.keyboard.press("h");
  await expect(page.getByTestId("greet-bubble")).toBeVisible({ timeout: 3_000 });
  await expect(page.getByTestId("greet-bubble")).toHaveText(/^(Hi!|Hey boss!|All good here\.|Hi! Busy, sorry\.|Hey — deep in a task\.|Hi boss, shipping!)$/);
  await holdBubbles(page);
  await page.waitForTimeout(250);
  await expectInView(page, "greet-bubble");
  await page.screenshot({ path: `${SHOTS}/walk-greet-light-1440x900.png` });
  await pinHand(page, null, null);

  // Board from walk mode with real pointer lock, then the free mouse over it.
  await page.evaluate(() => {
    const w = window as unknown as Win;
    const pose = w.__agenticviewTest!.boardPose("office")!;
    const x = pose.face[0] + Math.sin(pose.yaw) * 2.2;
    const z = pose.face[2] + Math.cos(pose.yaw) * 2.2;
    w.__teleportWalk!(x, z, Math.atan2(-(pose.face[0] - x), -(pose.face[2] - z)), -Math.atan2(1.7 - pose.face[1], 2.2));
  });
  await page.waitForTimeout(300);
  await page.mouse.click(720, 450);
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.tagName ?? null)).toBe("CANVAS");
  await page.mouse.click(720, 450);
  const board = page.getByRole("dialog", { name: /board/i });
  await expect(board).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  const row = board.getByRole("button", { name: "design the settings page" }).first();
  await row.hover();
  const box = (await row.boundingBox())!;
  const mx = box.x + box.width * 0.6;
  const my = box.y + box.height / 2;
  await page.mouse.move(mx, my);
  // Draw a cursor marker where the real (free) pointer is, for the screenshot only.
  await page.evaluate(([x, y]) => {
    const c = document.createElement("div");
    c.id = "e2e-cursor";
    c.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:22px solid #111;transform:rotate(-28deg);transform-origin:0 0;z-index:99999;pointer-events:none;filter:drop-shadow(0 0 1.5px #fff) drop-shadow(0 0 1.5px #fff)`;
    document.body.appendChild(c);
  }, [mx, my] as const);
  await page.screenshot({ path: `${SHOTS}/walk-board-free-mouse-light-1440x900.png` });
  await page.evaluate(() => document.getElementById("e2e-cursor")?.remove());
  // The free mouse works: Details expands the row; the title area opens the request's timeline in the
  // same dialog, and Esc steps back to the board before a second Esc closes it.
  await board.getByRole("button", { name: "Show details: design the settings page" }).first().click();
  await expect(board.getByRole("button", { name: "Hide details: design the settings page" }).first()).toHaveAttribute("aria-expanded", "true");
  await row.click();
  await expect(page.getByRole("dialog", { name: "Workflow · design the settings page" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(board).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(board).toBeHidden();
  await expect(page.locator(".walk-crosshair")).toBeVisible();
  await page.evaluate(() => (window as unknown as Win).__setWalking?.(false));
});
