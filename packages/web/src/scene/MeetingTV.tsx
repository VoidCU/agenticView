/**
 * Meeting room TV: a canvas-texture plane placed over the kit's static TV screen.
 * Updated at most once per second.
 *
 * During an active brainstorm: topic, participant names, and answers received so far.
 * Otherwise: team dashboard (active requests, tasks done today, busy agents).
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HEX_R, yawToward, type Space } from "@agenticview/shared";
import { useStore, type BrainstormState } from "../state/store";

const DEG = Math.PI / 180;

/** World-space position of the TV screen from the meeting room kit (must mirror kit.ts tvStand). */
function tvScreenPose(space: Space): { x: number; y: number; z: number; yaw: number } {
  const angleDeg = 240;
  const atParam = 4.5;
  const dist = (atParam * HEX_R) / 6;
  const a = angleDeg * DEG;
  const cx = space.x + dist * Math.cos(a);
  const cz = space.z + dist * Math.sin(a);
  const yaw = yawToward({ x: cx, z: cz }, { x: space.x, z: space.z });
  // Screen local offset: z = 0.032 in corner frame → world using Kit.pt convention
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const x = cx + 0.032 * s;
  const z = cz + 0.032 * c;
  return { x, y: 1.35, z, yaw };
}

// 1024×576 ≈ 16:9
const TV_W = 1024;
const TV_H = 576;

function createCanvas() {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(TV_W, TV_H);
    return c;
  }
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = TV_W;
    c.height = TV_H;
    return c;
  }
  return null;
}

function drawBrainstorm(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  brainstorm: BrainstormState,
  now: number,
): void {
  // Background
  ctx.fillStyle = "#0a1628";
  ctx.fillRect(0, 0, TV_W, TV_H);

  // Title bar
  ctx.fillStyle = "#1a3a6e";
  ctx.fillRect(0, 0, TV_W, 70);

  ctx.fillStyle = "#7ab4ff";
  ctx.font = "bold 28px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("BRAINSTORM", 24, 35);

  // Pulsing dot
  const pulse = Math.sin((now / 500) * Math.PI) > 0;
  ctx.fillStyle = pulse ? "#ff4d4d" : "#802020";
  ctx.beginPath();
  ctx.arc(TV_W - 36, 35, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#aac8ff";
  ctx.font = "22px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("LIVE", TV_W - 52, 35);

  // Topic
  if (brainstorm.topic) {
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 34px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    const topic = brainstorm.topic.length > 60 ? brainstorm.topic.slice(0, 59) + "…" : brainstorm.topic;
    ctx.fillText(topic, TV_W / 2, 118);
  }

  // Participants
  if (brainstorm.participants.length > 0) {
    ctx.fillStyle = "#5b8cff";
    ctx.font = "18px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(brainstorm.participants.slice(0, 8).join("  ·  "), TV_W / 2, 158);
  }

  // Separator
  ctx.strokeStyle = "#2a4a8a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(24, 178);
  ctx.lineTo(TV_W - 24, 178);
  ctx.stroke();

  // Answers
  const answers = brainstorm.answers.slice(0, 8);
  const cols = answers.length > 4 ? 2 : 1;
  const colW = TV_W / cols;
  answers.forEach((ans, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * colW + 24;
    const y = 210 + row * 56;
    ctx.fillStyle = "#1e3a6e";
    ctx.beginPath();
    ctx.roundRect(x, y - 18, colW - 48, 44, 6);
    ctx.fill();
    ctx.fillStyle = "#c8d8ff";
    ctx.font = "20px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    const text = ans.length > (cols === 1 ? 60 : 40) ? ans.slice(0, cols === 1 ? 59 : 39) + "…" : ans;
    ctx.fillText(text, x + 14, y + 4);
  });
}

function drawDashboard(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  agents: Record<string, import("@agenticview/shared").Agent>,
  tasks: Record<string, import("@agenticview/shared").Task>,
): void {
  // Background
  ctx.fillStyle = "#06101e";
  ctx.fillRect(0, 0, TV_W, TV_H);

  // Header
  ctx.fillStyle = "#1a3a6e";
  ctx.fillRect(0, 0, TV_W, 60);
  ctx.fillStyle = "#7ab4ff";
  ctx.font = "bold 26px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("TEAM DASHBOARD", 24, 30);

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const allTasks = Object.values(tasks);
  const activeRequests = allTasks.filter((t) => t.kind === "request" && (t.status === "running" || t.status === "queued" || t.status === "waiting")).length;
  const doneToday = allTasks.filter((t) => {
    if (t.status !== "done") return false;
    const at = Date.parse(t.finishedAt ?? t.createdAt);
    return !Number.isNaN(at) && now - at < dayMs;
  }).length;
  const allAgents = Object.values(agents);
  const busyAgents = allAgents.filter((a) => {
    if (a.role !== "worker") return false;
    return allTasks.some((t) => t.assigneeId === a.id && (t.status === "running" || t.status === "waiting"));
  });
  const idleAgents = allAgents.filter((a) => {
    if (a.role !== "worker") return false;
    return !allTasks.some((t) => t.assigneeId === a.id && (t.status === "running" || t.status === "assigned" || t.status === "waiting"));
  });

  // Stats cards
  const cards = [
    { label: "Active Requests", value: String(activeRequests), color: "#3b82f6" },
    { label: "Done Today", value: String(doneToday), color: "#22c55e" },
    { label: "Busy Agents", value: String(busyAgents.length), color: "#f59e0b" },
    { label: "Idle Agents", value: String(idleAgents.length), color: "#6b7280" },
  ];

  const cardW = (TV_W - 60) / 4;
  cards.forEach(({ label, value, color }, i) => {
    const x = 16 + i * (cardW + 8);
    const y = 80;
    ctx.fillStyle = "#0f2040";
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, 120, 8);
    ctx.fill();
    ctx.strokeStyle = color + "44";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = "bold 52px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(value, x + cardW / 2, y + 58);

    ctx.fillStyle = "#8899bb";
    ctx.font = "17px Inter, system-ui, sans-serif";
    ctx.fillText(label, x + cardW / 2, y + 100);
  });

  // Busy agent names
  if (busyAgents.length > 0) {
    ctx.fillStyle = "#1a3a6e";
    ctx.fillRect(16, 220, TV_W - 32, 1);
    ctx.fillStyle = "#5b7acc";
    ctx.font = "bold 19px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Working now", 24, 232);

    busyAgents.slice(0, 6).forEach((a, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const bx = 24 + col * (TV_W / 3 - 8);
      const by = 264 + row * 54;
      ctx.fillStyle = "#112040";
      ctx.beginPath();
      ctx.roundRect(bx, by, TV_W / 3 - 24, 44, 6);
      ctx.fill();

      const task = allTasks.find((t) => t.assigneeId === a.id && (t.status === "running" || t.status === "waiting"));
      ctx.fillStyle = a.appearance.color ?? "#5b8cff";
      ctx.beginPath();
      ctx.arc(bx + 22, by + 22, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#d4e4ff";
      ctx.font = "bold 18px Inter, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(a.name, bx + 38, by + 16);

      if (task) {
        ctx.fillStyle = "#6688bb";
        ctx.font = "15px Inter, system-ui, sans-serif";
        const t = task.title.length > 30 ? task.title.slice(0, 29) + "…" : task.title;
        ctx.fillText(t, bx + 38, by + 32);
      }
    });
  }
}

