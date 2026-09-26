/**
 * Board redesign screenshots: pod board (5-col grid, cork, pinned cards)
 * and manager board, in light and dark themes, at 1920x1080 and 1280x800.
 *
 * Runs against the same fake server as smoke.spec.ts.
 * Screenshots saved alongside this file (or in test-results/).
 */
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  const inst = JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string };
  return inst.token;
}

/** Seed the manager with a task and wait for Atlas to finish, creating delegated sub-tasks. */
async function seedTasks(page: import("@playwright/test").Page) {
  const bar = page.getByLabel(/Tell Atlas what to build/);
  await bar.fill("build a login page");
  await bar.press("Enter");
  await expect(
    page.locator(".task-row", { hasText: "build a login page" })
      .locator(".task-status", { hasText: /done/i })
      .first(),
  ).toBeVisible({ timeout: 30_000 });
}

const viewports = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1280x800", width: 1280, height: 800 },
];

for (const vp of viewports) {
  test.describe(`board screenshots at ${vp.name}`, () => {
    test.use({ viewport: vp });

    test(`pod board + sheet, manager board — light theme ${vp.name}`, async ({ page }) => {
      await page.goto(`/#token=${launchToken()}`);
      await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });

      // Seed tasks so the manager board has content
      await seedTasks(page);

      // --- Manager board ---
      const managerBtn = page.locator(".board-open").first();
      if (await managerBtn.isVisible()) {
        await managerBtn.click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
        await page.screenshot({ path: `e2e/screenshots/manager-board-light-${vp.name}.png`, fullPage: false });
        await page.keyboard.press("Escape");
      }

      // --- Pod board: create an agent, open the pod board ---
      await page.getByRole("button", { name: /new agent/i }).first().click();
      const agentName = `Worker${Date.now().toString(36).slice(-4)}`;
      await page.getByPlaceholder("Nova").fill(agentName);
      await page.getByRole("button", { name: "Create agent" }).click();
      await expect(page.locator(".tag-name", { hasText: agentName })).toBeVisible({ timeout: 15_000 });

      // Find the pod board button for this agent's pod
      const podBtns = page.locator(".board-open");
      const count = await podBtns.count();
      if (count > 0) {
        // Click the last board button (most likely the pod just created)
        await podBtns.last().click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
        await page.screenshot({ path: `e2e/screenshots/pod-board-light-${vp.name}.png`, fullPage: false });

        // Click a card if there is one to show the sheet
        const card = page.locator('[data-testid="kanban-card"]').first();
        if (await card.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await card.click();
          await expect(page.locator('[data-testid="task-drawer"]')).toBeVisible({ timeout: 3_000 });
          await page.screenshot({ path: `e2e/screenshots/pod-board-sheet-light-${vp.name}.png`, fullPage: false });
        }
        await page.keyboard.press("Escape");
      }
    });

    test(`pod board + sheet, manager board — dark theme ${vp.name}`, async ({ page }) => {
      // Emulate dark color scheme
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`/#token=${launchToken()}`);
      await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });

      await seedTasks(page);

      // Manager board in dark
      const managerBtn = page.locator(".board-open").first();
      if (await managerBtn.isVisible()) {
        await managerBtn.click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
        await page.screenshot({ path: `e2e/screenshots/manager-board-dark-${vp.name}.png`, fullPage: false });
        await page.keyboard.press("Escape");
      }

      // Pod board in dark
      const podBtns = page.locator(".board-open");
      const count = await podBtns.count();
      if (count > 0) {
        await podBtns.last().click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
        await page.screenshot({ path: `e2e/screenshots/pod-board-dark-${vp.name}.png`, fullPage: false });

        const card = page.locator('[data-testid="kanban-card"]').first();
        if (await card.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await card.click();
          await expect(page.locator('[data-testid="task-drawer"]')).toBeVisible({ timeout: 3_000 });
          await page.screenshot({ path: `e2e/screenshots/pod-board-sheet-dark-${vp.name}.png`, fullPage: false });
        }
        await page.keyboard.press("Escape");
      }
    });
  });
}
