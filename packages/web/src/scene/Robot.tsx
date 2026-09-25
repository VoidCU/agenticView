import { useMemo, useRef, type ReactNode, type RefObject } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { angleDiff, route, type Agent, type Point, type Space } from "@agenticview/shared";
import { STATUS_COLORS, useAgentStatus, useStore } from "../state/store";
import { PermissionActions } from "../hud/PermissionToast";
import { levelAccents } from "./accents";
import { dragPoint, livePositions, useDrag } from "./motion";

export interface RobotTarget extends Point {
  yaw: number;
}

interface Props {
  agent: Agent;
  /** Where the robot should be. When this changes it walks there through doorways. */
  target: RobotTarget;
  /** The honeycomb, for routing. */
  spaces: Space[];
  /** Start somewhere else and walk in (a freshly hired worker arrives from the manager's office). */
  spawnAt?: Point;
  /** Bubble text to show instead of the store's bubble (used for the mirror robot). */
  bubbleOverride?: string;
  /** Called once each time the robot reaches a new target. */
  onArrive?: (agentId: string) => void;
  /** Pointer went down on the robot (drag-to-reassign). */
  onGrab?: (agentId: string, e: ThreeEvent<PointerEvent>) => void;
  /** Extra HTML that follows the robot (file chips). */
  children?: ReactNode;
}

const WALK_SPEED = 3.1;
const TURN_RATE = 9;
/** Robots are scaled to office furniture: about desk-and-a-half tall. */
export const ROBOT_SCALE = 0.72;

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

