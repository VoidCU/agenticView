/**
 * Big wall screens of My Office (social hub) and the Production Room (slate / live task title).
 *
 * Each is one canvas-texture plane laid exactly on the kit's lit screen face (kit.ts wallScreen: the
 * anchor frame from shared WALL_SCREEN / PRODUCTION_SCREEN, front face at SCREEN_FACE.front, nudged
 * SCREEN_FACE_NUDGE along the normal). No per-frame work: the canvas is repainted only when what it
 * shows changes (store.social for the hub, the running task's title for production).
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { screenWall, type Agent, type SocialHubState, type Space, type Task } from "@agenticview/shared";
import { useStore } from "../state/store";
import { SCREEN_FACE, SCREEN_FACE_NUDGE } from "./kit";

export const SCREEN_TEX_W = 1280;
export const SCREEN_TEX_H = 720;

/** World pose of a room's wall-screen overlay (centre of the plane), or undefined for kinds without one. */
export function wallScreenPose(space: Pick<Space, "kind" | "x" | "z">): { x: number; y: number; z: number; yaw: number; width: number; height: number } | undefined {
  const a = screenWall(space.kind);
  if (!a) return undefined;
  const d = SCREEN_FACE.front + SCREEN_FACE_NUDGE;
  // Kit frames map local +z to (sin yaw, cos yaw): the screen normal, pointing into the room.
  return { x: space.x + a.x + Math.sin(a.yaw) * d, y: a.y, z: space.z + a.z + Math.cos(a.yaw) * d, yaw: a.yaw, width: a.width, height: a.height };
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const FONT = `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

function fitText(ctx: Ctx, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Greedy word wrap into at most `maxLines` lines (the last one ellipsised). Exported for tests. */
export function wrapLines(ctx: Pick<Ctx, "measureText">, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i]!;
    if (ctx.measureText(next).width <= maxW || !cur) {
      cur = next;
      continue;
    }
    lines.push(cur);
    cur = words[i]!;
    if (lines.length === maxLines - 1) {
      cur = words.slice(i).join(" ");
      break;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines).map((l, i, all) => (i === all.length - 1 ? fitText(ctx as Ctx, l, maxW) : l));
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const SOCIAL_TITLE = "Social hub";
export const SOCIAL_CONNECT_HINT = "Connect Instagram & Meta in Settings (coming soon)";
export const SOCIAL_EMPTY = "Your Instagram and Meta feed will show up here.";

/** Paint the My Office social hub. Exported for tests. */
export function drawSocialHub(ctx: Ctx, social: SocialHubState, now = Date.now()): void {
  const W = SCREEN_TEX_W;
  const H = SCREEN_TEX_H;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#161a36");
  bg.addColorStop(0.55, "#2a1b44");
  bg.addColorStop(1, "#44203f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  ctx.fillStyle = "#ffffff";
  ctx.font = `800 76px ${FONT}`;
  ctx.fillText(SOCIAL_TITLE, 64, 92);
  ctx.fillStyle = "#c9c3e6";
  ctx.font = `30px ${FONT}`;
  ctx.fillText(SOCIAL_CONNECT_HINT, 66, 160);

  // Connection chips, top right.
  const chips: { label: string; on: boolean; color: string }[] = [
    { label: "Instagram", on: social.connected.instagram, color: "#e1306c" },
    { label: "Meta", on: social.connected.meta, color: "#1877f2" },
  ];
  ctx.font = `600 26px ${FONT}`;
  let cx = W - 64;
  for (const c of [...chips].reverse()) {
    const text = `${c.label} · ${c.on ? "connected" : "off"}`;
    const w = ctx.measureText(text).width + 64;
    cx -= w;
    roundRect(ctx, cx, 66, w, 52, 26);
    ctx.fillStyle = c.on ? c.color : "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 26, 92, 8, 0, Math.PI * 2);
    ctx.fillStyle = c.on ? "#ffffff" : c.color;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, cx + 44, 93);
    cx -= 16;
  }

  // Feed area.
  const fx = 64;
  const fy = 214;
  const fw = W - 128;
  const fh = H - fy - 56;
  roundRect(ctx, fx, fy, fw, fh, 22);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const items = social.items.slice(0, 4);
  if (items.length === 0) {
    // Placeholder: skeleton posts under the empty-state line.
    for (let i = 0; i < 3; i++) {
      const x = fx + 32 + i * ((fw - 64) / 3);
      const w = (fw - 64) / 3 - 24;
      roundRect(ctx, x, fy + 32, w, fh - 150, 16);
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      ctx.fillRect(x + 24, fy + fh - 180, w * 0.7, 16);
      ctx.fillRect(x + 24, fy + fh - 152, w * 0.45, 16);
    }
    ctx.fillStyle = "#e6e1ff";
    ctx.font = `500 34px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(SOCIAL_EMPTY, W / 2, fy + fh - 64);
    ctx.textAlign = "left";
    return;
  }
  const rowH = (fh - 32) / items.length;
  items.forEach((it, i) => {
    const y = fy + 16 + i * rowH;
    const color = it.network === "instagram" ? "#e1306c" : "#1877f2";
    ctx.beginPath();
    ctx.arc(fx + 56, y + rowH / 2, 22, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(it.network === "instagram" ? "IG" : "f", fx + 56, y + rowH / 2 + 1);
    ctx.textAlign = "left";
    ctx.font = `32px ${FONT}`;
    ctx.fillStyle = "#f3f0ff";
    ctx.fillText(fitText(ctx, it.text.replace(/\s+/g, " "), fw - 320), fx + 100, y + rowH / 2);
    const mins = Math.max(0, Math.round((now - Date.parse(it.ts)) / 60000));
    const ago = Number.isNaN(mins) ? "" : mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
    ctx.font = `26px ${FONT}`;
    ctx.fillStyle = "#a9a2cf";
    ctx.textAlign = "right";
    ctx.fillText(ago, fx + fw - 32, y + rowH / 2);
    ctx.textAlign = "left";
    if (i < items.length - 1) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(fx + 32, y + rowH, fw - 64, 2);
    }
  });
}

