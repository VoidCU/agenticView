/**
 * Whiteboard: one per pod / meeting room. In the overview it shows coloured sticky
 * notes; while walking and near it, the board face is a canvas texture listing the
 * room's task titles with their status so it can be read in first person.
 * Clicking it (pointer or walk-mode crosshair via userData.boardSpaceId) opens the full board.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useCursor } from "@react-three/drei";
import * as THREE from "three";
import { HEX_R, yawToward, type Agent, type Space, type Task } from "@agenticview/shared";
import { useStore } from "../state/store";
import { useWalk } from "../state/walk";
import { BOARD_COLORS, BOARD_LABELS, boardColumn, podBoard, type BoardColumn } from "../state/boards";

const DEG = Math.PI / 180;
/** The readable texture is only drawn when the camera is this close (world units). */
export const BOARD_NEAR_DIST = 9;
/** Minimum time between texture redraws. */
export const BOARD_REFRESH_MS = 1000;
/** Max task rows drawn on the board. */
export const BOARD_MAX_LINES = 9;
const BOARD_W = 1.6;
const BOARD_H = 0.94;
const TEX_W = 1024;
const TEX_H = Math.round((TEX_W * BOARD_H) / BOARD_W);

export interface BoardLine { title: string; status: BoardColumn }

const ORDER: BoardColumn[] = ["running", "waiting", "failed", "queued", "done"];

/** Task lines for a room's board: active work first, then recent done. */
export function boardLines(space: Space, agents: Agent[], tasks: Task[]): BoardLine[] {
  let lines: BoardLine[];
  if (space.kind === "pod") {
    const { columns } = podBoard(space.id, agents, tasks);
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
  const shown = lines.slice(0, BOARD_MAX_LINES);
  const rowH = Math.min(58, (h - 100) / shown.length);
  const tagW = 230;
  shown.forEach((line, i) => {
    const y = 96 + i * rowH;
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
  if (lines.length > shown.length) {
    ctx.fillStyle = "#7b8499";
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText(`+${lines.length - shown.length} more · click to open`, w - 400, h - 22);
  }
}

/** The readable face, mounted only while walking; redraws at most once per second and only when near. */
function BoardFace({ space, heading, world }: { space: Space; heading: string; world: THREE.Vector3 }) {
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
  const [near, setNear] = useState(false);

  useFrame(({ camera }) => {
    const now = performance.now();
    if (now - last.current.at < BOARD_REFRESH_MS) return;
    last.current.at = now;
    const isNear = camera.position.distanceTo(world) < BOARD_NEAR_DIST;
    if (isNear !== near) setNear(isNear);
    if (!isNear) return;
    const s = useStore.getState();
    const lines = boardLines(space, Object.values(s.agents), Object.values(s.tasks));
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
    <mesh position={[0, 1.12, 0.085]} raycast={() => null}>
      <planeGeometry args={[BOARD_W, BOARD_H]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

export function Whiteboard({ space, onOpen }: { space: Space; onOpen: (space: Space) => void }) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const walking = useWalk((s) => s.walking);
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const board = useMemo(() => podBoard(space.id, Object.values(agents), Object.values(tasks)), [space.id, agents, tasks]);
  const active = (["queued", "running", "waiting", "failed"] as const).flatMap((status) => board.columns[status].map((task) => ({ task, status })));
  const angle = (space.kind === "meeting" ? 180 : 240) * DEG;
  const x = ((4.4 * HEX_R) / 6) * Math.cos(angle);
  const z = ((4.4 * HEX_R) / 6) * Math.sin(angle);
  const world = useMemo(() => new THREE.Vector3(space.x + x, 1.12, space.z + z), [space.x, space.z, x, z]);
  const cols = Math.max(6, Math.ceil(Math.sqrt(active.length * 1.7)));
  const rows = Math.max(3, Math.ceil(active.length / cols));
  const heading = space.kind === "pod" ? `${space.name} · tasks` : "Manager board";
  return <group position={[space.x + x, 0, space.z + z]} rotation={[0, yawToward({ x, z }, { x: 0, z: 0 }), 0]}>
    <mesh position={[0, 1.12, 0.04]}
      userData={{ boardSpaceId: space.id }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }} onPointerOut={() => setHovered(false)}
      onClick={(e) => { e.stopPropagation(); if (e.delta <= 4) { setHovered(false); onOpen(space); } }}>
      <boxGeometry args={[1.72, 1.02, 0.055]} />
      <meshBasicMaterial color="#78baff" transparent opacity={hovered ? 0.24 : 0} depthWrite={false} />
    </mesh>
    {walking && <BoardFace space={space} heading={heading} world={world} />}
    {space.kind === "pod" && active.map(({ task, status }, i) => <mesh key={task.id} position={[-0.7 + ((i % cols) + 0.5) * 1.4 / cols, 1.5 - (Math.floor(i / cols) + 0.5) * 0.75 / rows, 0.076]} raycast={() => null}>
      <planeGeometry args={[1.12 / cols, 0.57 / rows]} /><meshBasicMaterial color={BOARD_COLORS[status]} side={THREE.DoubleSide} />
    </mesh>)}
    <Html center position={[0, 1.9, 0]} distanceFactor={14} zIndexRange={[9, 0]}>
      <button type="button" className={`board-open ${hovered ? "is-hover" : ""}`} aria-label={space.kind === "pod" ? `Open ${space.name} board` : `Open Manager board from ${space.name}`}
        onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onClick={() => { setHovered(false); onOpen(space); }}>
        {space.kind === "pod" ? `Tasks · ${active.length}` : "Manager board"}
      </button>
    </Html>
  </group>;
}
