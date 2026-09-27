import { describe, expect, it } from "vitest";
import { buildSpaces } from "@agenticview/shared";
import {
  boardLines, boardNotesLayout, drawBoard, noteTilt, wrapLines, BOARD_REFRESH_MS, BOARD_FACE_NUDGE, BOARD_NOTES_TOP, BOARD_NOTE_H,
  BOARD_RULE_Y, BOARD_TEX_H, BOARD_TEX_W, BOARD_THEME, PIN_COLORS, whiteboardPose, type BoardLine,
} from "../src/scene/Whiteboard";
import { Kit, furnishSpace, WHITEBOARD_FACE } from "../src/scene/kit";
import { BOARD_COLORS, BOARD_COLUMNS, BOARD_LABELS, type BoardColumn } from "../src/state/boards";
import { useWalk } from "../src/state/walk";
import { manager, task, worker } from "./fixtures";

/**
 * A recording stand-in for CanvasRenderingContext2D (jsdom has no canvas): text is measured at
 * 0.55 x the font's pixel size per character, and every fillText / fill / arc is logged with the
 * fillStyle at the time.
 */
function fakeCtx(width = BOARD_TEX_W, height = BOARD_TEX_H) {
  const log = { text: [] as { s: string; x: number; y: number; fill: unknown; font: string }[], fills: [] as unknown[], arcs: 0, rotations: [] as number[], stops: [] as string[] };
  const gradient = { addColorStop: (_: number, c: string) => { log.stops.push(c); } };
  const state: Record<string, unknown> = { font: "10px sans-serif", fillStyle: "#000" };
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key === "canvas") return { width, height };
      if (key === "log") return log;
      if (key === "measureText") return (s: string) => ({ width: s.length * (parseFloat(/(\d+(?:\.\d+)?)px/.exec(String(target.font))?.[1] ?? "10") * 0.55) });
      if (key === "fillText") return (s: string, x: number, y: number) => { log.text.push({ s, x, y, fill: target.fillStyle, font: String(target.font) }); };
      if (key === "fill") return () => { log.fills.push(target.fillStyle); };
      if (key === "arc") return () => { log.arcs++; };
      if (key === "rotate") return (r: number) => { log.rotations.push(r); };
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => gradient;
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key: string, value) { target[key] = value; return true; },
  });
  return ctx as unknown as CanvasRenderingContext2D & { log: typeof log };
}

describe("whiteboard notes", () => {
  const podA = buildSpaces(1).find((s) => s.id === "pod-a")!;
  const office = buildSpaces(1).find((s) => s.kind === "office")!;
  it("lists the pod's tasks in the popup's column order, each with who works on it", () => {
    const lines = boardLines(podA, [worker], [
      task({ id: "d", title: "Done thing", status: "done", finishedAt: new Date(0).toISOString() }),
      task({ id: "r", title: "Running thing", status: "running" }),
      task({ id: "q", title: "Queued thing", status: "assigned" }),
    ]);
    expect(lines).toEqual([
      { title: "Queued thing", status: "queued", meta: "Pixel" },
      { title: "Running thing", status: "running", meta: "Pixel" },
      { title: "Done thing", status: "done", meta: "Pixel" },
    ]);
    expect(BOARD_COLUMNS).toEqual(["queued", "running", "waiting", "done", "failed"]);
  });
  it("the manager's office pins the Manager board's requests the same way", () => {
    const lines = boardLines(office, [manager, worker], [
      task({ id: "r1", kind: "request", title: "Old request", status: "done", assigneeId: manager.id, createdAt: "2026-09-25T00:00:00.000Z" }),
      task({ id: "r2", kind: "request", title: "New request", status: "running", assigneeId: manager.id, createdAt: "2026-09-26T00:00:00.000Z" }),
      task({ id: "c1", title: "Child", parentId: "r2", status: "running" }),
      task({ id: "c2", title: "Child 2", parentId: "r2", status: "queued" }),
    ]);
    expect(lines).toEqual([
      { title: "New request", status: "running", meta: "2 delegated" },
      { title: "Old request", status: "done", meta: "You asked" },
    ]);
  });
  it("throttles redraws to at most once a second", () => {
    expect(BOARD_REFRESH_MS).toBeGreaterThanOrEqual(1000);
  });
});

