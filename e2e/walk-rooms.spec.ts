/**
 * Walk through every doorway of the office with real key presses (W held down), both ways. A phantom
 * collider (an invisible barrier) stops or deflects the walker in open space; a depenetration bug
 * throws it sideways. Each crossing must get through, stay near the straight line, and never jump.
 *
 * Only open walls are crossed: a wall carrying a screen (My Office's WALL_SCREEN, the Production
 * Room's big screen) has no doorway even when a room sits behind it. Those closed walls are walked
 * into instead, from both sides, and must stop the walker.
 *
 * Then the office grows through the server (layout as data: PUT /api/layout, which broadcasts
 * layout.updated): every free ring-2 hex gets a pod, plus a pod behind each screen wall so the closed
 * walls are exercised. Every doorway that touches a room beyond ring 1 is walked too, and the plan is
 * restored afterwards so later specs see the default office.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AXIAL_DIRS, MAX_RINGS, hexDistance, hexRing, newRoomId, reachableRooms, screenWall, wallIsOpen, type OfficeLayout } from "@agenticview/shared";
import { E2E_HOME } from "./paths";

function launchToken(): string {
  const dir = join(E2E_HOME, "instances");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "hub.json");
  if (files.length === 0) throw new Error(`no instance file in ${dir}`);
  return (JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as { token: string }).token;
}

/** `openTo`: ids of the neighbours reachable through a doorway (the Office.tsx test hook). */
type Sp = { id: string; kind: string; x: number; z: number; q: number; r: number; openTo: string[] };
type Win = {
  __agenticviewTest?: { spaces(): Sp[] };
  __setWalking?: (v: boolean) => void;
  __teleportWalk?: (x: number, z: number, yaw?: number, pitch?: number) => void;
  __walkPos?: () => { x: number; z: number; yaw: number };
};
type Pair = { a: Sp; b: Sp };

const HEX_R = 7;
const APOTHEM = (HEX_R * Math.sqrt(3)) / 2;
/** Ring-1 rooms sit 2 * APOTHEM (12.1) from the centre; anything clearly further is ring 2+. */
const RING1_MAX = 2 * APOTHEM + 0.5;
/** Start this far before the wall, walking straight at its middle. */
const RUN_UP = 1.6;

const spacesNow = (page: Page) => page.evaluate(() => (window as unknown as Win).__agenticviewTest!.spaces());

function adjacent(a: Sp, b: Sp): boolean {
  return Math.abs(Math.hypot(a.x - b.x, a.z - b.z) - 2 * APOTHEM) < 0.05;
}

/** Neighbouring rooms joined by a doorway (per the scene's own openTo), each pair once. */
function doorsOf(spaces: Sp[], keep: (a: Sp, b: Sp) => boolean = () => true): Pair[] {
  const doors: Pair[] = [];
  for (const a of spaces) for (const b of spaces) {
    if (a.id >= b.id || !adjacent(a, b)) continue;
    const open = a.openTo.includes(b.id);
    // Both sides must agree: a doorway is a gap in ONE shared wall.
    expect(b.openTo.includes(a.id), `openTo is asymmetric between ${a.id} and ${b.id}`).toBe(open);
    if (open && keep(a, b)) doors.push({ a, b });
  }
  return doors;
}

/** Neighbouring rooms with a solid wall between them (a screen wall), each pair once. */
function closedWallsOf(spaces: Sp[]): Pair[] {
  const walls: Pair[] = [];
  for (const a of spaces) for (const b of spaces) {
    if (a.id < b.id && adjacent(a, b) && !a.openTo.includes(b.id)) walls.push({ a, b });
  }
  return walls;
}

interface Run {
  /** How far past the wall's middle the walker got (negative: still on the `from` side). */
  along: number;
  /** Furthest `along` reached while W was held. */
  maxAlong: number;
  /** Largest sideways drift from the straight line. */
  maxSide: number;
  /** Largest single-frame move (a teleport or a depenetration throw shows up here). */
  maxJump: number;
}

