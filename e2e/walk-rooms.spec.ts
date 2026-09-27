/**
 * Walk through every doorway of the office with real key presses (W held down), both ways. A phantom
 * collider (an invisible barrier) stops or deflects the walker in open space; a depenetration bug
 * throws it sideways. Each crossing must get through, stay near the straight line, and never jump.
 *
 * Then the office grows to ring 2 (26 more workers, injected client-side: the layout, walls and
 * colliders are all derived from the roster) and every doorway that touches a ring-2 room is walked too.
 */
import { test, expect, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME } from "./paths";

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  return (JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string }).token;
}

type Sp = { id: string; kind: string; x: number; z: number };
type Win = {
  __agenticviewTest?: { spaces(): Sp[]; inject(msg: unknown): void };
  __setWalking?: (v: boolean) => void;
  __teleportWalk?: (x: number, z: number, yaw?: number, pitch?: number) => void;
  __walkPos?: () => { x: number; z: number; yaw: number };
};

const HEX_R = 7;
const APOTHEM = (HEX_R * Math.sqrt(3)) / 2;
/** Ring-1 rooms sit 2 * APOTHEM (12.1) from the centre; anything clearly further is ring 2+. */
const RING1_MAX = 2 * APOTHEM + 0.5;

function doorsOf(spaces: Sp[], keep: (a: Sp, b: Sp) => boolean = () => true): { a: Sp; b: Sp }[] {
  const doors: { a: Sp; b: Sp }[] = [];
  for (const a of spaces) for (const b of spaces) {
    if (a.id >= b.id) continue;
    if (Math.abs(Math.hypot(a.x - b.x, a.z - b.z) - 2 * APOTHEM) < 0.05 && keep(a, b)) doors.push({ a, b });
  }
  return doors;
}

async function crossAll(page: Page, doors: { a: Sp; b: Sp }[]): Promise<string[]> {
  const failures: string[] = [];
  for (const { a, b } of doors) for (const [from, to] of [[a, b], [b, a]] as const) {
    const ux = (to.x - from.x) / (2 * APOTHEM);
    const uz = (to.z - from.z) / (2 * APOTHEM);
    const mx = (from.x + to.x) / 2;
    const mz = (from.z + to.z) / 2;
    const sx = mx - ux * 1.6;
    const sz = mz - uz * 1.6;
    await page.evaluate(([x, z, yaw]) => (window as unknown as Win).__teleportWalk!(x!, z!, yaw!), [sx, sz, Math.atan2(-ux, -uz)] as const);
    await page.waitForTimeout(150);
    // Per-frame sampler in the page: the largest single-frame move (a teleport shows up here).
    await page.evaluate(() => {
      const w = window as unknown as Win & { __walkMaxStep?: number; __walkSampling?: boolean };
      w.__walkMaxStep = 0;
      w.__walkSampling = true;
      let prev = w.__walkPos!();
      const tick = () => {
        if (!w.__walkSampling) return;
        const p = w.__walkPos?.();
        if (p) {
          w.__walkMaxStep = Math.max(w.__walkMaxStep ?? 0, Math.hypot(p.x - prev.x, p.z - prev.z));
          prev = p;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.keyboard.down("KeyW");
    let maxSide = 0;
    let along = -1.6;
    const t0 = Date.now();
    while (Date.now() - t0 < 8_000) {
      const p = await page.evaluate(() => (window as unknown as Win).__walkPos!());
      along = (p.x - mx) * ux + (p.z - mz) * uz;
      maxSide = Math.max(maxSide, Math.abs((p.x - mx) * -uz + (p.z - mz) * ux));
      if (along > 1.4) break;
      await page.waitForTimeout(40);
    }
    await page.keyboard.up("KeyW");
    const maxJump = await page.evaluate(() => {
      const w = window as unknown as { __walkMaxStep?: number; __walkSampling?: boolean };
      w.__walkSampling = false;
      return w.__walkMaxStep ?? 0;
    });
    await page.waitForTimeout(150);
    const label = `${from.kind}:${from.id} -> ${to.kind}:${to.id}`;
    if (along <= 1.4) failures.push(`${label}: stuck ${along.toFixed(2)} along the path`);
    if (maxSide > 0.3) failures.push(`${label}: deflected ${maxSide.toFixed(2)} sideways`);
    // One frame moves at most WALK_SPEED x the 0.08 s frame cap (0.36) plus a little depenetration.
    if (maxJump > 0.5) failures.push(`${label}: jumped ${maxJump.toFixed(2)} in one frame`);
  }
  return failures;
}

test("every doorway can be walked through, both ways, in a straight line (ring 1, then ring 2)", async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto(`/#token=${launchToken()}`);
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
  const spaces = await page.evaluate(() => (window as unknown as Win).__agenticviewTest!.spaces());
  expect(spaces.length).toBeGreaterThanOrEqual(6);
  const doors = doorsOf(spaces);
  expect(doors.length).toBeGreaterThanOrEqual(6);
  await page.evaluate(() => (window as unknown as Win).__setWalking?.(true));
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Win).__walkPos)).toBe("function");
  const failures = await crossAll(page, doors);

  // Grow the office to ring 2: 26 extra workers fill ring 1's 24 desks and spill over.
  await page.evaluate(() => {
    const t = (window as unknown as Win).__agenticviewTest!;
    for (let i = 0; i < 26; i++) {
      const id = `w_ring2_${String(i).padStart(2, "0")}`;
      t.inject({
        type: "agent.updated",
        agent: {
          id, name: `R${i}`, role: "worker", scope: "project", specialty: "", description: "", provider: null, model: null, systemPrompt: "",
          tools: { edit: true, shell: true, web: false, screenshot: false }, permissionMode: "auto-edit",
          appearance: { color: "#5b8cff", accent: "#ffffff", eyes: "round" }, stats: { xp: 0, level: 1, tasksDone: 0, tasksFailed: 0 },
          createdAt: new Date(Date.UTC(2030, 0, 1, 0, i)).toISOString(), updatedAt: new Date(Date.UTC(2030, 0, 1)).toISOString(),
        },
      });
    }
  });
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as Win).__agenticviewTest!.spaces())).length).toBeGreaterThan(spaces.length);
  const big = await page.evaluate(() => (window as unknown as Win).__agenticviewTest!.spaces());
  const ring2Doors = doorsOf(big, (a, b) => Math.hypot(a.x, a.z) > RING1_MAX || Math.hypot(b.x, b.z) > RING1_MAX);
  expect(ring2Doors.length).toBeGreaterThanOrEqual(6);
  await page.waitForTimeout(500);
  failures.push(...(await crossAll(page, ring2Doors)));
  console.log(`[walk-rooms] crossed ${doors.length * 2} ring-1 and ${ring2Doors.length * 2} ring-2 doorway directions; ${failures.length} failures`);

  expect(failures, failures.join("\n")).toEqual([]);
  await page.evaluate(() => (window as unknown as Win).__setWalking?.(false));
});
