import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Agent } from "@agenticview/shared";
import { STATUS_COLORS, useAgentStatus, useStore } from "../state/store";
import { PermissionActions } from "../hud/PermissionToast";
import type { Spot } from "./layout";

interface Props {
  agent: Agent;
  spot: Spot;
  /** Height of whatever the robot stands on (podium, lobby platform). */
  baseY?: number;
  /** Bubble text to show instead of the store's bubble (used for the mirror robot). */
  bubbleOverride?: string;
  /** Face direction in radians around Y; defaults to facing the camera corner. */
  facing?: number;
}

const FACE_CAMERA = Math.PI / 4;

function Eyes({ kind, accent, blink }: { kind: Agent["appearance"]["eyes"]; accent: string; blink: RefObject<THREE.Group | null> }) {
  if (kind === "visor") {
    return (
      <group ref={blink} position={[0, 1.02, 0.5]}>
        <mesh>
          <boxGeometry args={[0.62, 0.18, 0.14]} />
          <meshStandardMaterial color="#11131c" roughness={0.3} metalness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.075]}>
          <boxGeometry args={[0.5, 0.06, 0.01]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
      </group>
    );
  }
  if (kind === "dots") {
    return (
      <group ref={blink} position={[0, 1.02, 0.52]}>
        <mesh position={[-0.17, 0, 0]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color="#11131c" emissive="#ffffff" emissiveIntensity={0.25} />
        </mesh>
        <mesh position={[0.17, 0, 0]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color="#11131c" emissive="#ffffff" emissiveIntensity={0.25} />
        </mesh>
      </group>
    );
  }
  return (
    <group ref={blink} position={[0, 1.02, 0.46]}>
      {[-0.2, 0.2].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh>
            <sphereGeometry args={[0.13, 16, 16]} />
            <meshStandardMaterial color="#ffffff" roughness={0.35} emissive="#ffffff" emissiveIntensity={0.15} />
          </mesh>
          <mesh position={[0, 0, 0.1]}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshStandardMaterial color="#11131c" roughness={0.2} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Robot({ agent, spot, baseY = 0, bubbleOverride, facing = FACE_CAMERA }: Props) {
  const status = useAgentStatus(agent.id);
  const selected = useStore((s) => s.selectedAgentId === agent.id);
  const select = useStore((s) => s.select);
  const bubble = useStore((s) => s.bubbles[agent.id]);
  const permission = useStore((s) => s.permissions.find((p) => p.agentId === agent.id));
  const question = useStore((s) => s.questions.find((q) => q.agentId === agent.id));
  const body = useRef<THREE.Group>(null);
  const antennaTip = useRef<THREE.Mesh>(null);
  const eyes = useRef<THREE.Group>(null);
  const seed = useMemo(() => agent.id.split("").reduce((n, c) => n + c.charCodeAt(0), 0) % 100, [agent.id]);
  const statusColor = STATUS_COLORS[status];
  const busy = status === "thinking" || status === "editing";

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const g = body.current;
    if (!g) return;
    if (busy) {
      const p = 1 + Math.sin(t * 6 + seed) * 0.035;
      g.scale.set(p, 1 / p, p);
      g.position.y = 0.02 * Math.abs(Math.sin(t * 6 + seed));
    } else {
      g.scale.set(1, 1, 1);
      g.position.y = Math.sin(t * 2 + seed) * 0.05;
    }
    if (antennaTip.current) {
      const m = antennaTip.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = status === "waiting" ? 1.2 + Math.sin(t * 8) * 1.1 : status === "error" ? 1.6 + Math.sin(t * 12) * 0.6 : busy ? 1.6 : 0.7;
    }
    if (eyes.current) {
      const blink = (t + seed) % 4 > 3.85 ? 0.12 : 1;
      eyes.current.scale.y = blink;
    }
  });

  const bubbleText = bubbleOverride ?? (bubble && bubble.until > Date.now() ? bubble.text : undefined);
  const showBubble = Boolean(permission || question || bubbleText);

  return (
    <group position={[spot.x, baseY, spot.z]} rotation={[0, facing, 0]}>
      <group ref={body} onClick={(e) => (e.stopPropagation(), select(selected ? undefined : agent.id))} onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "")}>
        <mesh position={[0, 0.9, 0]}>
          <sphereGeometry args={[0.6, 28, 22]} />
          <meshStandardMaterial
            color={agent.appearance.color}
            roughness={0.42}
            metalness={0.15}
            emissive={selected ? agent.appearance.accent : agent.appearance.color}
            emissiveIntensity={selected ? 0.35 : 0.06}
          />
        </mesh>
        <Eyes kind={agent.appearance.eyes} accent={agent.appearance.accent} blink={eyes} />
        <mesh position={[0, 1.66, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.34, 8]} />
          <meshStandardMaterial color="#c9ced9" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh ref={antennaTip} position={[0, 1.88, 0]}>
          <sphereGeometry args={[0.09, 12, 12]} />
          <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.34, 0]}>
          <cylinderGeometry args={[0.34, 0.42, 0.16, 20]} />
          <meshStandardMaterial color="#232635" roughness={0.6} metalness={0.3} />
        </mesh>
      </group>
      <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[selected ? 0.86 : 0.78, 0.05, 8, 40]} />
        <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={busy || status === "waiting" ? 1.1 : 0.55} toneMapped={false} />
      </mesh>
      <Html center distanceFactor={12} position={[0, 2.35, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        {/* Stop DOM events here: fiber listens on the canvas wrapper, so a click on the tag would otherwise count as a "pointer missed" and deselect. */}
        <div
          className={`tag-wrap ${selected ? "tag-selected" : ""}`}
          data-status={status}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {showBubble && (
            <div className={`bubble bubble-${permission ? "permission" : question ? "question" : "text"}`}>
              {permission ? (
                <>
                  <div className="bubble-title">May I run <code>{permission.tool}</code>?</div>
                  <PermissionActions permission={permission} compact />
                </>
              ) : question ? (
                <>
                  <div className="bubble-title">{question.question}</div>
                  <button type="button" className="btn btn-primary btn-xs" onClick={() => select(agent.id)}>
                    Answer in chat
                  </button>
                </>
              ) : (
                bubbleText
              )}
            </div>
          )}
          <button type="button" className="tag" onClick={() => select(selected ? undefined : agent.id)} style={{ borderColor: statusColor }}>
            <span className="tag-name">{agent.name}</span>
            <span className="tag-level">Lv {agent.stats.level}</span>
          </button>
        </div>
      </Html>
    </group>
  );
}
