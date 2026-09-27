/**
 * Round 14 review screenshots, light and dark, 1440x900:
 *  - walk-mode whiteboards drawn as the popup's pinned notes (Pod A's tasks, the Manager board's requests);
 *  - the Manager board popup's "View timeline" rows, and the request's workflow swapped into the dialog.
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
}
