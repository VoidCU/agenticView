/**
 * Whiteboard: one per pod / meeting / production / research room (and the manager's office). In the overview it shows coloured sticky
 * notes; while walking and near it, the board face is a canvas texture listing the
 * room's task titles with their status so it can be read in first person: the compact
 * status-pill rows with clipped titles from the original walk board (0a73efc), with the
 * sticky notes hidden while it is up so they never sit on top of the rows.
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
import { BOARD_COLORS, BOARD_LABELS, boardColumn, podBoard, type BoardColumn } from "../state/boards";

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
/** Max task rows drawn on the board. */
export const BOARD_MAX_LINES = 9;
const BOARD_W = WHITEBOARD_FACE.w;
const BOARD_H = WHITEBOARD_FACE.h;
const TEX_W = 1024;
const TEX_H = Math.round((TEX_W * BOARD_H) / BOARD_W);

export interface BoardLine { title: string; status: BoardColumn }

const ORDER: BoardColumn[] = ["running", "waiting", "failed", "queued", "done"];

/** Task lines for a room's board: active work first, then recent done. */
/** Rooms whose board lists their own seated workers' tasks (pods, production, research); others show the Manager board. */
export function isTeamRoom(space: Pick<Space, "kind">): boolean {
  return space.kind === "pod" || space.kind === "production" || space.kind === "research";
}

export function boardLines(space: Space, agents: Agent[], tasks: Task[], layout?: OfficeLayout | null): BoardLine[] {
  let lines: BoardLine[];
  if (isTeamRoom(space)) {
    const { columns } = podBoard(space.id, agents, tasks, layout);
    lines = ORDER.flatMap((status) => columns[status].map((t) => ({ title: t.title, status })));
  } else {
    const manager = agents.find((a) => a.role === "manager");
    lines = tasks
      .filter((t) => t.kind === "request" && t.assigneeId === manager?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((t) => { const status = boardColumn(t); return status ? [{ title: t.title, status }] : []; })
      .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  }
  return lines;
}

/** Top of the first task row on the board canvas (below the heading and rule). */
export const BOARD_ROWS_TOP = 96;
const BOARD_ROW_MAX_H = 58;
const BOARD_FOOTER_H = 44;
const BOARD_BOTTOM_PAD = 8;

export interface BoardRowsLayout { shown: number; top: number; rowH: number; footerY: number | null }

/**
 * Row layout for the walk-mode board canvas: the compact status-pill rows of the original
 * walk board (0a73efc), fitted so the last row always ends inside the canvas and, when some
 * tasks are cut, above the "+N more" footer instead of under it.
 */
export function boardRowsLayout(canvasH: number, total: number): BoardRowsLayout {
  const shown = Math.min(total, BOARD_MAX_LINES);
  const more = total > shown;
  const bottom = canvasH - (more ? BOARD_FOOTER_H : BOARD_BOTTOM_PAD);
  const rowH = shown > 0 ? Math.min(BOARD_ROW_MAX_H, (bottom - BOARD_ROWS_TOP) / shown) : BOARD_ROW_MAX_H;
  return { shown, top: BOARD_ROWS_TOP, rowH, footerY: more ? canvasH - BOARD_FOOTER_H / 2 : null };
}

/** Draws the board face. Exported for tests. */
export function drawBoard(ctx: CanvasRenderingContext2D, heading: string, lines: BoardLine[]) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = "#fbfcfe";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1f2a44";
  ctx.font = "bold 46px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(heading, 36, 44);
  ctx.fillStyle = "#d5dbe7";
  ctx.fillRect(28, 80, w - 56, 3);
  if (lines.length === 0) {
    ctx.fillStyle = "#7b8499";
    ctx.font = "36px system-ui, sans-serif";
    ctx.fillText("No tasks yet", 36, 140);
    return;
  }
  const layout = boardRowsLayout(h, lines.length);
  const shown = lines.slice(0, layout.shown);
  const rowH = layout.rowH;
  const tagW = 230;
  shown.forEach((line, i) => {
    const y = layout.top + i * rowH;
    ctx.fillStyle = BOARD_COLORS[line.status];
    ctx.fillRect(28, y + 4, tagW, rowH - 10);
    ctx.fillStyle = "#1f2a44";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillText(BOARD_LABELS[line.status].replace(" (recent)", ""), 40, y + rowH / 2, tagW - 24);
    ctx.font = "32px system-ui, sans-serif";
    const maxW = w - tagW - 90;
    let title = line.title;
    while (title.length > 4 && ctx.measureText(title).width > maxW) title = title.slice(0, -2);
    if (title !== line.title) title = `${title.trimEnd()}…`;
    ctx.fillText(title, tagW + 50, y + rowH / 2);
  });
  if (layout.footerY !== null) {
    ctx.fillStyle = "#7b8499";
    ctx.font = "26px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`+${lines.length - shown.length} more · click to open`, w - 36, layout.footerY);
    ctx.textAlign = "left";
  }
}

/** The readable face, mounted only while walking; redraws at most once per second and only when near. */
function BoardFace({ space, heading, world, near, setNear }: { space: Space; heading: string; world: THREE.Vector3; near: boolean; setNear: (near: boolean) => void }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = TEX_W;
    canvas.height = TEX_H;
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
    const sig = heading + JSON.stringify(lines);
    if (sig === last.current.sig) return;
    last.current.sig = sig;
    const ctx = (texture.image as HTMLCanvasElement).getContext("2d");
    if (!ctx) return;
    drawBoard(ctx, heading, lines);
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
  const heading = isTeamRoom(space) ? `${space.name} · tasks` : "Manager board";
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
    {walking && <BoardFace space={space} heading={heading} world={world} near={near} setNear={setNear} />}
    {/* Overview sticky notes; while the walk-mode rows are up close they are hidden so they never cover the pills and titles. */}
    {isTeamRoom(space) && !faceShown && active.map(({ task, status }, i) => <mesh key={task.id} position={[-0.7 + ((i % cols) + 0.5) * 1.4 / cols, 1.5 - (Math.floor(i / cols) + 0.5) * 0.75 / rows, BOARD_OVERLAY_Z + 0.001]} raycast={() => null}>
      <planeGeometry args={[1.12 / cols, 0.57 / rows]} /><meshBasicMaterial color={BOARD_COLORS[status]} side={THREE.DoubleSide} />
    </mesh>)}
    {/* Overview control only: in walk mode the board is read up close and opened with the crosshair. */}
    {!walking && <Html center position={[0, 1.9, 0]} distanceFactor={14} zIndexRange={[9, 0]}>
      <button type="button" className={`board-open ${hovered ? "is-hover" : ""}`} aria-label={isTeamRoom(space) ? `Open ${space.name} board` : `Open Manager board from ${space.name}`}
        onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onClick={() => { setHovered(false); onOpen(space); }}>
        {isTeamRoom(space) ? `Tasks · ${active.length}` : "Manager board"}
      </button>
    </Html>}
  </group>;
}
