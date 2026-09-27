/**
 * Timeline: a request opens as a workflow board (large overlay, numbered visual flow). A multi-step
 * workflow (delegation, limit + failover retry, question, replies, final report) is placed in the
 * client store for the shot; light and dark; Esc closes; a step opens its task drawer.
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

test("timeline request opens as a workflow board", async ({ page }) => {
  if (!existsSync("e2e/screenshots")) mkdirSync("e2e/screenshots", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#token=${launchToken()}`);
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
  // Two workers to hand work to.
  await page.evaluate(async () => {
    const token = sessionStorage.getItem("agenticview.token") ?? "";
    const ws = new WebSocket(`ws://${location.host}/ws?token=${encodeURIComponent(token)}`);
    await new Promise((r) => (ws.onopen = r));
    for (const [name, provider] of [["Nova", "codex"], ["Pixel", "claude"]] as const) ws.send(JSON.stringify({ type: "agent.create", agent: { name, specialty: "Frontend", provider } }));
    await new Promise((r) => setTimeout(r, 1200));
    ws.close();
  });
  await expect(page.locator(".tag-name", { hasText: "Nova" })).toBeVisible({ timeout: 15_000 });
  // A finished multi-step request in the client store (presentation only).
  await page.evaluate(() => {
    type Store = { getState(): { agents: Record<string, { id: string; name: string; role: string }>; tasks: Record<string, unknown> }; setState(p: object): void };
    const store = (window as unknown as { __agenticviewTest: { store: Store } }).__agenticviewTest.store;
    const s = store.getState();
    const by = (n: string) => Object.values(s.agents).find((a) => a.name === n)!.id;
    const atlas = Object.values(s.agents).find((a) => a.role === "manager")!.id;
    const nova = by("Nova");
    const pixel = by("Pixel");
    const T0 = Date.now() - 20 * 60_000;
    const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
    const base = { projectPath: "", images: [], description: "" };
    const tasks = {
      wr1: { ...base, id: "wr1", kind: "request", title: "Add a dark mode toggle to settings", assigneeId: atlas, createdBy: "user", status: "done", createdAt: at(0), startedAt: at(2), finishedAt: at(640),
        result: "Dark mode is in.\n\n- **Toggle** in Settings, remembered per browser\n- Nova built it after Pixel hit a limit\n- Tests green",
        log: [
          { ts: at(0), type: "user", text: "Add a **dark mode** toggle to the settings page" },
          { ts: at(3), type: "tool_start", text: "read_file src/Settings.tsx" },
          { ts: at(20), type: "tool_start", text: 'ask_user {"question":"Follow the OS theme by default?"}' },
        ] },
      wc1: { ...base, id: "wc1", kind: "work", parentId: "wr1", title: "Build the theme toggle", assigneeId: pixel, createdBy: atlas, status: "failed", createdAt: at(40), startedAt: at(41), finishedAt: at(130), error: "Rate limit reached (429): usage limit", tier: { provider: "claude", model: "sonnet" }, log: [] },
      wc2: { ...base, id: "wc2", kind: "work", parentId: "wr1", title: "Build the theme toggle", assigneeId: nova, createdBy: atlas, status: "done", createdAt: at(132), startedAt: at(133), finishedAt: at(385), result: "Toggle done in `ThemeToggle.tsx`\n\n```tsx\nexport function ThemeToggle() { /* ... */ }\n```\nwith tests", tier: { provider: "codex", model: "gpt-5" }, log: [{ ts: at(134), type: "status", text: "Failover: moved to codex after a usage limit" }] },
      wc3: { ...base, id: "wc3", kind: "work", parentId: "wr1", title: "Review the toggle", assigneeId: pixel, createdBy: atlas, status: "done", createdAt: at(390), startedAt: at(391), finishedAt: at(600), result: "Reviewed: contrast fixed on two buttons.", tier: { provider: "claude", model: "sonnet" }, log: [] },
    };
    store.setState({ tasks: { ...s.tasks, ...tasks } });
  });
  await page.keyboard.press("l"); // Timeline
  const row = page.getByTestId("timeline-panel").getByRole("button", { name: /Add a dark mode toggle/ });
  await row.click();
  const board = page.getByRole("dialog", { name: /Workflow · Add a dark mode toggle/ });
  await expect(board).toBeVisible();
  const steps = board.getByTestId("wf-step");
  await expect(steps.first()).toContainText("You asked");
  expect(await steps.count()).toBeGreaterThanOrEqual(8);
  await expect(board.locator(".wfb-num").first()).toHaveText("1");
  const box = await board.boundingBox();
  expect(box!.width).toBeGreaterThan(1440 * 0.8);
  await page.screenshot({ path: "e2e/screenshots/workflow-board-light-1440x900.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(250);
  await page.screenshot({ path: "e2e/screenshots/workflow-board-dark-1440x900.png" });
  await page.emulateMedia({ colorScheme: "light" });
  // Expand a reply to its full markdown.
  const reply = steps.filter({ hasText: "Nova replied" });
  await reply.getByRole("button", { name: "Show all" }).click();
  await expect(reply.locator(".wf-full code").first()).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/workflow-board-expanded-light-1440x900.png" });
  // A step opens its task drawer.
  await steps.filter({ hasText: "Atlas → Nova" }).getByRole("button", { name: /Atlas → Nova/ }).click();
  await expect(board.getByTestId("task-drawer")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/workflow-board-drawer-light-1440x900.png" });
  await board.getByRole("button", { name: "Close drawer" }).click();
  // Esc closes the board.
  await page.keyboard.press("Escape");
  await expect(board).toBeHidden();
});
