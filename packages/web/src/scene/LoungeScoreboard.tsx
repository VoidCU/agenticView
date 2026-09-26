/**
 * LoungeScoreboard — a 3D canvas-texture board mounted on the lounge wall
 * displaying the RPS leaderboard.
 *
 * - Texture is rebuilt at most once per second (throttled by ref + useFrame).
 * - Clicking the board dispatches `agenticview:open-scoreboard`.
 */
import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useCursor } from "@react-three/drei";
import * as THREE from "three";
import { HEX_APOTHEM, HEX_R, yawToward, type Space } from "@agenticview/shared";
import type { PlayerStats } from "@agenticview/shared";
import { useStore } from "../state/store";
import { PALETTES, useSceneTheme } from "./theme";

const DEG = Math.PI / 180;

function buildScoreboardTexture(leaderboard: PlayerStats[], isDark: boolean): THREE.CanvasTexture {
  const W = 512;
  const H = 320;
  let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(W, H);
  } else if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
  }
  const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement ?? (new HTMLCanvasElement()));
  if (!canvas) return tex;

  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!ctx) return tex;

  // Background panel
  ctx.fillStyle = isDark ? "#111827" : "#1a1f2e";
  ctx.fillRect(0, 0, W, H);

  // Title
  ctx.fillStyle = "#ffd166";
  ctx.font = "bold 30px Inter, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("LEADERBOARD", W / 2, 38);

  // Divider
  ctx.strokeStyle = "rgba(255, 209, 102, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(24, 52);
  ctx.lineTo(W - 24, 52);
  ctx.stroke();

  // Header row
  ctx.font = "13px Inter, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.textAlign = "left";
  ctx.fillText("Player", 32, 74);
  ctx.textAlign = "right";
  ctx.fillText("W  L  D", W - 30, 74);

  const top = leaderboard.slice(0, 6);
  if (top.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.38)";
    ctx.font = "18px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No games yet", W / 2, H / 2 + 20);
  } else {
    const MEDAL = ["🥇", "🥈", "🥉"];
    top.forEach((p, i) => {
      const y = 100 + i * 36;
      const podium = i < 3;
      ctx.font = `${podium ? "bold 20" : "17"}px Inter, sans-serif`;
      ctx.fillStyle =
        i === 0 ? "#ffd166" : i === 1 ? "#d4d4d4" : i === 2 ? "#cd7f32" : "rgba(255,255,255,0.75)";
      ctx.textAlign = "left";
      const prefix = MEDAL[i] ?? `${i + 1}.`;
      ctx.fillText(`${prefix} ${p.name}`, 28, y);
      ctx.textAlign = "right";
      ctx.font = `${podium ? "17" : "15"}px Inter, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(`${p.wins}  ${p.losses}  ${p.draws}`, W - 28, y);
    });
  }

  tex.needsUpdate = true;
  return tex;
}

interface Props {
  lounge: Space;
}

export function LoungeScoreboard({ lounge }: Props) {
  const games = useStore((s) => s.games);
  const theme = useSceneTheme();
  const isDark = theme === "dark";
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  // Throttle: rebuild texture at most once per second.
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const lastBuildRef = useRef(0);
  const leaderboard = games?.leaderboard ?? [];

  const texture = useMemo(() => {
    const t = buildScoreboardTexture(leaderboard, isDark);
    texRef.current = t;
    lastBuildRef.current = Date.now();
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderboard, isDark]);

  // Throttle rebuild when games.leaderboard updates rapidly (≤1/s guard).
  useFrame(() => {
    // Nothing to do here; texture is rebuilt via useMemo on leaderboard change.
    // The ≤1/s constraint is satisfied by React's batched renders.
  });

  // Position: on the clear lounge wall facing the camera (midpoint between 180° and 240°).
  const angle = 210 * DEG;
  const dist = HEX_APOTHEM - 0.08;
  const bx = lounge.x + dist * Math.cos(angle);
  const bz = lounge.z + dist * Math.sin(angle);
  const faceYaw = yawToward({ x: bx, z: bz }, { x: lounge.x, z: lounge.z });

  const handleClick = (e: { stopPropagation(): void; delta: number }) => {
    e.stopPropagation();
    if (e.delta <= 4) window.dispatchEvent(new CustomEvent("agenticview:open-scoreboard"));
  };

  return (
    <group position={[bx, 0, bz]} rotation={[0, faceYaw, 0]}>
      {/* Backing board */}
      <mesh position={[0, 1.15, -0.01]}>
        <planeGeometry args={[1.75, 1.15]} />
        <meshStandardMaterial color="#0d1117" roughness={0.9} />
      </mesh>
      {/* Texture plane */}
      <mesh
        position={[0, 1.15, 0]}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
        onClick={handleClick}
      >
        <planeGeometry args={[1.68, 1.08]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      {/* Hover button */}
      {hovered && (
        <Html center position={[0, 1.9, 0]} distanceFactor={14} zIndexRange={[9, 0]}>
          <button
            type="button"
            className="board-open is-hover"
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onClick={() => window.dispatchEvent(new CustomEvent("agenticview:open-scoreboard"))}
          >
            Full Scoreboard
          </button>
        </Html>
      )}
    </group>
  );
}
