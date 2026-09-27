/**
 * Round 10 screenshots:
 *  1. RPS pauses an agent mid-walk: it stops, turns to the player (walk mode), pumps its fist and
 *     emotes per round; on close it walks on to the same destination.
 *  2. A limited agent reports at the Manager's desk ("Hit my Codex limit!"), Atlas turned to face it;
 *     then "Switching to Gemini!" and it walks back.
 * The agents are injected client-side (agent.updated), so no model or server-side state is involved.
 */
import { test, expect, type Page } from "@playwright/test";
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
  store: { getState(): { agents: Record<string, { id: string; name: string; role: string }>; bubbles: Record<string, { text: string; until: number }> }; setState(p: object): void };
  inject(msg: unknown): void;
  agentPos(id: string): { x: number; z: number; walking?: boolean } | undefined;
};
type Win = { __agenticviewTest?: Probe; __setWalking?: (v: boolean) => void; __teleportWalk?: (x: number, z: number, yaw?: number, pitch?: number) => void };

const SHOTS = "e2e/screenshots";

function worker(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, name, role: "worker", scope: "project", specialty: "backend", description: "", provider: "codex", model: "gpt-6-luna", systemPrompt: "",
    tools: { edit: true, shell: true, web: false, screenshot: false }, permissionMode: "auto-edit",
    appearance: { color: "#3ecf8e", accent: "#ffffff", eyes: "round" }, stats: { xp: 0, level: 2, tasksDone: 3, tasksFailed: 0 },
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", ...extra,
  };
}

const inject = (page: Page, agent: unknown) => page.evaluate((a) => (window as unknown as Win).__agenticviewTest!.inject({ type: "agent.updated", agent: a }), agent);
const pos = (page: Page, id: string) => page.evaluate((i) => {
  const p = (window as unknown as Win).__agenticviewTest!.agentPos(i);
  return p ? { x: p.x, z: p.z, walking: p.walking } : undefined;
}, id);

async function holdBubbles(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Win).__agenticviewTest!.store;
    const bubbles = Object.fromEntries(Object.entries(store.getState().bubbles).map(([k, b]) => [k, { ...b, until: Date.now() + 10_000 }]));
    store.setState({ bubbles });
  });
}

test("RPS pauses an agent mid-walk facing the player, then it walks on", async ({ page }) => {
  test.setTimeout(120_000);
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#token=${launchToken()}`);
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });

  // Rex sits at a pod desk, then sets off to the meeting-room whiteboard.
  const rex = worker("w_rps_rex", "Rex");
  await inject(page, rex);
  await expect.poll(async () => Boolean(await pos(page, rex.id))).toBe(true);
  await page.waitForTimeout(800);
  await inject(page, { ...rex, visiting: { spaceId: "meeting", until: new Date(Date.now() + 120_000).toISOString() } });
  await expect.poll(async () => (await pos(page, rex.id))?.walking, { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(1200);

  // Walk mode: stand ~3 units ahead of Rex and look at him (he sits left of the popup).
  await page.evaluate(() => (window as unknown as Win).__setWalking?.(true));
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Win).__teleportWalk)).toBe("function");
  const p0 = (await pos(page, rex.id))!;
  await page.evaluate(([x, z]) => {
    const w = window as unknown as Win;
    const px = x! + 3.6, pz = z! + 3.6;
    // Face Rex, turned a little so he stands left of the centred popup.
    w.__teleportWalk!(px, pz, Math.atan2(-(x! - px), -(z! - pz)) - 0.42, -0.05);
  }, [p0.x, p0.z] as const);
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent("agenticview:play-rps", { detail: { agentId: id } })), rex.id);
  await expect(page.getByRole("dialog", { name: /RPS vs Rex/ })).toBeVisible();

  // Paused: he no longer moves along his path.
  const a = (await pos(page, rex.id))!;
  await page.waitForTimeout(1500);
  const b = (await pos(page, rex.id))!;
  expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.05);
  expect(b.walking).toBe(false);

  // A round comes in: he throws and reacts in speech bubbles.
  await page.evaluate(() => (window as unknown as Win).__agenticviewTest!.store.setState({
    lastGameRound: { matchId: "m_shot", round: 1, userMove: "rock", agentMove: "scissors", winner: "you", score: { you: 1, agent: 0 }, done: false },
  }));
  await expect.poll(() => page.evaluate((id) => (window as unknown as Win).__agenticviewTest!.store.getState().bubbles[id]?.text, rex.id)).toBe("No way!");
  await holdBubbles(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/rps-paused-mid-walk-1440x900.png` });

  // Close: he walks on to the same whiteboard.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /RPS vs Rex/ })).toHaveCount(0);
  await expect.poll(async () => {
    const c = (await pos(page, rex.id))!;
    return Math.hypot(c.x - b.x, c.z - b.z) > 0.5;
  }, { timeout: 10_000 }).toBe(true);
  await page.evaluate(() => (window as unknown as Win).__setWalking?.(false));
});

test("a limited agent reports at the Manager's desk, then switches and walks back", async ({ page }) => {
  test.setTimeout(120_000);
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#token=${launchToken()}`);
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });

  const cody = worker("w_lim_cody", "Cody", { limit: { limited: true, errorType: "quota", reason: "You exceeded your current quota" } });
  await inject(page, cody);
  await expect.poll(async () => Boolean(await pos(page, cody.id))).toBe(true);
  await page.waitForTimeout(800);
  const seat = (await pos(page, cody.id))!;
  await inject(page, { ...cody, revive: { phase: "fainted", cause: "limit", failedProvider: "codex", failedTaskId: "t_x" } });

  // Walks over (through doorways) and stops in the Manager's office, next to Atlas.
  const atlasId = await page.evaluate(() => Object.values((window as unknown as Win).__agenticviewTest!.store.getState().agents).find((a) => a.role === "manager")!.id);
  await expect.poll(async () => {
    const c = await pos(page, cody.id);
    const m = await pos(page, atlasId);
    return Boolean(c && m && !c.walking && Math.hypot(c.x - m.x, c.z - m.z) < 3.5);
  }, { timeout: 30_000 }).toBe(true);
  await page.keyboard.press("1"); // focus the Manager's office
  await expect(page.locator(".bubble", { hasText: "Hit my Codex limit!" })).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/limit-report-at-manager-desk-1440x900.png` });

  // The decision lands: "Switching to Gemini!" and back to the desk.
  await inject(page, { ...cody, provider: "gemini", model: "flash", limit: undefined, revive: { phase: "done", cause: "limit", failedProvider: "codex", failedTaskId: "t_x", switchTo: { provider: "gemini", model: "flash" } } });
  await expect(page.locator(".bubble", { hasText: "Switching to Gemini!" })).toBeVisible();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/limit-switching-walks-back-1440x900.png` });
  await expect.poll(async () => {
    const c = (await pos(page, cody.id))!;
    return Math.hypot(c.x - seat.x, c.z - seat.z) < 0.2;
  }, { timeout: 30_000 }).toBe(true);
});
