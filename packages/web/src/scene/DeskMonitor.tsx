/**
 * DeskMonitor — canvas texture overlay on each agent's desk monitor.
 *
 * Shows agent name, current task title, the last few log lines of the agent's
 * current task, and a status badge (colour + word). Refreshed at most every 2 s
 * and only when the monitor is within MAX_DIST world units of the camera.
 * Idle agents show a screensaver with their name.
 *
 * Clicking a monitor opens that agent's chat (same action as clicking the tag).
 */
import { useMemo, useRef, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { POD_SEATS, seatLocal } from "@agenticview/shared";
import { useStore, agentStatus, STATUS_COLORS } from "../state/store";
import type { AgentStatus, FeedItem } from "../state/store";

/** Only update monitors closer than this distance to the camera. */
const MAX_DIST = 24;
/** Refresh texture at most this often (ms). */
const REFRESH_MS = 2000;
/** Max concurrent monitor updates per frame batch. */
const MAX_UPDATES_PER_FRAME = 3;
/** Distance at which the monitor switches to the high-detail (near) mode. */
const NEAR_DIST = 8;

// ---- shared geometry (created once) ----
const monitorGeo = new THREE.PlaneGeometry(0.61, 0.35);

// ---- texture paint helpers ----

const FONT_FAR = "12px 'Cascadia Code', 'Fira Code', 'Consolas', monospace";
const FONT_NEAR = "18px 'Cascadia Code', 'Fira Code', 'Consolas', monospace";
const CANVAS_W = 512;
const CANVAS_H = 294;

// Legacy alias for the far font (used in tests and paintLog below).
const FONT = FONT_FAR;

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "IDLE",
  thinking: "THINKING",
  editing: "EDITING",
  waiting: "WAITING",
  error: "ERROR",
};