/** Stand RUN_UP before the middle of the wall between `from` and `to`, face it and hold W. */
async function walkAtWall(page: Page, from: Sp, to: Sp, stopAlong: number, budgetMs: number): Promise<Run> {
  const ux = (to.x - from.x) / (2 * APOTHEM);
  const uz = (to.z - from.z) / (2 * APOTHEM);
  const mx = (from.x + to.x) / 2;
  const mz = (from.z + to.z) / 2;
  const sx = mx - ux * RUN_UP;
  const sz = mz - uz * RUN_UP;
  // Walk camera: forward = (-sin yaw, -cos yaw), so this yaw looks along (ux, uz).
  await page.evaluate(([x, z, yaw]) => (window as unknown as Win).__teleportWalk!(x!, z!, yaw!), [sx, sz, Math.atan2(-ux, -uz)] as const);
  await page.waitForTimeout(150);
  // Per-frame sampler in the page: the largest single-frame move.
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
  let along = -RUN_UP;
  let maxAlong = -RUN_UP;
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    const p = await page.evaluate(() => (window as unknown as Win).__walkPos!());
    along = (p.x - mx) * ux + (p.z - mz) * uz;
    maxAlong = Math.max(maxAlong, along);
    maxSide = Math.max(maxSide, Math.abs((p.x - mx) * -uz + (p.z - mz) * ux));
    if (along > stopAlong) break;
    await page.waitForTimeout(40);
  }
  await page.keyboard.up("KeyW");
  const maxJump = await page.evaluate(() => {
    const w = window as unknown as { __walkMaxStep?: number; __walkSampling?: boolean };
    w.__walkSampling = false;
    return w.__walkMaxStep ?? 0;
  });
  await page.waitForTimeout(150);
  return { along, maxAlong, maxSide, maxJump };
}

const label = (from: Sp, to: Sp) => `${from.kind}:${from.id} -> ${to.kind}:${to.id}`;
const directions = (pairs: Pair[]) => pairs.flatMap(({ a, b }) => [[a, b], [b, a]] as const);

/** Every doorway, both ways: gets through, stays on the line, never jumps. */
async function crossAll(page: Page, doors: Pair[]): Promise<string[]> {
  const failures: string[] = [];
  for (const [from, to] of directions(doors)) {
    const run = await walkAtWall(page, from, to, 1.4, 8_000);
    if (run.along <= 1.4) failures.push(`${label(from, to)}: stuck ${run.along.toFixed(2)} along the path`);
    if (run.maxSide > 0.3) failures.push(`${label(from, to)}: deflected ${run.maxSide.toFixed(2)} sideways`);
    // One frame moves at most WALK_SPEED x the 0.08 s frame cap (0.36) plus a little depenetration.
    if (run.maxJump > 0.5) failures.push(`${label(from, to)}: jumped ${run.maxJump.toFixed(2)} in one frame`);
  }
  return failures;
}

/**
 * Every closed (screen) wall, from both sides: walking straight into its middle must stop on the
 * near side. The walker (radius 0.28) should come to rest about 0.33 before the centre line of the
 * 0.1-thick wall; anything past -0.1 means it clipped into or through the wall.
 */
async function bumpAll(page: Page, walls: Pair[]): Promise<string[]> {
  const failures: string[] = [];
  for (const [from, to] of directions(walls)) {
    const run = await walkAtWall(page, from, to, 0.5, 2_500);
    if (run.maxAlong > -0.1) failures.push(`${label(from, to)}: walked ${run.maxAlong.toFixed(2)} into/through a closed screen wall`);
    // It must actually have walked up to the wall (W works, nothing stopped it half-way to a false pass).
    if (run.maxAlong < -0.9) failures.push(`${label(from, to)}: stopped ${(-run.maxAlong).toFixed(2)} short of the closed wall`);
    if (run.maxJump > 0.5) failures.push(`${label(from, to)}: jumped ${run.maxJump.toFixed(2)} in one frame at a closed wall`);
  }
  return failures;
}

// ---------- growing the plan through the server ----------

type LayoutBody = OfficeLayout & { spaceNames?: Record<string, string> };

