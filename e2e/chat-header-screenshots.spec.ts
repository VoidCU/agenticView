/**
 * Chat header: the Collapse button and the agent's actions menu sit side by side (no overlap), both
 * with at least 24px hit targets, also at 1280px wide and with a long, wrapping specialty.
 * Set CHAT_HEADER_SHOT=<name> to save the header crop under that name (before/after comparisons).
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

type Probe = { store: { getState(): { agents: Record<string, { id: string; name: string; specialty: string }>; select(id?: string): void }; setState(p: object): void } };

for (const vp of [{ name: "1280x800", width: 1280, height: 800 }, { name: "1920x1080", width: 1920, height: 1080 }]) {
  test(`chat header buttons do not overlap — ${vp.name}`, async ({ page }) => {
    if (!existsSync("e2e/screenshots")) mkdirSync("e2e/screenshots", { recursive: true });
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`/#token=${launchToken()}`);
    await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
    // Select Atlas and give it a long specialty so the header wraps (client-side only).
    await page.evaluate(() => {
      const store = (window as unknown as { __agenticviewTest: Probe }).__agenticviewTest.store;
      const s = store.getState();
      const atlas = Object.values(s.agents).find((a) => a.name === "Atlas")!;
      store.setState({ agents: { ...s.agents, [atlas.id]: { ...atlas, specialty: "Plans the work, delegates to the pod and reviews every change before it lands" } } });
      store.getState().select(atlas.id);
    });
    const head = page.locator(".panel-chat .chat-head");
    await expect(head).toBeVisible();
    const collapse = page.locator(".panel-chat").getByRole("button", { name: "Collapse chat" });
    const menu = page.locator(".panel-chat").getByRole("button", { name: /Actions for Atlas/ });
    const a = (await collapse.boundingBox())!;
    const b = (await menu.boundingBox())!;
    const overlap = !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    const shot = process.env.CHAT_HEADER_SHOT;
    if (shot) {
      const h = (await head.boundingBox())!;
      await page.screenshot({ path: `e2e/screenshots/chat-header-${shot}-${vp.name}.png`, clip: { x: h.x - 8, y: h.y - 8, width: h.width + 16, height: h.height + 16 } });
    }
    expect(overlap, `Collapse ${JSON.stringify(a)} overlaps menu ${JSON.stringify(b)}`).toBe(false);
    for (const box of [a, b]) {
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
    // Both work: the menu opens, and Collapse collapses.
    await menu.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await collapse.click();
    await expect(page.getByRole("button", { name: "Expand chat" })).toBeVisible();
    await page.getByRole("button", { name: "Expand chat" }).click();
  });
}
