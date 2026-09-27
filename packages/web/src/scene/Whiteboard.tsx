/**
 * Whiteboard: one per pod / meeting / production / research room (and the manager's office). In the overview it shows coloured sticky
 * notes; while walking and near it, the board face is a canvas texture drawn in the same visual
 * language as the board popup (hud/PodBoard.tsx): the cork texture, the five kanban columns in the
 * popup's order with their handwritten headings and counts, and one pinned sticky note per task
 * (status colour, red pin, slight tilt) so the physical board reads like a small copy of the popup.
 * Team rooms pin their tasks; the manager's office and meeting rooms pin the Manager board's requests.
 * The overview sticky notes are hidden while the face is up so they never sit on top of it.
 * Clicking it (pointer or walk-mode crosshair via userData.boardSpaceId) opens the full board.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useCursor } from "@react-three/drei";
import * as THREE from "three";
import { type Agent, type OfficeLayout, type Space, type Task } from "@agenticview/shared";
import { useStore } from "../state/store";
import { useWalk } from "../state/walk";
import { cornerFrame, WHITEBOARD_FACE, whiteboardSlot } from "./kit";
import { currentTheme, type SceneTheme } from "./theme";
import { BOARD_COLORS, BOARD_COLUMNS, BOARD_LABELS, boardColumn, podBoard, type BoardColumn } from "../state/boards";

/** Live overlay sits this far in front of the physical board face (a few mm, like DeskMonitor). */
export const BOARD_FACE_NUDGE = 0.003;
const BOARD_OVERLAY_Z = WHITEBOARD_FACE.z + BOARD_FACE_NUDGE;

/**
 * World pose of the whiteboard frame for a room, mirroring kit.ts exactly: the same corner()
 * slot (WHITEBOARD_SLOT) and the same frame yaw. `face` is the world centre of the live overlay.
 */
export function whiteboardPose(space: Pick<Space, "kind" | "x" | "z">) {
  const slot = whiteboardSlot(space.kind);
  const c = cornerFrame(slot.angleDeg, slot.at);
  const x = space.x + c.x;
  const z = space.z + c.z;
  // Kit.frame maps local +z to (sin yaw, cos yaw).
  const face: [number, number, number] = [x + Math.sin(c.yaw) * BOARD_OVERLAY_Z, WHITEBOARD_FACE.y, z + Math.cos(c.yaw) * BOARD_OVERLAY_Z];
  return { x, z, yaw: c.yaw, face };
}
/** The readable texture is only drawn when the camera is this close (world units). */
export const BOARD_NEAR_DIST = 9;
/** Minimum time between texture redraws. */
export const BOARD_REFRESH_MS = 1000;
const BOARD_W = WHITEBOARD_FACE.w;
const BOARD_H = WHITEBOARD_FACE.h;
/** Board face canvas: 1024 wide at the physical face's aspect (exact fit on WHITEBOARD_FACE). */
export const BOARD_TEX_W = 1024;
export const BOARD_TEX_H = Math.round((BOARD_TEX_W * BOARD_H) / BOARD_W);

export interface BoardLine { title: string; status: BoardColumn; /** Small second line on the note: who works on it, or how much was delegated. */ meta?: string }

/** Rooms whose board lists their own seated workers' tasks (pods, production, research); others show the Manager board. */
export function isTeamRoom(space: Pick<Space, "kind">): boolean {
  return space.kind === "pod" || space.kind === "production" || space.kind === "research";
}

/**
 * The notes on a room's board, in the popup's column order (BOARD_COLUMNS) and, within a column, in
 * the popup's card order. Team rooms: their workers' tasks (podBoard). Other rooms: the manager's
 * requests (newest first), like the Manager board popup.
 */
