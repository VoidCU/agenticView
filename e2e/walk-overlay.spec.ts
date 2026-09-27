/**
 * Walk mode: clicking a whiteboard opens its board AND hands the mouse back (pointer lock released, walk
 * paused), the board is fully usable, and closing it keeps you walking; a click on the view re-locks.
 * Uses real mouse clicks so the browser's pointer lock is really taken and released.
 */
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  return (JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string }).token;
}

type Probe = { boardPose(spaceId: string): { yaw: number; face: [number, number, number] } | undefined };
type Win = { __agenticviewTest?: Probe; __setWalking?: (v: boolean) => void; __teleportWalk?: (x: number, z: number, yaw?: number, pitch?: number) => void };

test("a board opened from walk mode frees the mouse, works, and walking resumes after", async ({ page }) => {
  await page.goto(`/#token=${launchToken()}`);
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
  const bar = page.getByLabel(/Tell Atlas what to build/);
  await bar.fill("walk overlay check");
  await bar.press("Enter");
  await expect(page.locator(".task-row", { hasText: "walk overlay check" }).locator(".task-status", { hasText: /done/i }).first()).toBeVisible({ timeout: 30_000 });

  await page.evaluate(() => (window as unknown as Win).__setWalking?.(true));
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Win).__teleportWalk)).toBe("function");
  // Stand 2.2 in front of the manager's whiteboard, looking at it.
  await page.evaluate(() => {
    const w = window as unknown as Win;
    const pose = w.__agenticviewTest!.boardPose("office")!;
    const x = pose.face[0] + Math.sin(pose.yaw) * 2.2;
    const z = pose.face[2] + Math.cos(pose.yaw) * 2.2;
    w.__teleportWalk!(x, z, Math.atan2(-(pose.face[0] - x), -(pose.face[2] - z)), -Math.atan2(1.7 - pose.face[1], 2.2));
  });
  await page.waitForTimeout(300);
  const vp = page.viewportSize()!;
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const lockedOnCanvas = () => page.evaluate(() => document.pointerLockElement?.tagName ?? null);

  // First click captures the mouse.
  await page.mouse.click(cx, cy);
  await expect.poll(lockedOnCanvas).toBe("CANVAS");
  await expect(page.getByTestId("walk-hint")).not.toContainText("Click the view");
  // The capturing click must not also open the board (R3F click at the frozen mouse position: the old bug).
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Second click (locked, crosshair on the board) opens the board and releases pointer lock.
  await page.mouse.click(cx, cy);
  const board = page.getByRole("dialog", { name: /board/i });
  await expect(board).toBeVisible({ timeout: 15_000 });
  await expect.poll(lockedOnCanvas).toBeNull();
  await expect(page.locator(".walk-crosshair")).toBeVisible(); // still walking

  // The cursor works over the board: expand a request row with a real click.
  const details = board.getByRole("button", { name: "Show details: walk overlay check" }).first();
  await details.click();
  await expect(board.getByRole("button", { name: "Hide details: walk overlay check" }).first()).toHaveAttribute("aria-expanded", "true");

  // The request's timeline swaps into the same dialog; the mouse stays free; Esc steps back to the board.
  await board.getByRole("button", { name: "View timeline: walk overlay check" }).first().click();
  const workflow = page.getByRole("dialog", { name: "Workflow · walk overlay check" });
  await expect(workflow).toBeVisible();
  await expect(workflow.getByTestId("wf-step").first()).toBeVisible();
  expect(await lockedOnCanvas()).toBeNull();
  await page.keyboard.press("Escape");
  await expect(board).toBeVisible();
  expect(await lockedOnCanvas()).toBeNull();

  // Close: still walking, the hint asks for a click, which re-locks.
  await page.keyboard.press("Escape");
  await expect(board).toBeHidden();
  await expect(page.locator(".walk-crosshair")).toBeVisible();
  // Some browsers re-grant the lock on the closing gesture; otherwise the view click does it.
  if ((await lockedOnCanvas()) === null) {
    await expect(page.getByTestId("walk-hint")).toContainText("Click the view");
    await page.mouse.click(cx, cy - 200);
  }
  await expect.poll(lockedOnCanvas).toBe("CANVAS");
  await expect(page.getByTestId("walk-hint")).not.toContainText("Click the view");
  await page.keyboard.press("Escape");
  await expect(page.locator(".walk-crosshair")).toBeHidden();
});

test("walk mode hides the floating HTML labels (board pills, Manager board, pad label) and Esc brings them back", async ({ page }) => {
  await page.goto(`/#token=${launchToken()}`);
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
  const overlays = page.locator(".board-open, .pad-btn, .file-chips");
  await expect(page.locator(".board-open").first()).toBeAttached();
  await expect(page.locator(".pad-btn").first()).toBeAttached();
  await page.evaluate(() => (window as unknown as Win).__setWalking?.(true));
  await expect(page.locator(".walk-crosshair")).toBeVisible();
  await expect(overlays).toHaveCount(0);
  await expect(page.locator(".tag-name")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".walk-crosshair")).toBeHidden();
  await expect(page.locator(".board-open").first()).toBeAttached();
  await expect(page.locator(".pad-btn").first()).toBeAttached();
});
