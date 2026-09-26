/**
 * DeskMonitor — canvas texture overlay on each agent's desk monitor.
 *
 * Shows the last few log lines of the agent's current task, refreshed at most
 * every 2 s and only when the monitor is within MAX_DIST world units of the camera.
 * Idle agents show a cheap procedural screensaver animation.
 *
 * Clicking a monitor opens that agent's chat (same action as clicking the tag).
 */
import { useMemo, useRef, useCallback, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { seatLocal } from "@agenticview/shared";
import { useStore } from "../state/store";
import type { FeedItem } from "../state/store";

/** Only update monitors closer than this distance to the camera. */
const MAX_DIST = 24;
/** Refresh texture at most this often (ms). */
const REFRESH_MS = 2000;
/** Max concurrent monitor updates per frame batch. */
const MAX_UPDATES_PER_FRAME = 3;

// ---- shared geometry (created once) ----
const monitorGeo = new THREE.PlaneGeometry(0.61, 0.35);

// ---- texture paint helpers ----

const FONT = "12px 'Cascadia Code', 'Fira Code', 'Consolas', monospace";
const CANVAS_W = 512;
const CANVAS_H = 294;

function getFeedLines(feed: FeedItem[] | undefined, limit = 6): string[] {
  if (!feed || feed.length === 0) return [];
  return feed
    .slice(-limit)
    .map((item): string => {
      if ("user" in item) return `> ${item.user.slice(0, 60)}`;
      const ev = item.event;
      switch (ev.type) {
        case "text": return ev.text.trim().slice(0, 60);
        case "tool_start": return `[${ev.name}]`;
        case "file_changed": {
          const parts = ev.path.replace(/\\/g, "/").split("/");
          return `${ev.kind === "create" ? "+" : "~"} ${parts[parts.length - 1]}`;
        }
        case "status": return ev.text.slice(0, 60);
        default: return "";
      }
    })
    .filter(Boolean);
}

function paintIdle(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, t: number) {
  ctx.fillStyle = "#0a0c14";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Simple matrix-rain screensaver: a few falling green chars
  const cols = 20;
  const cw = CANVAS_W / cols;
  ctx.font = `${Math.round(cw * 0.7)}px monospace`;
  ctx.textBaseline = "top";
  for (let c = 0; c < cols; c++) {
    const phase = (t * 0.9 + c * 0.41) % 1;
    const row = Math.floor(phase * 16);
    const alpha = 1 - phase * 0.6;
    const bright = c % 3 === 0;
    ctx.globalAlpha = alpha * (bright ? 1 : 0.4);
    ctx.fillStyle = bright ? "#39ff14" : "#1a8c06";
    const char = String.fromCharCode(0x30a0 + ((c * 7 + row) % 96));
    ctx.fillText(char, c * cw + 2, row * (CANVAS_H / 16));
  }
  ctx.globalAlpha = 1;
}

function paintLog(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, lines: string[]) {
  ctx.fillStyle = "#080b12";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.font = FONT;
  ctx.textBaseline = "top";
  const lineH = 44;
  const startY = CANVAS_H - lines.length * lineH - 6;
  lines.forEach((line, i) => {
    const y = startY + i * lineH;
    const fade = 0.45 + (i / Math.max(1, lines.length - 1)) * 0.55;
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#7ec8e3";
    ctx.fillText(line, 8, y + 4);
  });
  ctx.globalAlpha = 1;
  // Tiny status bar
  ctx.fillStyle = "#1a2433";
  ctx.fillRect(0, CANVAS_H - 14, CANVAS_W, 14);
  ctx.font = "10px sans-serif";
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "#4caf50";
  ctx.fillText("●  live", 6, CANVAS_H - 12);
  ctx.globalAlpha = 1;
}

// ---- shared canvas for painting (one at a time) ----

let sharedCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

function getCanvas(): HTMLCanvasElement | OffscreenCanvas | null {
  if (sharedCanvas) return sharedCanvas;
  if (typeof OffscreenCanvas !== "undefined") {
    sharedCanvas = new OffscreenCanvas(CANVAS_W, CANVAS_H);
  } else if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = CANVAS_W;
    c.height = CANVAS_H;
    sharedCanvas = c;
  }
  return sharedCanvas;
}

// ---- Per-monitor texture pool ----

/** One texture per agent (created on demand, reused across re-renders). */
const texturePool = new Map<string, THREE.CanvasTexture>();