describe("walk-mode pinned-note layout", () => {
  const counts = (n: Partial<Record<BoardColumn, number>>) => ({ queued: 0, running: 0, waiting: 0, done: 0, failed: 0, ...n });
  it("fits the physical board face exactly (canvas aspect = WHITEBOARD_FACE aspect)", () => {
    expect(BOARD_TEX_W / BOARD_TEX_H).toBeCloseTo(WHITEBOARD_FACE.w / WHITEBOARD_FACE.h, 2);
  });
  it("draws five equal columns in the popup's order, left to right, inside the canvas", () => {
    const cols = boardNotesLayout(BOARD_TEX_W, BOARD_TEX_H, counts({}));
    expect(cols.map((c) => c.status)).toEqual([...BOARD_COLUMNS]);
    for (let i = 1; i < cols.length; i++) expect(cols[i]!.x).toBeGreaterThan(cols[i - 1]!.x + cols[i - 1]!.w);
    expect(cols[0]!.x).toBeGreaterThan(0);
    expect(cols[4]!.x + cols[4]!.w).toBeLessThan(BOARD_TEX_W);
    expect(new Set(cols.map((c) => Math.round(c.w))).size).toBe(1);
  });
  it.each([0, 1, 3, 4, 5, 12, 40])("%i notes in a column: every note and its pin stay inside the column, below the headings", (n) => {
    const [col] = boardNotesLayout(BOARD_TEX_W, BOARD_TEX_H, counts({ queued: n }));
    expect(col!.notes.length + col!.more).toBe(n);
    col!.notes.forEach((r, k) => {
      expect(r.x).toBeGreaterThanOrEqual(col!.x);
      expect(r.x + r.w).toBeLessThanOrEqual(col!.x + col!.w);
      expect(r.y - 8).toBeGreaterThan(BOARD_RULE_Y); // the pin (radius 8) clears the rule
      expect(r.y + r.h).toBeLessThanOrEqual(BOARD_TEX_H);
      if (k > 0) expect(r.y).toBeGreaterThanOrEqual(col!.notes[k - 1]!.y + BOARD_NOTE_H + 8); // room for the next pin
    });
    if (col!.more > 0) {
      const last = col!.notes[col!.notes.length - 1]!;
      expect(col!.moreY! - 10).toBeGreaterThan(last.y + last.h); // "+N more" sits under the last note
      expect(col!.moreY! + 10).toBeLessThanOrEqual(BOARD_TEX_H);
    } else expect(col!.moreY).toBeNull();
  });
  it("shows at least three readable notes per column", () => {
    const [col] = boardNotesLayout(BOARD_TEX_W, BOARD_TEX_H, counts({ queued: 40 }));
    expect(col!.notes.length).toBeGreaterThanOrEqual(3);
    expect(col!.notes[0]!.y).toBe(BOARD_NOTES_TOP);
    expect(col!.notes[0]!.w).toBeGreaterThan(160);
  });
  it("tilts notes like the popup's pinned cards", () => {
    expect([1, 2, 3, 4, 5].map(noteTilt)).toEqual([-0.6, 0.5, -1.1, 0.8, -0.3]);
  });
});

