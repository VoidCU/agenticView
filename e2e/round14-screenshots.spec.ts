/**
 * Round 14 review screenshots, light and dark, 1440x900:
 *  - walk-mode whiteboards drawn as the popup's pinned notes (Pod A's tasks, the Manager board's requests);
 *  - the Manager board popup's "View timeline" rows, and the request's workflow swapped into the dialog;
 *  - C near an agent in walk mode: its chat opens expanded and focused; Esc collapses it and walking resumes;
 *  - an overview click on an agent opens its chat (never the game); Play RPS in the chat header.
 *
 * Runs when AGENTICVIEW_SCREENSHOTS=1 npm run test:e2e. Saved to e2e/screenshots/ (gitignored).
 */
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";
import { faceBoard, seedPinnedBoards } from "./seedBoards";

// Tracing is not useful for screenshot-only specs and can error on Windows (see overview-screenshots).
test.use({ trace: "off", viewport: { width: 1440, height: 900 } });

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  return (JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string }).token;
}

type Win = { __setWalking?: (v: boolean) => void; __teleportWalk?: unknown };

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: walk-mode boards show the popup's pinned notes`, async ({ page }) => {
    mkdirSync("e2e/screenshots", { recursive: true });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    await seedPinnedBoards(page);
    await page.evaluate(() => (window as unknown as Win).__setWalking?.(true));
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as Win).__teleportWalk)).toBe("function");
    for (const [room, name] of [["pod-a", "pod"], ["office", "manager"]] as const) {
      await faceBoard(page, room, 1.9);
      await page.waitForTimeout(1_400); // the board texture redraws at most once a second
      await page.screenshot({ path: `e2e/screenshots/r14-walk-board-${name}-${theme}-1440x900.png` });
    }
    // Standing close and to the side: the notes stay on the face at an angle.
    await faceBoard(page, "pod-a", 1.2, 0.9);
    await page.waitForTimeout(1_400);
    await page.screenshot({ path: `e2e/screenshots/r14-walk-board-pod-oblique-${theme}-1440x900.png` });
    await page.evaluate(() => (window as unknown as Win).__setWalking?.(false));
  });

  test(`${theme}: Manager board rows open the request's timeline, Esc returns to the board`, async ({ page }) => {
    mkdirSync("e2e/screenshots", { recursive: true });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    const { requestId, requestTitle } = await seedPinnedBoards(page);
    await page.getByRole("button", { name: /Open Manager board from/ }).first().click();
    const board = page.getByTestId("manager-board");
    await expect(board).toBeVisible();
    const row = page.locator(`[data-request-id="${requestId}"]`);
    await expect(row.getByTestId("manager-view-timeline")).toBeVisible();
    await page.screenshot({ path: `e2e/screenshots/r14-manager-board-rows-${theme}-1440x900.png` });
    await row.getByTestId("manager-view-timeline").click();
    await expect(page.getByRole("dialog", { name: `Workflow · ${requestTitle}` })).toBeVisible();
    await expect(page.getByTestId("wf-step").first()).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.screenshot({ path: `e2e/screenshots/r14-manager-board-workflow-${theme}-1440x900.png` });
    await page.keyboard.press("Escape");
    await expect(board).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Manager board" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test(`${theme}: C near an agent in walk mode opens its chat, typed into at once; Esc returns to walking`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync("e2e/screenshots", { recursive: true });
    await page.emulateMedia({ colorScheme: theme });
    // Start with the chat panel collapsed: C expands it, Esc collapses it again.
    await page.addInitScript(() => localStorage.setItem("av:hud:chat-collapsed", "true"));
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Expand chat" })).toBeVisible();
    type Probe = { store: { getState(): { agents: Record<string, { id: string; name: string }>; selectedAgentId?: string } }; agentPos(id: string): { x: number; z: number; walking?: boolean } | undefined };
    type W = Win & { __agenticviewTest?: Probe; __teleportWalk?: (x: number, z: number, yaw?: number, pitch?: number) => void };
    await page.evaluate(() => (window as unknown as W).__setWalking?.(true));
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as W).__teleportWalk)).toBe("function");
    await expect(page.getByTestId("walk-hint")).toContainText("C chat");
    // Stand about 1.4 units from Atlas (as the bonk shot does), looking at it.
    await expect.poll(() => page.evaluate(() => {
      const w = window as unknown as W;
      const atlas = Object.values(w.__agenticviewTest!.store.getState().agents).find((a) => a.name === "Atlas")!;
      return w.__agenticviewTest!.agentPos(atlas.id)?.walking;
    }), { timeout: 120_000 }).toBe(false);
    await page.evaluate(() => {
      const w = window as unknown as W;
      const atlas = Object.values(w.__agenticviewTest!.store.getState().agents).find((a) => a.name === "Atlas")!;
      const p = w.__agenticviewTest!.agentPos(atlas.id)!;
      const x = p.x + 1.0, z = p.z + 1.0;
      w.__teleportWalk!(x, z, Math.atan2(-(p.x - x), -(p.z - z)));
    });
    await page.waitForTimeout(300);
    await page.keyboard.press("c");
    const box = page.getByRole("textbox", { name: "Message Atlas" });
    await expect(box).toBeFocused({ timeout: 5_000 });
    await page.keyboard.type("can you check the sign-in flow?");
    await expect(box).toHaveValue("can you check the sign-in flow?");
    await page.screenshot({ path: `e2e/screenshots/r14-walk-chat-open-${theme}-1440x900.png` });
    await expect(page.locator(".app-walk-chat")).toHaveCount(1);
    await page.keyboard.press("Escape");
    // The chat column hides with the walk HUD again, and the panel is back to collapsed.
    await expect(page.locator(".app-walk-chat")).toHaveCount(0);
    await expect(box).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("av:hud:chat-collapsed"))).toBe("true");
    await expect(page.locator(".panel-tab-chat")).toHaveCount(1);
    await expect(page.locator(".walk-crosshair")).toBeVisible(); // still walking
    await expect(page.getByTestId("walk-hint")).toContainText("Click the view to look around");
    await page.screenshot({ path: `e2e/screenshots/r14-walk-chat-closed-${theme}-1440x900.png` });
    await page.evaluate(() => (window as unknown as W).__setWalking?.(false));
  });

  test(`${theme}: an overview click on an agent opens its chat; the game is one click further`, async ({ page }) => {
    mkdirSync("e2e/screenshots", { recursive: true });
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(() => localStorage.setItem("av:hud:chat-collapsed", "true"));
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Expand chat" })).toBeVisible();
    let plays = 0;
    await page.exposeFunction("__countPlay", () => { plays++; });
    await page.evaluate(() => window.addEventListener("agenticview:play-rps", () => (window as unknown as { __countPlay(): void }).__countPlay()));
    await page.locator("button.tag", { hasText: "Atlas" }).click();
    const chat = page.getByRole("complementary", { name: "Chat with Atlas" });
    await expect(chat).toBeVisible();
    await expect(chat.getByTestId("chat-play-rps")).toBeVisible();
    expect(plays).toBe(0); // the click opened the conversation, not the game
    await page.screenshot({ path: `e2e/screenshots/r14-overview-click-chat-${theme}-1440x900.png` });
    await chat.getByTestId("chat-play-rps").click();
    await expect(page.getByTestId("play-rps-modal")).toBeVisible();
    await page.screenshot({ path: `e2e/screenshots/r14-chat-play-rps-${theme}-1440x900.png` });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("play-rps-modal")).toBeHidden();
  });
}