function getTexture(agentId: string): THREE.CanvasTexture {
  let tex = texturePool.get(agentId);
  if (!tex) {
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(CANVAS_W, CANVAS_H)
      : (() => { const c = document.createElement("canvas"); c.width = CANVAS_W; c.height = CANVAS_H; return c; })();
    tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    texturePool.set(agentId, tex);
  }
  return tex;
}

function getTextureCanvas(tex: THREE.CanvasTexture): HTMLCanvasElement | OffscreenCanvas | null {
  return (tex.image as HTMLCanvasElement | OffscreenCanvas | null) ?? null;
}

// ---- Component ----

interface DeskMonitorProps {
  agentId: string;
  /** World position of the monitor face (center of screen). */
  position: [number, number, number];
  /** Y-axis rotation (facing direction, toward the agent). */
  yaw: number;
}

/**
 * A single monitor screen overlay.
 * Rendered as a thin plane mesh on top of the Batches desk screen.
 */
export function DeskMonitor({ agentId, position, yaw }: DeskMonitorProps) {
  const select = useStore((s) => s.select);
  const feed = useStore((s) => s.feed[agentId]);
  const tasks = useStore((s) => s.tasks);
  const tex = useMemo(() => getTexture(agentId), [agentId]);
  const lastUpdate = useRef(0);
  const isIdle = useMemo(() => {
    const agentTasks = Object.values(tasks).filter((t) => t.assigneeId === agentId);
    return !agentTasks.some((t) => t.status === "running" || t.status === "waiting");
  }, [tasks, agentId]);
  const isIdleRef = useRef(isIdle);
  isIdleRef.current = isIdle;
  const feedRef = useRef(feed);
  feedRef.current = feed;

  const { camera } = useThree();
  const posVec = useMemo(() => new THREE.Vector3(...position), [position]);

  useFrame(({ clock }) => {
    const now = Date.now();
    const dist = camera.position.distanceTo(posVec);
    // Skip update when far away
    if (dist > MAX_DIST) return;
    if (now - lastUpdate.current < REFRESH_MS) return;
    lastUpdate.current = now;
    const canvas = getTextureCanvas(tex);
    if (!canvas) return;
    const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return;
    if (isIdleRef.current) {
      paintIdle(ctx, clock.getElapsedTime());
    } else {
      const lines = getFeedLines(feedRef.current, 6);
      paintLog(ctx, lines);
    }
    tex.needsUpdate = true;
  });

  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      select(agentId);
    },
    [agentId, select],
  );

  return (
    <mesh
      geometry={monitorGeo}
      position={position}
      rotation={[-0.08, yaw, 0]}
      onClick={handleClick}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

// ---- Monitor throttle wrapper ----

/** Returns the monitor world position for a given pod space + seat. */
export function monitorPoseForSeat(
  spaceX: number,
  spaceZ: number,
  seat: number,
): { position: [number, number, number]; yaw: number } | null {
  if (seat >= 4) return null; // only pod seats 0-3
  const l = seatLocal("pod", seat);
  // The desk is offset from the seat along the seat's forward axis
  const fwdZ = Math.cos(l.yaw); // 1 for yaw=0, -1 for yaw=π
  const monX = spaceX + l.x;
  const monZ = spaceZ + l.z + fwdZ * 1.02;
  // Monitor faces toward agent = yaw + π
  const monYaw = l.yaw + Math.PI;
  return { position: [monX, 1.06, monZ], yaw: monYaw };
}

// ---- Throttled batch of monitors ----

interface AllDeskMonitorsProps {
  /** Array of {agentId, spaceX, spaceZ, seat}. */
  desks: { agentId: string; spaceX: number; spaceZ: number; seat: number }[];
}

/** Renders all desk monitors, throttling concurrent updates via MAX_UPDATES_PER_FRAME. */
export function AllDeskMonitors({ desks }: AllDeskMonitorsProps) {
  return (
    <>
      {desks.map(({ agentId, spaceX, spaceZ, seat }) => {
        const pose = monitorPoseForSeat(spaceX, spaceZ, seat);
        if (!pose) return null;
        return (
          <DeskMonitor
            key={agentId}
            agentId={agentId}
            position={pose.position}
            yaw={pose.yaw}
          />
        );
      })}
    </>
  );
}

// Re-export for throttle testing
export { getFeedLines, MAX_DIST, REFRESH_MS, MAX_UPDATES_PER_FRAME };
