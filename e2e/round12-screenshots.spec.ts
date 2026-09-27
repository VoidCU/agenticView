/**
 * Round 12 screenshots from the built app, light and dark: the new floor plan overview, close-ups of
 * My Office (social hub wall screen), the Production Room (idle PRODUCTION slate, then ON AIR with a
 * running task's title), the Research Room, the swapped Manager's Office and centre lounge, the layout
 * editor (a selected room and a validation error), Settings > Connections and the mini-map.
 *
 * The ON AIR task is injected client-side (the demo runtime finishes tasks too fast to catch them
 * running); the Producer is created and seated in the Production Room through the real WebSocket.
 *
 * Runs when AGENTICVIEW_SCREENSHOTS=1 npm run test:e2e. Saved to e2e/screenshots/ (gitignored).
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";

test.use({ trace: "off", viewport: { width: 1440, height: 900 } });

const SHOTS = "e2e/screenshots";

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  return (JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string }).token;
}

type AnyTask = { id: string; title: string; status: string; assigneeId: string; startedAt?: string };
type Store = { getState(): { send(m: unknown): void; agents: Record<string, { id: string; name: string; placement?: { space: string } }>; tasks: Record<string, AnyTask> } };
type Win = { __agenticviewTest?: { store: Store; focus(id?: string): void; inject(msg: unknown): void } };

const send = (page: Page, msg: unknown) => page.evaluate((m) => (window as unknown as Win).__agenticviewTest!.store.getState().send(m), msg);
const focus = async (page: Page, id?: string) => {
  await page.evaluate((s) => (window as unknown as Win).__agenticviewTest!.focus(s), id);
  await page.waitForTimeout(2_200);
};
const shot = (page: Page, name: string, theme: string) => page.screenshot({ path: `${SHOTS}/r12-${name}-${theme}-1440x900.png` });

test("round 12: rooms, production screen, layout editor, connections and mini-map in both themes", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOTS, { recursive: true });
  await page.goto(`/#token=${launchToken()}`);
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });

  // The Producer: a worker seated at the Production Room's first edit desk.
  const base = { specialty: "Producer", tools: { edit: true, shell: true, web: false, screenshot: false }, permissionMode: "auto-edit" };
  await send(page, { type: "agent.create", agent: { ...base, name: "Reel" } });
  await expect.poll(() => page.evaluate(() => Object.values((window as unknown as Win).__agenticviewTest!.store.getState().agents).some((a) => a.name === "Reel"))).toBe(true);
  const reel = (await page.evaluate(() => Object.values((window as unknown as Win).__agenticviewTest!.store.getState().agents).find((a) => a.name === "Reel")!.id))!;
  await send(page, { type: "agent.update", id: reel, patch: { placement: { space: "production", seat: 0 } } });
  await expect.poll(() => page.evaluate((id) => (window as unknown as Win).__agenticviewTest!.store.getState().agents[id]?.placement?.space, reel)).toBe("production");
  // One real (demo) task so there is a well-formed task to clone for the ON AIR state.
  await send(page, { type: "chat.send", agentId: reel, text: "Say hello.", images: [] });
  await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as Win).__agenticviewTest!.store.getState().tasks).length), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(4_000);

  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForTimeout(600);

    await focus(page, undefined);
    await shot(page, "overview", theme);
    await focus(page, "myoffice");
    await shot(page, "myoffice", theme);
    await focus(page, "production");
    await shot(page, "production-idle", theme);

    const liveTitle = "Cut the 60-second launch trailer for v0.3";
    await page.evaluate(([assigneeId, title]) => {
      const t = (window as unknown as Win).__agenticviewTest!;
      const any = Object.values(t.store.getState().tasks)[0]!;
      t.inject({ type: "task.updated", task: { ...any, id: "t_onair_demo", title, status: "running", assigneeId, startedAt: new Date().toISOString(), finishedAt: undefined } });
    }, [reel, liveTitle] as const);
    await page.waitForTimeout(800);
    await shot(page, "production-onair", theme);
    await page.evaluate(() => {
      const t = (window as unknown as Win).__agenticviewTest!;
      const any = t.store.getState().tasks["t_onair_demo"]!;
      t.inject({ type: "task.updated", task: { ...any, status: "done", finishedAt: new Date().toISOString() } });
    });

    await focus(page, "research");
    await shot(page, "research", theme);
    await focus(page, "office");
    await shot(page, "manager-office", theme);
    await focus(page, "lounge");
    await shot(page, "lounge", theme);
    await focus(page, undefined);

    // Mini-map: the You marker sits in My Office while not walking.
    const show = page.getByRole("button", { name: "Show mini-map" });
    if (await show.isVisible().catch(() => false)) await show.click();
    const map = page.locator(".mini-map-hud");
    await expect(map.getByRole("img", { name: "Office mini-map" })).toBeVisible();
    await map.screenshot({ path: `${SHOTS}/r12-minimap-${theme}-1440x900.png` });

    // Layout editor: My Office moved off the plan edge (not connected), then Pod A selected.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /settings/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: "Layout" }).click();
    await dialog.getByRole("button", { name: /^My Office, hex -2,0$/ }).click();
    await dialog.getByRole("button", { name: /^Empty hex, hex -3,3$/ }).click();
    await expect(dialog.getByRole("alert")).toContainText(/not connected/);
    await dialog.getByRole("button", { name: /^Pod A, hex 1,0$/ }).click();
    await expect(dialog.getByRole("button", { name: /^Pod A, hex 1,0$/ })).toHaveAttribute("aria-pressed", "true");
    await shot(page, "layout-editor", theme);
    await dialog.getByRole("button", { name: "Cancel layout changes" }).click();

    await dialog.getByRole("tab", { name: "Connections" }).click();
    await expect(dialog.getByRole("button", { name: "Connect Instagram" })).toBeDisabled();
    await shot(page, "connections", theme);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});