const TV_GEO = new THREE.PlaneGeometry(1.8, 1.0);

/** Live canvas texture plane overlaying the meeting room TV screen from the kit. */
export function MeetingTV({ space }: { space: Space }) {
  const brainstorm = useStore((s) => s.brainstorm);
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);

  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null>(null);
  const lastDrawRef = useRef(0);
  const brainstormRef = useRef(brainstorm);
  const agentsRef = useRef(agents);
  const tasksRef = useRef(tasks);
  brainstormRef.current = brainstorm;
  agentsRef.current = agents;
  tasksRef.current = tasks;

  const texture = useMemo(() => {
    const canvas = createCanvas();
    if (!canvas) return null;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    ctxRef.current = ctx;
    const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    texRef.current = tex;
    return tex;
  }, []);

  // Force initial draw
  useEffect(() => {
    lastDrawRef.current = 0;
  }, []);

  useFrame(() => {
    const now = Date.now();
    // Throttle to at most 1 update per second
    if (now - lastDrawRef.current < 1000) return;
    lastDrawRef.current = now;
    const ctx = ctxRef.current;
    const tex = texRef.current;
    if (!ctx || !tex) return;
    const bs = brainstormRef.current;
    if (bs && (bs.topic || bs.answers.length > 0 || bs.participants.length > 0)) {
      drawBrainstorm(ctx, bs, now);
    } else {
      drawDashboard(ctx, agentsRef.current, tasksRef.current);
    }
    tex.needsUpdate = true;
  });

  const pose = useMemo(() => tvScreenPose(space), [space]);

  if (!texture) return null;
  return (
    <mesh
      geometry={TV_GEO}
      position={[pose.x, pose.y, pose.z]}
      rotation={[0, pose.yaw, 0]}
      raycast={() => null}
    >
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}