describe("walk-mode board drawing", () => {
  const lines: BoardLine[] = [
    { title: "Queue the login form", status: "queued", meta: "Pixel" },
    { title: "Build the API", status: "running", meta: "Byte" },
    { title: "Pick a colour", status: "waiting" },
    { title: "Ship docs", status: "done" },
    { title: "Broken build", status: "failed" },
  ];
  it("pins one status-coloured note per task, with a red pin, under the column headings", () => {
    const ctx = fakeCtx();
    drawBoard(ctx, "Pod A · tasks", lines);
    const texts = ctx.log.text.map((t) => t.s);
    expect(texts[0]).toBe("Pod A · tasks");
    // Column headings in the popup's order, each with its count.
    const heads = BOARD_COLUMNS.map((c) => texts.indexOf(BOARD_LABELS[c]));
    expect(heads.every((i) => i > 0)).toBe(true);
    expect([...heads].sort((a, b) => a - b)).toEqual(heads);
    // Titles may wrap onto a second line of the note.
    for (const l of lines) expect(texts.join(" ")).toContain(l.title);
    expect(texts).toContain("Pixel");
    // Each note is filled with the popup's status colour, and gets a pin (one arc each).
    for (const l of lines) expect(ctx.log.fills).toContain(BOARD_COLORS[l.status]);
    expect(ctx.log.arcs).toBe(lines.length);
    expect(ctx.log.stops).toEqual(expect.arrayContaining([...PIN_COLORS]));
    expect(ctx.log.rotations).toHaveLength(lines.length);
    // Titles sit below the heading rule.
    const title = ctx.log.text.find((t) => t.s === "Build the API")!;
    expect(title.font).toMatch(/bold 2\dpx/); // big enough to read standing close
  });
  it("uses the popup's cork colours for the theme", () => {
    const light = fakeCtx();
    drawBoard(light, "Manager board", lines, "light");
    expect(light.log.stops.slice(0, 3)).toEqual(BOARD_THEME.light.stops);
    const dark = fakeCtx();
    drawBoard(dark, "Manager board", lines, "dark");
    expect(dark.log.stops.slice(0, 3)).toEqual(BOARD_THEME.dark.stops);
    expect(dark.log.text[0]!.fill).toBe(BOARD_THEME.dark.text);
  });
  it("says so when the board is empty, and adds '+N more' for a full column", () => {
    const empty = fakeCtx();
    drawBoard(empty, "Manager board", [], "light", "No requests yet");
    expect(empty.log.text.map((t) => t.s)).toContain("No requests yet");
    expect(empty.log.arcs).toBe(0);
    const full = fakeCtx();
    drawBoard(full, "Pod A · tasks", Array.from({ length: 9 }, (_, i) => ({ title: `Task ${i}`, status: "running" as const })));
    expect(full.log.text.map((t) => t.s).some((s) => /^\+\d+ more$/.test(s))).toBe(true);
  });
  it("wraps long titles to two lines and ends a cut title with an ellipsis", () => {
    const ctx = fakeCtx();
    ctx.font = "bold 20px system-ui";
    // 11px per character: 10 characters per 110px line.
    expect(wrapLines(ctx, "Short", 110, 2)).toEqual(["Short"]);
    expect(wrapLines(ctx, "Build the login page for users", 110, 2)).toEqual(["Build the", "login pag…"]);
    const hard = wrapLines(ctx, "Supercalifragilistic", 110, 2);
    expect(hard).toHaveLength(2);
    hard.forEach((l) => expect(l.length * 11).toBeLessThanOrEqual(110));
  });
});

describe("walk exit position", () => {
  it("records where the player stopped so the You robot can walk home", () => {
    useWalk.getState().setExitAt({ x: 3, z: -2 });
    expect(useWalk.getState().exitAt).toMatchObject({ x: 3, z: -2 });
  });
});

describe("whiteboard overlay pose mirrors kit.ts", () => {
  const spaces = buildSpaces(2);
  // Every room with a board, across a bigger floor: the office, several pods at different hex
  // positions, and meeting rooms (which use a different corner slot).
  const rooms = buildSpaces(3).filter((s) => s.kind !== "lounge");
  it("covers several rooms and both corner slots", () => {
    expect(rooms.length).toBeGreaterThanOrEqual(4);
    expect(new Set(rooms.map((r) => r.kind))).toEqual(new Set(["office", "pod", "meeting"]));
  });
  it.each(rooms.map((s) => [s.id, s] as const))("%s: live face sits 2-4 mm in front of the physical board", (_kind, space) => {
    const kit = new Kit();
    furnishSpace(kit, space, { seats: new Map() });
    const boards = kit.items.filter((it) => it.mat === "whiteboard");
    expect(boards).toHaveLength(1);
    const b = boards[0]!;
    const pose = whiteboardPose(space);
    expect(pose.yaw).toBeCloseTo(b.yaw, 9);
    expect(b.rx).toBe(0);
    const nx = Math.sin(b.yaw), nz = Math.cos(b.yaw);
    // Physical front face = box centre + half depth along the normal.
    const front = { x: b.x + nx * b.sz / 2, z: b.z + nz * b.sz / 2 };
    const dx = pose.face[0] - front.x, dz = pose.face[2] - front.z;
    const along = dx * nx + dz * nz;
    expect(along).toBeGreaterThanOrEqual(0.002);
    expect(along).toBeLessThanOrEqual(0.004);
    expect(Math.abs(dx * nz - dz * nx)).toBeLessThan(1e-9); // no sideways drift
    expect(pose.face[1]).toBeCloseTo(b.y, 9);
    expect(BOARD_FACE_NUDGE).toBeGreaterThanOrEqual(0.002);
  });
  it("uses different corners for pods and meeting rooms", () => {
    const pod = spaces.find((s) => s.kind === "pod")!;
    const meet = spaces.find((s) => s.kind === "meeting")!;
    const a = whiteboardPose({ ...pod, x: 0, z: 0 }), m = whiteboardPose({ ...meet, x: 0, z: 0 });
    expect(a.yaw).not.toBeCloseTo(m.yaw, 3);
  });
});