export function Robot({ agent, target, spaces, spawnAt, bubbleOverride, onArrive, onGrab, children }: Props) {
  const status = useAgentStatus(agent.id);
  const selected = useStore((s) => s.selectedAgentId === agent.id);
  const select = useStore((s) => s.select);
  const bubble = useStore((s) => s.bubbles[agent.id]);
  const permission = useStore((s) => s.permissions.find((p) => p.agentId === agent.id));
  const question = useStore((s) => s.questions.find((q) => q.agentId === agent.id));
  const held = useDrag((s) => s.heldId === agent.id && s.active);
  const root = useRef<THREE.Group>(null);
  const yawG = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const footL = useRef<THREE.Mesh>(null);
  const footR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const antennaTip = useRef<THREE.Mesh>(null);
  const eyes = useRef<THREE.Group>(null);
  const seed = useMemo(() => agent.id.split("").reduce((n, c) => n + c.charCodeAt(0), 0) % 100, [agent.id]);
  const statusColor = STATUS_COLORS[status];
  const busy = status === "thinking" || status === "editing";
  const accents = levelAccents(agent.stats.level);
  const accent = agent.appearance.accent;
  const bubbleText = bubbleOverride ?? (bubble && bubble.until > Date.now() ? bubble.text : undefined);
  const showBubble = Boolean(permission || question || bubbleText);
  // Turn round to the viewer when being talked to.
  const faceViewer = selected || Boolean(permission || question);

  const motion = useRef<{ x: number; z: number; yaw: number; path: Point[]; key: string; walk: number; phase: number; lift: number } | null>(null);
  if (!motion.current) {
    const start = spawnAt ?? target;
    motion.current = { x: start.x, z: start.z, yaw: target.yaw, path: [], key: spawnAt ? "" : `${target.x.toFixed(3)},${target.z.toFixed(3)}`, walk: 0, phase: 0, lift: 0 };
  }

  useFrame(({ clock, camera }, rawDt) => {
    const st = motion.current!;
    const dt = Math.min(rawDt, 0.05);
    const t = clock.getElapsedTime();
    const g = root.current;
    if (!g) return;

    const key = `${target.x.toFixed(3)},${target.z.toFixed(3)}`;
    if (held) {
      // Carried by the pointer: float above the floor, drop into place on release.
      st.x += (dragPoint.x - st.x) * Math.min(1, dt * 18);
      st.z += (dragPoint.z - st.z) * Math.min(1, dt * 18);
      st.path = [];
      st.key = "";
      st.lift += (0.7 - st.lift) * Math.min(1, dt * 10);
    } else {
      st.lift += (0 - st.lift) * Math.min(1, dt * 10);
      if (key !== st.key) {
        st.key = key;
        if (Math.hypot(target.x - st.x, target.z - st.z) < 0.05) {
          st.path = [];
          onArrive?.(agent.id);
        } else {
          st.path = route(spaces, { x: st.x, z: st.z }, target).slice(1);
        }
      }
      let budget = WALK_SPEED * dt;
      let heading: number | undefined;
      while (budget > 0 && st.path.length) {
        const next = st.path[0]!;
        const dx = next.x - st.x;
        const dz = next.z - st.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-4) heading = Math.atan2(dx, dz);
        if (d <= budget) {
          st.x = next.x;
          st.z = next.z;
          budget -= d;
          st.path.shift();
          if (!st.path.length) onArrive?.(agent.id);
        } else {
          st.x += (dx / d) * budget;
          st.z += (dz / d) * budget;
          budget = 0;
        }
      }
      const walking = st.path.length > 0;
      st.walk += ((walking ? 1 : 0) - st.walk) * Math.min(1, dt * 8);
      const desired = walking && heading !== undefined ? heading : faceViewer ? Math.atan2(camera.position.x - st.x, camera.position.z - st.z) : target.yaw;
      st.yaw += angleDiff(desired, st.yaw) * Math.min(1, dt * TURN_RATE);
    }
    livePositions.set(agent.id, { x: st.x, z: st.z });
    g.position.set(st.x, st.lift, st.z);
    if (yawG.current) yawG.current.rotation.y = st.yaw;

    // Walk cycle: feet step, arms swing, the body bobs and leans into the stride.
    const w = st.walk;
    st.phase += dt * (5 + 6 * w);
    const s = Math.sin(st.phase);
    if (footL.current && footR.current) {
      footL.current.position.z = 0.04 + s * 0.16 * w;
      footR.current.position.z = 0.04 - s * 0.16 * w;
      footL.current.position.y = 0.07 + Math.max(0, Math.cos(st.phase)) * 0.08 * w;
      footR.current.position.y = 0.07 + Math.max(0, -Math.cos(st.phase)) * 0.08 * w;
    }
    if (armL.current && armR.current) {
      const idleWave = held ? Math.sin(t * 10) * 0.5 - 1.8 : 0;
      armL.current.rotation.x = -s * 0.7 * w + idleWave;
      armR.current.rotation.x = s * 0.7 * w + idleWave;
    }
    if (tilt.current) {
      tilt.current.rotation.x = 0.13 * w;
      tilt.current.rotation.z = Math.sin(st.phase) * 0.05 * w;
    }
    const b = body.current;
    if (b) {
      if (busy && w < 0.5) {
        const p = 1 + Math.sin(t * 6 + seed) * 0.035;
        b.scale.set(p, 1 / p, p);
        b.position.y = 0.02 * Math.abs(Math.sin(t * 6 + seed));
      } else {
        b.scale.set(1, 1, 1);
        b.position.y = Math.sin(t * 2 + seed) * 0.05 * (1 - w) + Math.abs(Math.cos(st.phase)) * 0.07 * w;
      }
    }
    if (antennaTip.current) {
      const m = antennaTip.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = status === "waiting" ? 1.2 + Math.sin(t * 8) * 1.1 : status === "error" ? 1.6 + Math.sin(t * 12) * 0.6 : busy ? 1.6 : 0.7;
    }
    if (eyes.current) eyes.current.scale.y = (t + seed) % 4 > 3.85 ? 0.12 : 1;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (Date.now() - useDrag.getState().droppedAt < 250) return;
    select(selected ? undefined : agent.id);
  };

  return (
    <group ref={root}>
      <group ref={yawG} scale={ROBOT_SCALE}>
        <group ref={tilt} position={[0, 0.05, 0]}>
          <group
            ref={body}
            onClick={onClick}
            onPointerDown={onGrab ? (e) => onGrab(agent.id, e) : undefined}
            onPointerOver={() => (document.body.style.cursor = onGrab ? "grab" : "pointer")}
            onPointerOut={() => (document.body.style.cursor = "")}
          >
            <mesh position={[0, 0.9, 0]} castShadow>
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
            {accents.secondAntenna && (
              <group position={[0.22, 1.5, 0]} rotation={[0, 0, -0.45]}>
                <mesh position={[0, 0.14, 0]}>
                  <cylinderGeometry args={[0.022, 0.022, 0.28, 8]} />
                  <meshStandardMaterial color="#c9ced9" metalness={0.6} roughness={0.35} />
                </mesh>
                <mesh position={[0, 0.32, 0]}>
                  <sphereGeometry args={[0.06, 10, 10]} />
                  <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.9} toneMapped={false} />
                </mesh>
              </group>
            )}
            {accents.crown && (
              <mesh position={[0, 1.46, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.36, 0.045, 8, 24]} />
                <meshStandardMaterial color="#ffd166" emissive="#ffd166" emissiveIntensity={0.7} metalness={0.8} roughness={0.25} toneMapped={false} />
              </mesh>
            )}
            {/* Little arms, pivoting at the shoulder. */}
            {[
              [-1, armL],
              [1, armR],
            ].map(([side, ref]) => (
              <group key={side as number} ref={ref as RefObject<THREE.Group>} position={[(side as number) * 0.6, 0.95, 0]}>
                <mesh position={[(side as number) * 0.03, -0.17, 0]} rotation={[0, 0, (side as number) * 0.12]} castShadow>
                  <capsuleGeometry args={[0.065, 0.24, 4, 10]} />
                  <meshStandardMaterial color={agent.appearance.color} roughness={0.5} metalness={0.15} />
                </mesh>
                <mesh position={[(side as number) * 0.05, -0.36, 0]}>
                  <sphereGeometry args={[0.08, 12, 10]} />
                  <meshStandardMaterial color="#2a2d38" roughness={0.5} metalness={0.3} />
                </mesh>
              </group>
            ))}
            <mesh position={[0, 0.34, 0]}>
              <cylinderGeometry args={[0.34, 0.42, 0.16, 20]} />
              <meshStandardMaterial color="#232635" roughness={0.6} metalness={0.3} />
            </mesh>
          </group>
        </group>
        {[
          [-0.19, footL],
          [0.19, footR],
        ].map(([x, ref]) => (
          <mesh key={x as number} ref={ref as RefObject<THREE.Mesh>} position={[x as number, 0.07, 0.04]} castShadow>
            <boxGeometry args={[0.2, 0.1, 0.3]} />
            <meshStandardMaterial color="#2a2d38" roughness={0.55} metalness={0.3} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[(selected ? 0.86 : 0.78) * ROBOT_SCALE, 0.035, 8, 40]} />
        <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={busy || status === "waiting" ? 1.1 : 0.55} toneMapped={false} />
      </mesh>
      {accents.glowRing && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.95 * ROBOT_SCALE, 1.25 * ROBOT_SCALE, 48]} />
          <meshBasicMaterial color={accent === "#ffffff" ? agent.appearance.color : accent} transparent opacity={0.22} toneMapped={false} />
        </mesh>
      )}
      <Html center distanceFactor={18} position={[0, 2.35 * ROBOT_SCALE + 0.15, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
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
      {children}
    </group>
  );
}