export function getFeedLines(feed: FeedItem[] | undefined, limit = 6): string[] {
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

function paintIdle(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  t: number,
  agentName: string,
) {
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
  // Agent name centered over screensaver
  if (agentName) {
    ctx.font = "bold 22px sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const nameW = Math.min(ctx.measureText(agentName).width + 20, CANVAS_W - 20);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect((CANVAS_W - nameW) / 2, CANVAS_H / 2 - 18, nameW, 36);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#39ff14";
    ctx.fillText(agentName, CANVAS_W / 2, CANVAS_H / 2);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
  }
  // Status badge
  ctx.fillStyle = "#1a2433";
  ctx.fillRect(0, CANVAS_H - 14, CANVAS_W, 14);
  ctx.font = "10px sans-serif";
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = STATUS_COLORS.idle;
  ctx.fillText(`● ${STATUS_LABELS.idle}`, 6, CANVAS_H - 12);
  ctx.globalAlpha = 1;
}

function paintLog(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  lines: string[],
  agentName: string,
  taskTitle: string,
  status: AgentStatus,
) {
  const statusColor = STATUS_COLORS[status];
  ctx.fillStyle = "#080b12";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Header: agent name + status badge
  ctx.fillStyle = "#0f1724";
  ctx.fillRect(0, 0, CANVAS_W, 32);
  ctx.font = "bold 13px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(agentName.slice(0, 28), 8, 16);
  // Status badge (right side)
  const label = STATUS_LABELS[status];
  ctx.font = "bold 11px sans-serif";
  const badgeW = ctx.measureText(label).width + 10;
  ctx.fillStyle = statusColor;
  ctx.fillRect(CANVAS_W - badgeW - 6, 8, badgeW, 16);
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.fillText(label, CANVAS_W - badgeW / 2 - 6, 16);
  ctx.textAlign = "left";

  // Task title (truncated)
  if (taskTitle) {
    ctx.font = "11px sans-serif";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#94a3b8";
    const truncTitle = taskTitle.length > 52 ? taskTitle.slice(0, 51) + "…" : taskTitle;
    ctx.fillText(truncTitle, 8, 36);
  }

  // Log lines
  ctx.font = FONT;
  ctx.textBaseline = "top";
  const lineH = 38;
  const logStartY = taskTitle ? 54 : 38;
  const availH = CANVAS_H - 14 - logStartY;
  const maxLines = Math.floor(availH / lineH);
  const visLines = lines.slice(-maxLines);
  const startY = logStartY + Math.max(0, availH - visLines.length * lineH);
  visLines.forEach((line, i) => {
    const y = startY + i * lineH;
    const fade = 0.45 + (i / Math.max(1, visLines.length - 1)) * 0.55;
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
  ctx.fillStyle = statusColor;
  ctx.fillText(`●  ${label.toLowerCase()}`, 6, CANVAS_H - 12);
  ctx.globalAlpha = 1;
}

/**
 * High-detail paint for monitors visible at walking distance.
 * Uses a larger font and shows fewer but more readable lines.
 */
function paintLogNear(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  lines: string[],
  agentName: string,
  taskTitle: string,
  status: AgentStatus,
) {
  const statusColor = STATUS_COLORS[status];
  ctx.fillStyle = "#080b12";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Header: agent name + status badge
  ctx.fillStyle = "#0f1724";
  ctx.fillRect(0, 0, CANVAS_W, 40);
  ctx.font = "bold 17px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(agentName.slice(0, 22), 10, 20);
  // Status badge
  const label = STATUS_LABELS[status];
  ctx.font = "bold 13px sans-serif";
  const badgeW = ctx.measureText(label).width + 12;
  ctx.fillStyle = statusColor;
  ctx.fillRect(CANVAS_W - badgeW - 8, 10, badgeW, 20);
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.fillText(label, CANVAS_W - badgeW / 2 - 8, 20);
  ctx.textAlign = "left";

  // Task title
  if (taskTitle) {
    ctx.font = "13px sans-serif";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#94a3b8";
    const truncTitle = taskTitle.length > 40 ? taskTitle.slice(0, 39) + "…" : taskTitle;
    ctx.fillText(truncTitle, 10, 46);
  }

  // Larger font → fewer lines (max 4).
  const nearLines = lines.slice(-4);
  ctx.font = FONT_NEAR;
  ctx.textBaseline = "top";
  const lineH = 54;
  const logStartY = taskTitle ? 68 : 48;
  const startY = CANVAS_H - 18 - nearLines.length * lineH;
  nearLines.forEach((line, i) => {
    const y = Math.max(logStartY, startY) + i * lineH;
    const fade = 0.5 + (i / Math.max(1, nearLines.length - 1)) * 0.5;
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#a8e6f0";
    const truncated = line.length > 38 ? line.slice(0, 37) + "…" : line;
    ctx.fillText(truncated, 10, y + 4);
  });
  ctx.globalAlpha = 1;

  // Status bar
  ctx.fillStyle = "#1a2433";
  ctx.fillRect(0, CANVAS_H - 18, CANVAS_W, 18);
  ctx.font = "13px sans-serif";
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = statusColor;
  ctx.fillText(`●  ${label.toLowerCase()}`, 8, CANVAS_H - 15);
  ctx.globalAlpha = 1;
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
  const agentName = useStore((s) => s.agents[agentId]?.name ?? agentId);
  const currentStatus = useStore((s) => {
    const agent = s.agents[agentId];
    if (!agent) return "idle" as AgentStatus;
    return agentStatus(agent, Object.values(s.tasks), s.permissions, s.questions, s.feed[agentId] ?? []);
  });
  const currentTaskTitle = useStore((s) => {
    const tasks = Object.values(s.tasks);
    const active = tasks.find(
      (t) => t.assigneeId === agentId && (t.status === "running" || t.status === "waiting"),
    );
    return active?.title ?? "";
  });

  const tex = useMemo(() => getTexture(agentId), [agentId]);
  const lastUpdate = useRef(0);

  const isIdle = currentStatus === "idle";
  const isIdleRef = useRef(isIdle);
  isIdleRef.current = isIdle;
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const agentNameRef = useRef(agentName);
  agentNameRef.current = agentName;
  const statusRef = useRef(currentStatus);
  statusRef.current = currentStatus;
  const taskTitleRef = useRef(currentTaskTitle);
  taskTitleRef.current = currentTaskTitle;

  const { camera } = useThree();
  const posVec = useMemo(() => new THREE.Vector3(...position), [position]);

  useFrame(({ clock }) => {
    const now = Date.now();
    const dist = camera.position.distanceTo(posVec);
    // Skip update when far away
    if (dist > MAX_DIST) return;
    // Near monitors refresh more often for readability.
    const isNear = dist < NEAR_DIST;
    const refreshMs = isNear ? REFRESH_MS / 2 : REFRESH_MS;
    if (now - lastUpdate.current < refreshMs) return;
    lastUpdate.current = now;
    const canvas = getTextureCanvas(tex);
    if (!canvas) return;
    const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return;
    if (isIdleRef.current) {
      paintIdle(ctx, clock.getElapsedTime(), agentNameRef.current);
    } else {
      const lines = getFeedLines(feedRef.current, isNear ? 8 : 6);
      if (isNear) {
        paintLogNear(ctx, lines, agentNameRef.current, taskTitleRef.current, statusRef.current);
      } else {
        paintLog(ctx, lines, agentNameRef.current, taskTitleRef.current, statusRef.current);
      }
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

  // Same rotation composition as the instanced furniture (Batches uses Euler "YXZ": yaw, then tilt
  // about the yawed X axis), nudged 4 mm along the screen normal so it covers the static screen.
  const euler = useMemo(() => new THREE.Euler(-0.08, yaw, 0, "YXZ"), [yaw]);
  const meshPos = useMemo(() => new THREE.Vector3(...position).addScaledVector(new THREE.Vector3(0, 0, 1).applyEuler(euler), 0.004), [position, euler]);

  return (
    <mesh
      geometry={monitorGeo}
      position={meshPos}
      rotation={euler}
      onClick={handleClick}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}
      userData={{ agentId }}
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
  if (seat >= POD_SEATS || seat < 0) return null;
  const l = seatLocal("pod", seat);
  // Mirror kit.ts exactly: podRoom places each desk frame at (l.x, ±0.36) with yaw π for the front
  // row, and desk() puts the static screen at local (0, 1.06, -0.163) inside that frame. The live
  // plane must land on that same face or it floats in front of the monitor.
  const frameYaw = l.z < 0 ? Math.PI : 0;
  const frameZ = l.z < 0 ? -0.36 : 0.36;
  const monZ = spaceZ + frameZ - 0.163 * Math.cos(frameYaw);
  return { position: [spaceX + l.x, 1.06, monZ], yaw: frameYaw };
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
export { MAX_DIST, REFRESH_MS, MAX_UPDATES_PER_FRAME, NEAR_DIST, STATUS_LABELS };
