/**
 * HUD screenshots: mini-map open/closed, tasks sidebar groups,
 * walk hint, scoreboard popup, and play popup mid-game.
 *
 * Runs against the same fake server as smoke.spec.ts.
 * Screenshots saved to e2e/screenshots/ (gitignored).
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


/** Seed the manager so the task board has some content. */
async function seedTasks(page: import("@playwright/test").Page) {
  const bar = page.getByLabel(/Tell Atlas what to build/);
  await bar.fill("write a login page");
  await bar.press("Enter");
  await expect(
    page.locator(".task-row", { hasText: "write a login page" })
      .locator(".task-status", { hasText: /done/i })
      .first(),
  ).toBeVisible({ timeout: 30_000 });
}

async function seedLoungeAgent(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: /new agent/i }).first().click();
  await page.getByPlaceholder("Nova").fill(name);
  await page.getByRole("button", { name: "Create agent" }).click();
  const robotTag = page.locator(".tag-name", { hasText: name });
  await expect(robotTag).toBeVisible({ timeout: 15_000 });
  const agentId = await page.locator(".minimap-agent").evaluateAll((nodes, agentName) => {
    const target = nodes.find((node) => node.getAttribute("aria-label")?.startsWith(`${agentName},`));
    return target?.getAttribute("data-agent-id") ?? null;
  }, name);
  if (!agentId) throw new Error(`Mini-map did not publish ${name} yet`);
  await page.evaluate(async (id) => {
    const token = sessionStorage.getItem("agenticview.token") ?? "";
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`);
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error("Could not open test websocket")); });
    socket.send(JSON.stringify({ type: "agent.update", id, patch: { lounging: true } }));
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    socket.close();
  }, agentId);
  // When the live position has entered the Lounge, it may still be finishing its walk cycle.
  await expect(page.locator(`.minimap-agent[data-agent-id="${agentId}"]`)).toHaveAttribute("aria-label", new RegExp(`${name}, (?:In the lounge|Walking), Lounge`), { timeout: 50_000 });
}

const viewports = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1280x800", width: 1280, height: 800 },
];

for (const vp of viewports) {
  test.describe(`HUD screenshots at ${vp.name}`, () => {
    test.use({ viewport: vp });

    test(`HUD light: mini-map, tasks sidebar, walk hint, scoreboard — ${vp.name}`, async ({ page }) => {
      test.setTimeout(120_000);
      ensureScreenshotsDir();
      await page.addInitScript(() => localStorage.setItem("av:hud:show-tags", "true"));
      await page.goto(`/#token=${launchToken()}`);
      await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
      await seedTasks(page);
      await seedLoungeAgent(page, `LoungeLight${vp.name.replaceAll("x", "")}`);
      await page.screenshot({ path: `e2e/screenshots/hud-lounge-minimap-light-${vp.name}.png`, fullPage: false });

      // --- Mini-map OPEN ---
      // The mini-map starts open by default; ensure it's open
      const minimap = page.locator(".minimap-wrap, [data-testid='minimap'], .minimap");
      const minimapVisible = await minimap.first().isVisible().catch(() => false);
      if (!minimapVisible) {
        // Open via M key
        await page.keyboard.press("m");
        await page.waitForTimeout(300);
      }
      await page.screenshot({ path: `e2e/screenshots/hud-minimap-open-light-${vp.name}.png`, fullPage: false });

      // --- Mini-map CLOSED ---
      await page.keyboard.press("m");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e/screenshots/hud-minimap-closed-light-${vp.name}.png`, fullPage: false });

      // Re-open for subsequent shots
      await page.keyboard.press("m");
      await page.waitForTimeout(200);

      // --- Tasks sidebar groups ---
      // Make sure tasks panel is visible (T to open if needed)
      await page.screenshot({ path: `e2e/screenshots/hud-tasks-sidebar-light-${vp.name}.png`, fullPage: false });
      await page.getByTestId("tags-toggle").click();
      await page.locator(".task-panel-toggle").click();
      await page.getByTestId("chat-toggle").click();
      await page.screenshot({ path: `e2e/screenshots/hud-collapsed-tags-off-light-${vp.name}.png`, fullPage: false });
      await page.keyboard.press("t");
      await page.getByTestId("chat-toggle").click();

      // --- Scoreboard popup (before board, clean state) ---
      await page.evaluate(() => window.dispatchEvent(new Event("agenticview:open-scoreboard")));
      await page.locator('[role="dialog"]').waitFor({ state: "visible", timeout: 8_000 });
      await page.screenshot({ path: `e2e/screenshots/hud-scoreboard-light-${vp.name}.png`, fullPage: false });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);

      // --- Walk hint ---
      const walkBtn = page.locator('[data-testid="walk-button"]');
      if (await walkBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await walkBtn.click();
        await expect(page.locator('[data-testid="walk-hint"]')).toBeVisible({ timeout: 3_000 });
        await page.screenshot({ path: `e2e/screenshots/hud-walk-hint-light-${vp.name}.png`, fullPage: false });
        // Exit walk mode via Escape
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
      }

      // --- Board detail sheet (open board and click a card if available) ---
      const boardBtns = page.locator(".board-open");
      if ((await boardBtns.count()) > 0) {
        await boardBtns.first().click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
        await page.screenshot({ path: `e2e/screenshots/hud-board-open-light-${vp.name}.png`, fullPage: false });
        const card = page.locator('[data-testid="kanban-card"]').first();
        if (await card.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await card.click();
          await expect(page.locator('[data-testid="task-drawer"]')).toBeVisible({ timeout: 3_000 });
          await page.screenshot({ path: `e2e/screenshots/hud-board-sheet-light-${vp.name}.png`, fullPage: false });
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
      }
    });

    test(`HUD dark: mini-map, tasks sidebar, walk hint, scoreboard — ${vp.name}`, async ({ page }) => {
      test.setTimeout(120_000);
      ensureScreenshotsDir();
      await page.emulateMedia({ colorScheme: "dark" });
      await page.addInitScript(() => localStorage.setItem("av:hud:show-tags", "true"));
      await page.goto(`/#token=${launchToken()}`);
      await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
      await seedTasks(page);
      await seedLoungeAgent(page, `LoungeDark${vp.name.replaceAll("x", "")}`);
      await page.screenshot({ path: `e2e/screenshots/hud-lounge-minimap-dark-${vp.name}.png`, fullPage: false });

      // Mini-map open
      await page.screenshot({ path: `e2e/screenshots/hud-minimap-open-dark-${vp.name}.png`, fullPage: false });

      // Mini-map closed
      await page.keyboard.press("m");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e/screenshots/hud-minimap-closed-dark-${vp.name}.png`, fullPage: false });
      await page.keyboard.press("m");
      await page.waitForTimeout(200);

      // Tasks sidebar
      await page.screenshot({ path: `e2e/screenshots/hud-tasks-sidebar-dark-${vp.name}.png`, fullPage: false });
      await page.getByTestId("tags-toggle").click();
      await page.locator(".task-panel-toggle").click();
      await page.getByTestId("chat-toggle").click();
      await page.screenshot({ path: `e2e/screenshots/hud-collapsed-tags-off-dark-${vp.name}.png`, fullPage: false });
      await page.keyboard.press("t");
      await page.getByTestId("chat-toggle").click();

      // Walk hint
      const walkBtnDark = page.locator('[data-testid="walk-button"]');
      if (await walkBtnDark.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await walkBtnDark.click();
        await expect(page.locator('[data-testid="walk-hint"]')).toBeVisible({ timeout: 3_000 });
        await page.screenshot({ path: `e2e/screenshots/hud-walk-hint-dark-${vp.name}.png`, fullPage: false });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
      }

      // Scoreboard popup (dark)
      await page.evaluate(() => window.dispatchEvent(new Event("agenticview:open-scoreboard")));
      await page.locator('[role="dialog"]').waitFor({ state: "visible", timeout: 8_000 });
      await page.screenshot({ path: `e2e/screenshots/hud-scoreboard-dark-${vp.name}.png`, fullPage: false });
      await page.keyboard.press("Escape");
    });

    test(`Play popup mid-game — light ${vp.name}`, async ({ page }) => {
      ensureScreenshotsDir();
      await page.addInitScript(() => localStorage.setItem("av:hud:show-tags", "true"));
      await page.goto(`/#token=${launchToken()}`);
      await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });

      // Create an agent so we can open the play popup
      await page.getByRole("button", { name: /new agent/i }).first().click();
      const agentName = `Player${Date.now().toString(36).slice(-4)}`;
      await page.getByPlaceholder("Nova").fill(agentName);
      await page.getByRole("button", { name: "Create agent" }).click();
      await expect(page.locator(".tag-name", { hasText: agentName })).toBeVisible({ timeout: 15_000 });

      // Get the new agent's id from the store
      const agentId = await page.evaluate((name: string) => {
        const agents = Object.values((window as unknown as { __agenticviewStore?: { getState(): { agents: Record<string, { id: string; name: string }> } } }).__agenticviewStore?.getState().agents ?? {});
        return agents.find((a) => a.name === name)?.id;
      }, agentName);

      if (agentId) {
        await page.evaluate((id: string) => {
          window.dispatchEvent(new CustomEvent("agenticview:play-rps", { detail: { agentId: id } }));
        }, agentId);
        await expect(page.locator('[data-testid="play-rps-modal"]')).toBeVisible({ timeout: 5_000 });
        await page.screenshot({ path: `e2e/screenshots/hud-play-rps-light-${vp.name}.png`, fullPage: false });

        // Click a move to send a play
        const rockBtn = page.locator('[data-testid="rps-move-rock"]');
        if (await rockBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await rockBtn.click();
          // Wait briefly for the round result animation
          await page.waitForTimeout(1_200);
          await page.screenshot({ path: `e2e/screenshots/hud-play-rps-round-light-${vp.name}.png`, fullPage: false });
        }
        await page.keyboard.press("Escape");
      }
    });

    test(`Scene overview light+dark — ${vp.name}`, async ({ page }) => {
      ensureScreenshotsDir();
      await page.goto(`/#token=${launchToken()}`);
      await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
      // Light overview
      await page.screenshot({ path: `e2e/screenshots/scene-overview-light-${vp.name}.png`, fullPage: false });
      // Dark overview
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e/screenshots/scene-overview-dark-${vp.name}.png`, fullPage: false });
      await page.emulateMedia({ colorScheme: "light" });
    });

    test(`Walk-mode first-person view — ${vp.name}`, async ({ page }) => {
      ensureScreenshotsDir();
      await page.goto(`/#token=${launchToken()}`);
      await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });

      // Enter walk mode via the global helper (avoids pointer-lock requirement in headless).
      await page.evaluate(() => (window as unknown as { __setWalking?: (v: boolean) => void }).__setWalking?.(true));
      // Allow a couple of R3F frames to position the camera.
      await page.waitForTimeout(200);

      // Light first-person view (near desks).
      await page.screenshot({ path: `e2e/screenshots/walk-fp-near-desks-light-${vp.name}.png`, fullPage: false });

      // Dark first-person view.
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `e2e/screenshots/walk-fp-near-desks-dark-${vp.name}.png`, fullPage: false });

      // Exit walk mode.
      await page.evaluate(() => (window as unknown as { __setWalking?: (v: boolean) => void }).__setWalking?.(false));
      await page.emulateMedia({ colorScheme: "light" });
    });
  });
}
