/**
 * Overview screenshots: light and dark themes showing bigger rooms (HEX_R = 7),
 * 6-desk pods (2 rows of 3), lounge scoreboard, and busy lounge with lounging agents.
 *
 * Runs when AGENTICVIEW_SCREENSHOTS=1 npm run test:e2e.
 * Saved to e2e/screenshots/ (gitignored).
 */
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";

// Disable tracing for screenshot-only tests: traces are not useful here and on Windows
// the test-results directory may not exist, causing an ENOENT when Playwright tries to
// write the zip file (even with retain-on-failure the zip creation itself can error out).
// Note: test.use({ trace }) must be top-level, not inside a describe group.
test.use({ trace: "off" });

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

  test("light lounge focused - busy lounge with 8+ lounging agents", async ({ page }) => {
    ensureScreenshotsDir();
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
    // Seed 8 extra workers as lounging via the store hook exposed on window
    await page.evaluate(() => {
      const store = (window as unknown as { __agenticviewStore?: { getState(): { agents: Record<string, unknown>; patch?(p: unknown): void } } }).__agenticviewStore;
      if (!store) return;
      const state = store.getState();
      const workerIds = Object.keys(state.agents).filter(
        (id) => (state.agents[id] as { role?: string }).role === "worker",
      );
      // Set first 8 workers to lounging
      for (const id of workerIds.slice(0, 8)) {
        const send = (state as unknown as { send?(m: unknown): void }).send;
        if (send) send({ type: "agent.update", id, patch: { lounging: true } });
      }
    });
    await page.waitForTimeout(500);
    // Press "6" to focus the lounge room (it's position 6 in viewOrder)
    await page.keyboard.press("Digit6");
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: "e2e/screenshots/lounge-busy-light-1920x1080.png", fullPage: false });
  });

  test("dark lounge focused - busy lounge with lounging agents", async ({ page }) => {
    ensureScreenshotsDir();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
    await page.evaluate(() => {
      const store = (window as unknown as { __agenticviewStore?: { getState(): { agents: Record<string, unknown>; patch?(p: unknown): void } } }).__agenticviewStore;
      if (!store) return;
      const state = store.getState();
      const workerIds = Object.keys(state.agents).filter(
        (id) => (state.agents[id] as { role?: string }).role === "worker",
      );
      for (const id of workerIds.slice(0, 8)) {
        const send = (state as unknown as { send?(m: unknown): void }).send;
        if (send) send({ type: "agent.update", id, patch: { lounging: true } });
      }
    });
    await page.waitForTimeout(500);
    await page.keyboard.press("Digit6");
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: "e2e/screenshots/lounge-busy-dark-1920x1080.png", fullPage: false });
  });

  test("lounge walk mode - from inside the lounge", async ({ page }) => {
    ensureScreenshotsDir();
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
    // Enable walk mode via the window hook
    await page.evaluate(() => {
      const setWalking = (window as unknown as { __setWalking?: (v: boolean) => void }).__setWalking;
      if (setWalking) setWalking(true);
    });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "e2e/screenshots/lounge-walkmode-light-1920x1080.png", fullPage: false });
  });

  test("lounge walk mode dark - from inside the lounge", async ({ page }) => {
    ensureScreenshotsDir();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
    // Seed 8 workers as lounging so the dark walk mode shows a busy lounge.
    await page.evaluate(() => {
      const store = (window as unknown as { __agenticviewStore?: { getState(): { agents: Record<string, unknown> } } }).__agenticviewStore;
      if (!store) return;
      const state = store.getState();
      const workerIds = Object.keys(state.agents).filter(
        (id) => (state.agents[id] as { role?: string }).role === "worker",
      );
      for (const id of workerIds.slice(0, 8)) {
        const send = (state as unknown as { send?(m: unknown): void }).send;
        if (send) send({ type: "agent.update", id, patch: { lounging: true } });
      }
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const setWalking = (window as unknown as { __setWalking?: (v: boolean) => void }).__setWalking;
      if (setWalking) setWalking(true);
    });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "e2e/screenshots/lounge-walkmode-dark-1920x1080.png", fullPage: false });
  });
});