export function boardLines(space: Space, agents: Agent[], tasks: Task[], layout?: OfficeLayout | null): BoardLine[] {
  if (isTeamRoom(space)) {
    const { columns } = podBoard(space.id, agents, tasks, layout);
    const names = new Map(agents.map((a) => [a.id, a.name]));
    return BOARD_COLUMNS.flatMap((status) => columns[status].map((t) => ({ title: t.title, status, meta: names.get(t.assigneeId) })));
  }
  const manager = agents.find((a) => a.role === "manager");
  const requests = tasks
    .filter((t) => t.kind === "request" && t.assigneeId === manager?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const delegated = (id: string) => tasks.filter((t) => t.parentId === id).length;
  const lines = requests.flatMap((t): BoardLine[] => {
    const status = boardColumn(t);
    if (!status) return [];
    const n = delegated(t.id);
    return [{ title: t.title, status, meta: n > 0 ? `${n} delegated` : "You asked" }];
  });
  return BOARD_COLUMNS.flatMap((status) => lines.filter((l) => l.status === status));
}

// ── Pinned-note layout ──────────────────────────────────────────────────────────────────────────

/** Side margin of the board canvas and gap between columns (px on the 1024-wide canvas). */
const BOARD_PAD = 22;
const COL_GAP = 12;
/** Heading row, then the column headings (handwritten, like .kanban-col-head), then the rule under them. */
export const BOARD_HEAD_Y = 34;
export const BOARD_COL_HEAD_Y = 84;
export const BOARD_RULE_Y = 104;
/** Top of the first note (leaves room for its pin above it). */
export const BOARD_NOTES_TOP = 124;
/** Pinned note size: two title lines and a meta line at a size readable from a couple of metres. */
export const BOARD_NOTE_H = 88;
/** Vertical gap between notes (the pin of the next note sits in it). */
export const BOARD_NOTE_GAP = 16;
const NOTE_INSET = 5;
const BOARD_BOTTOM_PAD = 10;
/** Space kept for a column's "+N more" line when not every note fits. */
export const BOARD_MORE_H = 30;

export interface NoteRect { x: number; y: number; w: number; h: number }
export interface BoardColumnLayout {
  status: BoardColumn;
  /** Column box (left edge and width). */
  x: number;
  w: number;
  /** One rect per note drawn (the first `notes.length` of the column's tasks). */
  notes: NoteRect[];
  /** Tasks in this column that did not fit ("+N more"). */
  more: number;
  /** Baseline centre of the "+N more" line, when more > 0. */
  moreY: number | null;
}

/** How many notes fit in a column of the given height, with or without the "+N more" line. */
function notesThatFit(space: number): number {
  return Math.max(0, Math.floor((space + BOARD_NOTE_GAP) / (BOARD_NOTE_H + BOARD_NOTE_GAP)));
}

/**
 * The walk-mode board's pinned-note layout: five equal columns in BOARD_COLUMNS order (the popup's
 * .kanban-columns grid), notes stacked top-down in each; a column whose notes do not all fit keeps the
 * last line for "+N more". Every note (and its pin) stays inside its column and the canvas.
 */
export function boardNotesLayout(canvasW: number, canvasH: number, counts: Record<BoardColumn, number>): BoardColumnLayout[] {
  const colW = (canvasW - BOARD_PAD * 2 - COL_GAP * (BOARD_COLUMNS.length - 1)) / BOARD_COLUMNS.length;
  const bottom = canvasH - BOARD_BOTTOM_PAD;
  return BOARD_COLUMNS.map((status, i) => {
    const x = BOARD_PAD + i * (colW + COL_GAP);
    const total = counts[status] ?? 0;
    const all = notesThatFit(bottom - BOARD_NOTES_TOP);
    const shown = total <= all ? total : notesThatFit(bottom - BOARD_MORE_H - BOARD_NOTES_TOP);
    const notes = Array.from({ length: shown }, (_, k) => ({
      x: x + NOTE_INSET,
      y: BOARD_NOTES_TOP + k * (BOARD_NOTE_H + BOARD_NOTE_GAP),
      w: colW - NOTE_INSET * 2,
      h: BOARD_NOTE_H,
    }));
    const more = total - shown;
    return { status, x, w: colW, notes, more, moreY: more > 0 ? bottom - BOARD_MORE_H / 2 : null };
  });
}

/** Tilt of the n-th note (1-based) in a column, in degrees: the popup's .kanban-card nth-child rotations. */
export function noteTilt(n: number): number {
  if (n % 5 === 0) return -0.3;
  if (n % 4 === 0) return 0.8;
  if (n % 3 === 0) return -1.1;
  if (n % 2 === 0) return 0.5;
  return -0.6;
}

/** Colours of the popup's .whiteboard-panel cork and .kanban-card notes, per theme. */
export const BOARD_THEME: Record<SceneTheme, { stops: [string, string, string]; grid: string; text: string; rule: string; pill: string; note: string }> = {
  light: { stops: ["#ede6d0", "#e2d8be", "#d8ceae"], grid: "rgba(160,130,70,0.09)", text: "#292e35", rule: "rgba(0,0,0,0.10)", pill: "rgba(0,0,0,0.16)", note: "#252a32" },
  dark: { stops: ["#2a2520", "#252018", "#201d14"], grid: "rgba(120,100,50,0.16)", text: "#f0eee5", rule: "rgba(255,255,255,0.12)", pill: "rgba(255,255,255,0.16)", note: "#1a1f26" },
};
/** The popup's pin (.kanban-card::before radial gradient). */
export const PIN_COLORS = ["#e05555", "#aa1515"] as const;
const HAND_FONT = "'Segoe Print', 'Comic Sans MS', cursive";
const UI_FONT = "system-ui, sans-serif";

/** Word-wraps `text` into at most `maxLines` lines no wider than `maxW`; the last line ends with "…" when cut. */
export function wrapLines(ctx: Pick<CanvasRenderingContext2D, "measureText">, text: string, maxW: number, maxLines: number): string[] {
  const fits = (s: string) => ctx.measureText(s).width <= maxW;
  // Words, with any word wider than a line hard-broken into pieces that fit ("glue": no space before).
  const tokens: { s: string; glue: boolean }[] = [];
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    let rest = word;
    let glue = false;
    while (!fits(rest) && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut--;
      tokens.push({ s: rest.slice(0, cut), glue });
      glue = true;
      rest = rest.slice(cut);
    }
    tokens.push({ s: rest, glue });
  }
  const lines: string[] = [];
  let cur = "";
  let k = 0;
  for (; k < tokens.length; k++) {
    const tk = tokens[k]!;
    const next = cur ? `${cur}${tk.glue ? "" : " "}${tk.s}` : tk.s;
    if (!cur || fits(next)) { cur = next; continue; }
    lines.push(cur);
    cur = "";
    if (lines.length === maxLines) break;
    cur = tk.s;
  }
  if (cur) lines.push(cur);
  if (k < tokens.length && lines.length > 0) {
    let last = lines[lines.length - 1]!;
    while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawNote(ctx: CanvasRenderingContext2D, rect: NoteRect, line: BoardLine, n: number, theme: SceneTheme) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((noteTilt(n) * Math.PI) / 180);
  ctx.translate(-rect.w / 2, -rect.h / 2);
  // Paper with the popup's soft drop shadow.
  ctx.shadowColor = "rgba(0,0,0,0.22)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = BOARD_COLORS[line.status];
  roundRectPath(ctx, 0, 0, rect.w, rect.h, 4);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  // Title (two lines) and a small meta line, in the note's dark ink.
  ctx.fillStyle = BOARD_THEME[theme].note;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 21px ${UI_FONT}`;
  const title = wrapLines(ctx, line.title, rect.w - 20, 2);
  title.forEach((t, k) => ctx.fillText(t, 10, 30 + k * 25));
  if (line.meta) {
    ctx.globalAlpha = 0.72;
    ctx.font = `16px ${UI_FONT}`;
    ctx.fillText(wrapLines(ctx, line.meta, rect.w - 20, 1)[0] ?? "", 10, rect.h - 10);
    ctx.globalAlpha = 1;
  }
  // The red pin at top centre, half above the note.
  const pin = ctx.createRadialGradient(rect.w / 2 - 2, -1.5, 1, rect.w / 2, 0, 8);
  pin.addColorStop(0, PIN_COLORS[0]);
  pin.addColorStop(1, PIN_COLORS[1]);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = pin;
  ctx.beginPath();
  ctx.arc(rect.w / 2, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draws the board face (cork, heading, columns, pinned notes). Exported for tests. */
export function drawBoard(ctx: CanvasRenderingContext2D, heading: string, lines: BoardLine[], theme: SceneTheme = "light", emptyText = "No tasks yet") {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const t = BOARD_THEME[theme];
  // Cork: the popup's 145deg gradient plus its faint 33px grid (scaled to the canvas).
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, t.stops[0]);
  bg.addColorStop(0.55, t.stops[1]);
  bg.addColorStop(1, t.stops[2]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = t.grid;
  for (let x = 40; x < w; x += 41) ctx.fillRect(x, 0, 1.5, h);
  for (let y = 40; y < h; y += 41) ctx.fillRect(0, y, w, 1.5);

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = t.text;
  ctx.font = `bold 32px ${HAND_FONT}`;
  ctx.fillText(heading, BOARD_PAD + 4, BOARD_HEAD_Y, w - BOARD_PAD * 2);

  const byCol = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, lines.filter((l) => l.status === c)])) as Record<BoardColumn, BoardLine[]>;
  const cols = boardNotesLayout(w, h, Object.fromEntries(BOARD_COLUMNS.map((c) => [c, byCol[c].length])) as Record<BoardColumn, number>);
  for (const col of cols) {
    // Column heading: label left, count pill right (like .kanban-col-head / .kanban-col-count).
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = t.text;
    ctx.font = `19px ${HAND_FONT}`;
    const count = String(byCol[col.status].length);
    ctx.fillText(BOARD_LABELS[col.status], col.x + 4, BOARD_COL_HEAD_Y, col.w - 44);
    ctx.font = `bold 16px ${UI_FONT}`;
    const pillW = Math.max(26, ctx.measureText(count).width + 14);
    ctx.fillStyle = t.pill;
    roundRectPath(ctx, col.x + col.w - pillW - 2, BOARD_COL_HEAD_Y - 12, pillW, 24, 12);
    ctx.fill();
    ctx.fillStyle = t.text;
    ctx.textAlign = "center";
    ctx.fillText(count, col.x + col.w - 2 - pillW / 2, BOARD_COL_HEAD_Y + 1);
    ctx.fillStyle = t.rule;
    ctx.fillRect(col.x, BOARD_RULE_Y, col.w, 2);
    col.notes.forEach((rect, k) => drawNote(ctx, rect, byCol[col.status][k]!, k + 1, theme));
    if (col.moreY !== null) {
      ctx.fillStyle = t.text;
      ctx.globalAlpha = 0.75;
      ctx.font = `bold 17px ${UI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`+${col.more} more`, col.x + col.w / 2, col.moreY);
      ctx.globalAlpha = 1;
    }
  }
  if (lines.length === 0) {
    ctx.fillStyle = t.text;
    ctx.globalAlpha = 0.75;
    ctx.font = `24px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emptyText, w / 2, (BOARD_NOTES_TOP + h) / 2);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
}

/** The readable face, mounted only while walking; redraws at most once per second and only when near. */
function BoardFace({ space, heading, emptyText, world, near, setNear }: { space: Space; heading: string; emptyText: string; world: THREE.Vector3; near: boolean; setNear: (near: boolean) => void }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = BOARD_TEX_W;
    canvas.height = BOARD_TEX_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const last = useRef({ at: 0, sig: "" });
  // Leaving walk mode unmounts the face: hand the board back to the overview sticky notes.
  useEffect(() => () => setNear(false), [setNear]);

  useFrame(({ camera }) => {
    const now = performance.now();
    if (now - last.current.at < BOARD_REFRESH_MS) return;
    last.current.at = now;
    const isNear = camera.position.distanceTo(world) < BOARD_NEAR_DIST;
    if (isNear !== near) setNear(isNear);
    if (!isNear) return;
    const s = useStore.getState();
    const lines = boardLines(space, Object.values(s.agents), Object.values(s.tasks), s.layout);
    const theme = currentTheme();
    const sig = heading + theme + JSON.stringify(lines);
    if (sig === last.current.sig) return;
    last.current.sig = sig;
    const ctx = (texture.image as HTMLCanvasElement).getContext("2d");
    if (!ctx) return;
    drawBoard(ctx, heading, lines, theme, emptyText);
    texture.needsUpdate = true;
  });

  if (!near) return null;
  return (
    <mesh position={[0, WHITEBOARD_FACE.y, BOARD_OVERLAY_Z]} raycast={() => null}>
      <planeGeometry args={[BOARD_W, BOARD_H]} />
      {/* Polygon offset on top of the few-mm nudge: no depth fighting with the board at long range. */}
      <meshBasicMaterial map={texture} toneMapped={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
    </mesh>
  );
}

export function Whiteboard({ space, onOpen }: { space: Space; onOpen: (space: Space) => void }) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const walking = useWalk((s) => s.walking);
  const [near, setNear] = useState(false);
  const faceShown = walking && near;
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const layout = useStore((s) => s.layout);
  const board = useMemo(() => podBoard(space.id, Object.values(agents), Object.values(tasks), layout), [space.id, agents, tasks, layout]);
  const active = (["queued", "running", "waiting", "failed"] as const).flatMap((status) => board.columns[status].map((task) => ({ task, status })));
  const pose = useMemo(() => whiteboardPose(space), [space]);
  const world = useMemo(() => new THREE.Vector3(...pose.face), [pose]);
  const euler = useMemo(() => new THREE.Euler(0, pose.yaw, 0, "YXZ"), [pose]);
  const cols = Math.max(6, Math.ceil(Math.sqrt(active.length * 1.7)));
  const rows = Math.max(3, Math.ceil(active.length / cols));
  const team = isTeamRoom(space);
  const heading = team ? `${space.name} · tasks` : "Manager board";
  const emptyText = team ? "No tasks yet" : "No requests yet";
  return <group position={[pose.x, 0, pose.z]} rotation={euler}>
    <mesh position={[0, 1.12, 0.04]}
      userData={{ boardSpaceId: space.id }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }} onPointerOut={() => setHovered(false)}
      onClick={(e) => { e.stopPropagation(); if (e.delta <= 4) { setHovered(false); onOpen(space); } }}
      // Invisible until hovered: no draw call per board (R3F still raycasts invisible meshes).
      visible={hovered}>
      <boxGeometry args={[1.72, 1.02, 0.055]} />
      <meshBasicMaterial color="#78baff" transparent opacity={hovered ? 0.24 : 0} depthWrite={false} />
    </mesh>
    {walking && <BoardFace space={space} heading={heading} emptyText={emptyText} world={world} near={near} setNear={setNear} />}
    {/* Overview sticky notes; while the walk-mode face is up close they are hidden so they never cover its pinned notes. */}
    {team && !faceShown && active.map(({ task, status }, i) => <mesh key={task.id} position={[-0.7 + ((i % cols) + 0.5) * 1.4 / cols, 1.5 - (Math.floor(i / cols) + 0.5) * 0.75 / rows, BOARD_OVERLAY_Z + 0.001]} raycast={() => null}>
      <planeGeometry args={[1.12 / cols, 0.57 / rows]} /><meshBasicMaterial color={BOARD_COLORS[status]} side={THREE.DoubleSide} />
    </mesh>)}
    {/* Overview control only: in walk mode the board is read up close and opened with the crosshair. */}
    {!walking && <Html center position={[0, 1.9, 0]} distanceFactor={14} zIndexRange={[9, 0]}>
      <button type="button" className={`board-open ${hovered ? "is-hover" : ""}`} aria-label={team ? `Open ${space.name} board` : `Open Manager board from ${space.name}`}
        onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onClick={() => { setHovered(false); onOpen(space); }}>
        {team ? `Tasks · ${active.length}` : "Manager board"}
      </button>
    </Html>}
  </group>;
}