async function getLayout(request: APIRequestContext, token: string): Promise<LayoutBody> {
  const res = await request.get("/api/layout", { headers: { "x-agenticview-token": token } });
  expect(res.ok(), `GET /api/layout: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as LayoutBody;
}

async function putLayout(request: APIRequestContext, token: string, layout: OfficeLayout) {
  return request.put("/api/layout", {
    headers: { "x-agenticview-token": token, "Content-Type": "application/json" },
    data: { version: layout.version, rooms: layout.rooms },
  });
}

const hexKey = (h: { q: number; r: number }) => `${h.q},${h.r}`;
const ORIGIN = { q: 0, r: 0 };

/**
 * The current plan plus a pod on every free ring-2 hex and a pod behind every screen wall (so a room
 * backs onto each screen and that wall is a closed wall between two rooms). Pods that would only
 * touch the plan through a screen wall get a bridging pod on a free hex next to a reachable room,
 * so the server's validation (every room reachable through doorways) passes.
 */
function grownLayout(current: OfficeLayout): OfficeLayout {
  const out: OfficeLayout = { version: 1, rooms: current.rooms.map((r) => ({ ...r })) };
  const taken = () => new Set(out.rooms.map(hexKey));
  const addPod = (h: { q: number; r: number }) => {
    if (taken().has(hexKey(h)) || hexDistance(h, ORIGIN) > MAX_RINGS) return;
    out.rooms.push({ id: newRoomId(out, "pod"), kind: "pod", q: h.q, r: h.r });
  };
  for (const h of hexRing(2)) addPod(h);
  for (const room of [...out.rooms]) {
    const screen = screenWall(room.kind);
    if (!screen || screen.dir < 0) continue;
    const [dq, dr] = AXIAL_DIRS[screen.dir]!;
    addPod({ q: room.q + dq, r: room.r + dr });
  }
  const around = (h: { q: number; r: number }) => AXIAL_DIRS.map(([dq, dr]) => ({ q: h.q + dq, r: h.r + dr }));
  for (let guard = 0; guard < 8; guard++) {
    const reach = reachableRooms(out);
    const stranded = out.rooms.filter((r) => !reach.has(r.id));
    if (stranded.length === 0) break;
    const used = taken();
    const bridge = stranded
      .flatMap((s) => around(s).filter((h) => wallIsOpen({ kind: "pod", ...h }, s)))
      .filter((h) => !used.has(hexKey(h)) && hexDistance(h, ORIGIN) <= MAX_RINGS)
      .find((h) => out.rooms.some((n) => reach.has(n.id) && wallIsOpen({ kind: "pod", ...h }, n)));
    if (!bridge) break;
    addPod(bridge);
  }
  return out;
}

test("every doorway can be walked through, both ways, in a straight line; screen walls stop you (ring 1, then ring 2)", async ({ page }) => {
  test.setTimeout(900_000);
  const token = launchToken();
  await page.goto(`/#token=${token}`);
  await expect(page.locator(".tag-name", { hasText: "Atlas" })).toBeVisible({ timeout: 20_000 });
  const spaces = await spacesNow(page);
  expect(spaces.length).toBeGreaterThanOrEqual(6);
  expect(spaces.every((s) => Array.isArray(s.openTo)), "spaces() must expose openTo").toBe(true);
  // My Office / Production / Research are part of the default plan even with 0 workers (layout as
  // data): every doorway they have must be walked too, not just the four pods + meeting + lounge.
  for (const kind of ["myoffice", "production", "research"]) {
    expect(spaces.some((s) => s.kind === kind), `expected a "${kind}" space in the default plan`).toBe(true);
  }
  const doors = doorsOf(spaces);
  expect(doors.length).toBeGreaterThanOrEqual(6);
  for (const kind of ["myoffice", "production", "research"]) {
    expect(doors.some((d) => d.a.kind === kind || d.b.kind === kind), `expected at least one doorway touching "${kind}"`).toBe(true);
  }
  const closed = closedWallsOf(spaces);
  await page.evaluate(() => (window as unknown as Win).__setWalking?.(true));
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Win).__walkPos)).toBe("function");
  const failures = await crossAll(page, doors);
  failures.push(...(await bumpAll(page, closed)));

  // Grow the office through the server: the plan is data (layout.json), PUT /api/layout validates it,
  // stores it and broadcasts layout.updated; the page rebuilds walls and colliders from it.
  const original = await getLayout(page.request, token);
  const grown = grownLayout(original);
  expect(grown.rooms.length, "the grown plan adds rooms beyond ring 1").toBeGreaterThan(original.rooms.length);
  let ring2Doors: Pair[] = [];
  let bigClosed: Pair[] = [];
  try {
    const put = await putLayout(page.request, token, grown);
    expect(put.ok(), `PUT /api/layout: ${put.status()} ${await put.text()}`).toBe(true);
    await expect.poll(async () => (await spacesNow(page)).length, { timeout: 15_000 }).toBe(grown.rooms.length);
    const big = await spacesNow(page);
    ring2Doors = doorsOf(big, (a, b) => Math.hypot(a.x, a.z) > RING1_MAX || Math.hypot(b.x, b.z) > RING1_MAX);
    expect(ring2Doors.length).toBeGreaterThanOrEqual(6);
    // Each screen wall now backs onto a room, and there is no doorway through it.
    bigClosed = closedWallsOf(big);
    for (const kind of ["myoffice", "production"]) {
      expect(bigClosed.some((w) => w.a.kind === kind || w.b.kind === kind), `expected the ${kind} screen wall to back onto a room with no doorway`).toBe(true);
    }
    await page.waitForTimeout(500);
    failures.push(...(await crossAll(page, ring2Doors)));
    failures.push(...(await bumpAll(page, bigClosed)));
  } finally {
    await page.evaluate(() => (window as unknown as Win).__setWalking?.(false));
    // Put the plan back so later specs see the default office (the added pods hold no workers).
    const restore = await putLayout(page.request, token, original);
    if (!restore.ok()) console.warn(`[walk-rooms] could not restore the layout: ${restore.status()} ${await restore.text()}`);
  }
  console.log(
    `[walk-rooms] crossed ${doors.length * 2} ring-1 and ${ring2Doors.length * 2} ring-2 doorway directions, ` +
      `bumped ${(closed.length + bigClosed.length) * 2} closed-wall directions; ${failures.length} failures`,
  );

  expect(failures, failures.join("\n")).toEqual([]);
});