test.describe("desk monitor walk-mode screenshots", () => {
  // Pod-a (first pod) is at world ~(10.5, 6.06).
  // Seat 0 monitor faces -Z at ~(9.3, 5.68).
  // Walk camera at (9.3, 3.5) with yaw=π shows the monitor up close.
  test.use({ viewport: { width: 1280, height: 800 } });

  /** Create one worker and wait for their tag to appear in the scene. */
  async function seedPodWorker(page: import("@playwright/test").Page, name: string) {
    await page.getByRole("button", { name: /new agent/i }).first().click();
    await page.getByPlaceholder("Nova").fill(name);
    await page.getByRole("button", { name: "Create agent" }).click();
    await expect(page.locator(".tag-name", { hasText: name })).toBeVisible({ timeout: 20_000 });
  }

  /** Enable walk mode, teleport to seat-0 of pod-a, and wait for the monitor to refresh. */
  async function goToMonitor(page: import("@playwright/test").Page) {
    await page.evaluate(() => {
      const setWalking = (window as unknown as { __setWalking?: (v: boolean) => void }).__setWalking;
      if (setWalking) setWalking(true);
    });
    await page.waitForTimeout(300);
    // Teleport to just south of the first pod desk monitor; look toward +Z (yaw=π sees screen).
    await page.evaluate(() => {
      const tp = (window as unknown as { __teleportWalk?: (x: number, z: number, yaw: number) => void }).__teleportWalk;
      if (tp) tp(9.3, 3.5, Math.PI);
    });
    // Wait for monitor texture refresh (REFRESH_MS = 2 s).
    await page.waitForTimeout(2_500);
  }

  test("idle screensaver light - walk mode near pod-a desk", async ({ page }) => {
    test.setTimeout(60_000);
    ensureScreenshotsDir();
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    // Seed a worker so pod-a has a monitor; idle = no running task → screensaver.
    await seedPodWorker(page, "MonitorW1");
    await goToMonitor(page);
    await page.screenshot({ path: "e2e/screenshots/monitor-idle-light-1280x800.png", fullPage: false });
  });

  test("idle screensaver dark - walk mode near pod-a desk", async ({ page }) => {
    test.setTimeout(60_000);
    ensureScreenshotsDir();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    await seedPodWorker(page, "MonitorW2");
    await goToMonitor(page);
    await page.screenshot({ path: "e2e/screenshots/monitor-idle-dark-1280x800.png", fullPage: false });
  });

  test("live monitor light - walk mode near pod-a desk with running task", async ({ page }) => {
    test.setTimeout(90_000);
    ensureScreenshotsDir();
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    await seedPodWorker(page, "MonitorW3");
    // Ask Atlas to delegate a task so the worker gets a running task.
    const bar = page.getByLabel(/Tell Atlas what to build/);
    await bar.fill("write a readme");
    await bar.press("Enter");
    // Don't wait for done — enter walk mode while the task is still running.
    await page.waitForTimeout(2_000);
    await goToMonitor(page);
    await page.screenshot({ path: "e2e/screenshots/monitor-live-light-1280x800.png", fullPage: false });
  });

  test("live monitor dark - walk mode near pod-a desk with running task", async ({ page }) => {
    test.setTimeout(90_000);
    ensureScreenshotsDir();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    await seedPodWorker(page, "MonitorW4");
    const bar = page.getByLabel(/Tell Atlas what to build/);
    await bar.fill("write a readme");
    await bar.press("Enter");
    await page.waitForTimeout(2_000);
    await goToMonitor(page);
    await page.screenshot({ path: "e2e/screenshots/monitor-live-dark-1280x800.png", fullPage: false });
  });
});

test.describe("1280x800 overview screenshots", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("light overview 1280x800", async ({ page }) => {
    ensureScreenshotsDir();
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "e2e/screenshots/overview-light-1280x800.png", fullPage: false });
  });

  test("dark overview 1280x800", async ({ page }) => {
    ensureScreenshotsDir();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "e2e/screenshots/overview-dark-1280x800.png", fullPage: false });
  });

  test("busy lounge 8+ agents light 1280x800", async ({ page }) => {
    ensureScreenshotsDir();
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
    await page.evaluate(() => {
      const store = (window as unknown as { __agenticviewStore?: { getState(): { agents: Record<string, unknown> } } }).__agenticviewStore;
      if (!store) return;
      const state = store.getState();
      const workerIds = Object.keys(state.agents).filter(
        (id) => (state.agents[id] as { role?: string }).role === "worker",
      );
      for (const id of workerIds.slice(0, 8)) {
        const send = (state as unknown as { send?(m: unknown): void }).send;
        if (send) send({ type: "agent.update", id, patch: { lounging: true } });
      }
    });
    await page.waitForTimeout(500);
    await page.keyboard.press("Digit6");
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: "e2e/screenshots/lounge-busy-light-1280x800.png", fullPage: false });
  });

  test("busy lounge 8+ agents dark 1280x800", async ({ page }) => {
    ensureScreenshotsDir();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
    await page.evaluate(() => {
      const store = (window as unknown as { __agenticviewStore?: { getState(): { agents: Record<string, unknown> } } }).__agenticviewStore;
      if (!store) return;
      const state = store.getState();
      const workerIds = Object.keys(state.agents).filter(
        (id) => (state.agents[id] as { role?: string }).role === "worker",
      );
      for (const id of workerIds.slice(0, 8)) {
        const send = (state as unknown as { send?(m: unknown): void }).send;
        if (send) send({ type: "agent.update", id, patch: { lounging: true } });
      }
    });
    await page.waitForTimeout(500);
    await page.keyboard.press("Digit6");
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: "e2e/screenshots/lounge-busy-dark-1280x800.png", fullPage: false });
  });

  test("lounge walk mode light 1280x800", async ({ page }) => {
    ensureScreenshotsDir();
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
    await page.evaluate(() => {
      const setWalking = (window as unknown as { __setWalking?: (v: boolean) => void }).__setWalking;
      if (setWalking) setWalking(true);
    });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "e2e/screenshots/lounge-walkmode-light-1280x800.png", fullPage: false });
  });

  test("lounge walk mode dark 1280x800", async ({ page }) => {
    ensureScreenshotsDir();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".office canvas")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
    await page.evaluate(() => {
      const setWalking = (window as unknown as { __setWalking?: (v: boolean) => void }).__setWalking;
      if (setWalking) setWalking(true);
    });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "e2e/screenshots/lounge-walkmode-dark-1280x800.png", fullPage: false });
  });
});