/** What the production screen shows: the newest running task of a worker seated in the room, or nothing. */
export function productionTask(tasks: Record<string, Task> | Task[], seated: readonly string[]): Task | undefined {
  if (seated.length === 0) return undefined;
  let best: Task | undefined;
  for (const t of Array.isArray(tasks) ? tasks : Object.values(tasks)) {
    if (t.status !== "running" || !seated.includes(t.assigneeId)) continue;
    if (!best || (t.startedAt ?? t.createdAt) > (best.startedAt ?? best.createdAt)) best = t;
  }
  return best;
}

export const PRODUCTION_SLATE = "PRODUCTION";

/** Paint the production screen: the idle slate, or ON AIR with the running task's title. Exported for tests. */
export function drawProduction(ctx: Ctx, roomName: string, live?: { title: string; who?: string }): void {
  const W = SCREEN_TEX_W;
  const H = SCREEN_TEX_H;
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "middle";
  // Clapperboard stripes along the top.
  const band = 92;
  ctx.fillStyle = "#f2f2f2";
  ctx.fillRect(0, 0, W, band);
  ctx.fillStyle = "#15171c";
  for (let x = -band; x < W + band; x += 110) {
    ctx.beginPath();
    ctx.moveTo(x, band);
    ctx.lineTo(x + 55, band);
    ctx.lineTo(x + 55 + band, 0);
    ctx.lineTo(x + band, 0);
    ctx.closePath();
    ctx.fill();
  }
  if (!live) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 150px ${FONT}`;
    if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = "10px";
    ctx.fillText(PRODUCTION_SLATE, W / 2, H / 2 + 10);
    if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px";
    ctx.fillStyle = "#8a93a6";
    ctx.font = `36px ${FONT}`;
    ctx.fillText(`${roomName} · standing by`, W / 2, H / 2 + 130);
    // Slate grid: SCENE / TAKE / ROLL.
    ctx.font = `600 26px ${FONT}`;
    ["SCENE —", "TAKE —", "ROLL —"].forEach((t, i) => ctx.fillText(t, W / 2 + (i - 1) * 300, H - 70));
    ctx.textAlign = "left";
    return;
  }
  // ON AIR badge.
  roundRect(ctx, 56, band + 44, 230, 64, 14);
  ctx.fillStyle = "#d92d2d";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(92, band + 76, 11, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.font = `800 34px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("ON AIR", 116, band + 78);
  ctx.fillStyle = "#8a93a6";
  ctx.font = `30px ${FONT}`;
  ctx.fillText(fitText(ctx, live.who ? `${roomName} · ${live.who}` : roomName, W - 400), 316, band + 78);
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 84px ${FONT}`;
  const lines = wrapLines(ctx, live.title, W - 120, 4);
  const top = band + 180 + (4 - lines.length) * 48;
  lines.forEach((l, i) => ctx.fillText(l, 60, top + i * 100));
}

function makeTexture(): { tex: THREE.CanvasTexture; ctx: Ctx } | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SCREEN_TEX_W;
  canvas.height = SCREEN_TEX_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return { tex, ctx };
}

function useScreenTexture() {
  const t = useMemo(makeTexture, []);
  useEffect(() => () => t?.tex.dispose(), [t]);
  return t;
}

/**
 * The screen plane at its world pose, tagged `userData.wallScreenKind` so the walk-mode crosshair
 * (WalkMode walkInteraction) can hit it: the My Office screen opens Settings > Connections. It keeps
 * the default raycast but has no pointer handlers, so R3F's overview event system never tests it
 * (only objects with handlers are) and floor clicks / agent picking are unaffected. Exported for tests.
 */
export function createWallScreenMesh(space: Pick<Space, "kind" | "x" | "z">, tex?: THREE.Texture): THREE.Mesh | undefined {
  const pose = wallScreenPose(space);
  if (!pose) return undefined;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pose.width, pose.height), new THREE.MeshBasicMaterial({ map: tex ?? null, toneMapped: false }));
  mesh.position.set(pose.x, pose.y, pose.z);
  mesh.rotation.set(0, pose.yaw, 0, "YXZ");
  mesh.userData = { wallScreenKind: space.kind };
  mesh.name = `wall-screen-${space.kind}`;
  return mesh;
}

function ScreenPlane({ space, tex }: { space: Space; tex: THREE.Texture }) {
  const mesh = useMemo(() => createWallScreenMesh(space, tex), [space.kind, space.x, space.z, tex]);
  useEffect(() => () => {
    if (!mesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);
  if (!mesh) return null;
  return <primitive object={mesh} />;
}

/** My Office wall screen: the social hub (store.social; empty -> placeholder). Repaints only when it changes. */
export function SocialHubScreen({ space }: { space: Space }) {
  const social = useStore((s) => s.social);
  const t = useScreenTexture();
  useEffect(() => {
    if (!t) return;
    drawSocialHub(t.ctx, social);
    t.tex.needsUpdate = true;
  }, [t, social]);
  if (!t) return null;
  return <ScreenPlane space={space} tex={t.tex} />;
}

/**
 * Production Room big screen. Idle: the PRODUCTION slate. While a task RUNS whose assignee sits in this
 * room: its title (and who). The selector returns a plain string, so the store's frequent updates
 * re-render (and repaint) only when that string changes.
 */
export function ProductionScreen({ space, seated }: { space: Space; seated: readonly string[] }) {
  const live = useStore((s) => {
    const task = productionTask(s.tasks, seated);
    if (!task) return "";
    const who: Agent | undefined = s.agents[task.assigneeId];
    return `${task.title}\u0000${who?.name ?? ""}`;
  });
  const t = useScreenTexture();
  useEffect(() => {
    if (!t) return;
    const [title, who] = live ? live.split("\u0000") : [];
    drawProduction(t.ctx, space.name, title ? { title, who: who || undefined } : undefined);
    t.tex.needsUpdate = true;
  }, [t, live, space.name]);
  if (!t) return null;
  return <ScreenPlane space={space} tex={t.tex} />;
}
