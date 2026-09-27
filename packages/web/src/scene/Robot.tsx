import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { angleDiff, route, type Agent, type Point, type Space } from "@agenticview/shared";
import { STATUS_COLORS, useAgentStatus, useStore } from "../state/store";
import { PermissionActions } from "../hud/PermissionToast";
import { LimitChip, SwitchAgentModal } from "../hud/LimitChip";
import { levelAccents } from "./accents";
import { dragPoint, livePositions, useDrag } from "./motion";
import { stepPath, useEngage, yawToViewer } from "./engage";
import { agentActivityText } from "./selectors";
import { useWalk } from "../state/walk";
import { useHudPrefs } from "../state/hudPrefs";
import { WALK_BUBBLE_DISTANCE_FACTOR, bonk, bonkLooking, bonkState, bubbleAnchorY, interactionNod, interactionWobble } from "../state/bonk";
import { ROBOT_SCALE, basicMat, physMat, robotGeoms, stdMat } from "./robotParts";

/** Slap / greeting bubble: just over the head (robot-local). */
const BUBBLE_HEAD_Y = 2.35 * ROBOT_SCALE + 0.1;
/** Scratch for the camera direction (bubble placement); shared by all robots, no allocation. */
const camDir = new THREE.Vector3();

export { ROBOT_SCALE };

export interface RobotTarget extends Point {
  yaw: number;
  /** Vertical Y offset (world units) for seated or floor-level poses. 0 = standing on floor. */
  yOffset?: number;
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
  /** Called when the robot body is clicked (in addition to the default select toggle). */
  onBodyClick?: (agentId: string) => void;
  /** Extra HTML that follows the robot (file chips). */
  children?: ReactNode;
  /** When true: grey visor, zZ float, robot lies down on the floor (quota/rate-limit faint). */
  fainted?: boolean;
}

const HAND_MAT = () => stdMat({ color: "#2a2d38", roughness: 0.5, metalness: 0.3 });
const FOOT_MAT = () => stdMat({ color: "#2a2d38", roughness: 0.55, metalness: 0.3 });

const WALK_SPEED = 3.1;
const TURN_RATE = 9;

/** Per-status glow pulse frequencies (rad/s). */
const STATUS_PULSE: Record<string, number> = { thinking: 2.8, editing: 5.5, waiting: 6.0, error: 11.0 };

function Eyes({
  kind,
  accent,
  status,
  statusColor,
  blink,
}: {
  kind: Agent["appearance"]["eyes"];
  accent: string;
  status: string;
  statusColor: string;
  blink: RefObject<THREE.Group | null>;
}) {
  const G = robotGeoms();
  const isBusy = status === "thinking" || status === "editing" || status === "waiting" || status === "error";
  const visorColor = isBusy ? statusColor : accent;
  if (kind === "visor") {
    return (
      <group ref={blink} position={[0, 1.02, 0.5]}>
        <mesh geometry={G.visorBox} material={stdMat({ color: "#11131c", roughness: 0.3, metalness: 0.4 })} />
        <mesh position={[0, 0, 0.075]} geometry={G.visorStrip} material={stdMat({ color: visorColor, emissive: visorColor, emissiveIntensity: isBusy ? 1.9 : 1.4, toneMapped: false })} />
      </group>
    );
  }
  if (kind === "dots") {
    const dot = stdMat({ color: isBusy ? statusColor : "#11131c", emissive: isBusy ? statusColor : "#ffffff", emissiveIntensity: isBusy ? 0.9 : 0.25, toneMapped: false });
    return (
      <group ref={blink} position={[0, 1.02, 0.52]}>
        <mesh position={[-0.17, 0, 0]} geometry={G.dotEye} material={dot} />
        <mesh position={[0.17, 0, 0]} geometry={G.dotEye} material={dot} />
      </group>
    );
  }
  const white = stdMat({ color: "#ffffff", roughness: 0.25, emissive: "#ffffff", emissiveIntensity: 0.15 });
  const pupil = stdMat({ color: isBusy ? statusColor : "#11131c", roughness: 0.2, emissive: isBusy ? statusColor : "#000000", emissiveIntensity: isBusy ? 0.7 : 0 });
  return (
    <group ref={blink} position={[0, 1.02, 0.46]}>
      {EYE_X.map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh geometry={G.eyeWhite} material={white} />
          <mesh position={[0, 0, 0.1]} geometry={G.pupil} material={pupil} />
        </group>
      ))}
    </group>
  );
}

const EYE_X = [-0.2, 0.2] as const;

export function Robot({ agent, target, spaces, spawnAt, bubbleOverride, onArrive, onGrab, onBodyClick, children, fainted = false }: Props) {
  const _status = useAgentStatus(agent.id);
  const status = fainted ? "idle" : _status;
  const selected = useStore((s) => s.selectedAgentId === agent.id);
  const [switchOpen, setSwitchOpen] = useState(false);
  const select = useStore((s) => s.select);
  const bubble = useStore((s) => s.bubbles[agent.id]);
  const permission = useStore((s) => s.permissions.find((p) => p.agentId === agent.id));
  const sessionInfo = useStore((s) => (agent.provider === "claude-session" && agent.session ? s.sessions.find((x) => x.id === agent.session!.id) : undefined));
  const question = useStore((s) => s.questions.find((q) => q.agentId === agent.id));
  // Select the derived string, not the tasks map + feed: the robot (and its tag's own React root) only
  // re-renders when the visible activity text changes, not on every run.event / task update.
  const activity = useStore((s) => agentActivityText(agent, s.tasks, s.feed[agent.id]));
  const held = useDrag((s) => s.heldId === agent.id && s.active);
  // Playing RPS with the user: stop, face the player, pump a fist (resumes on close).
  const engaged = useEngage((s) => s.agentId === agent.id);
  // Hide tags/bubbles in walk mode or when showTags is disabled.
  const walking = useWalk((s) => s.walking);
  const showTags = useHudPrefs((s) => s.showTags);
  const tagsVisible = !walking && showTags;
  const root = useRef<THREE.Group>(null);
  const yawG = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  /** Anchor of the slap / greeting bubble (moved into view when you stand next to the robot in walk mode). */
  const bubbleAnchor = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const bodyMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const glowMesh = useRef<THREE.Mesh>(null);
  const footL = useRef<THREE.Mesh>(null);
  const footR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const antennaTip = useRef<THREE.Mesh>(null);
  const eyes = useRef<THREE.Group>(null);
  const tagWrapRef = useRef<HTMLDivElement>(null);
  const tagScale = useRef<{ el: HTMLDivElement | null; s: number }>({ el: null, s: 0 });
  const G = robotGeoms();
  const armMat = physMat({ color: agent.appearance.color, roughness: 0.3, metalness: 0.12, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const seed = useMemo(() => agent.id.split("").reduce((n, c) => n + c.charCodeAt(0), 0) % 100, [agent.id]);
  const statusColor = STATUS_COLORS[status];
  const busy = status === "thinking" || status === "editing";
  const accents = levelAccents(agent.stats.level);
  const accent = agent.appearance.accent;
  const bubbleText = bubbleOverride ?? (bubble && bubble.until > Date.now() ? bubble.text : undefined);
  const showBubble = Boolean(permission || question || bubbleText);
  // Turn round to the viewer when being talked to.
  const faceViewer = selected || Boolean(permission || question);

  // Extended motion state: vx/vz for path-update velocity blending.
  const motion = useRef<{
    x: number; z: number; yaw: number;
    path: Point[];
    /** Target the current path leads to (NaN = none yet / reset by a drag). Numbers, not a string key: no per-frame allocation. */
    tx: number; tz: number;
    walk: number; phase: number; lift: number;
    seat: number; // eased seat height: target.yOffset once arrived, 0 while walking
    vx: number; vz: number; // current velocity for smooth path transitions
  } | null>(null);
  if (!motion.current) {
    const start = spawnAt ?? target;
    motion.current = {
      x: start.x, z: start.z, yaw: target.yaw,
      path: [], tx: spawnAt ? NaN : target.x, tz: spawnAt ? NaN : target.z,
      walk: 0, phase: 0, lift: 0, seat: spawnAt ? 0 : (target.yOffset ?? 0),
      vx: 0, vz: 0,
    };
  }

  useFrame(({ clock, camera }, rawDt) => {
    const st = motion.current!;
    const dt = Math.min(rawDt, 0.05);
    const t = clock.getElapsedTime();
    const g = root.current;
    if (!g) return;

    if (held) {
      // Carried by the pointer: float above the floor, drop into place on release.
      st.x += (dragPoint.x - st.x) * Math.min(1, dt * 18);
      st.z += (dragPoint.z - st.z) * Math.min(1, dt * 18);
      st.path.length = 0;
      st.tx = NaN;
      st.lift += (0.7 - st.lift) * Math.min(1, dt * 10);
    } else {
      st.lift += (0 - st.lift) * Math.min(1, dt * 10);
      // Walk along the path (paused in place while the user plays RPS with this agent).
      const stepped = stepPath(st, target, { dt, speed: WALK_SPEED, engaged, route: (from, to) => route(spaces, from, to).slice(1), onArrive: () => onArrive?.(agent.id) });
      const heading = stepped.heading;
      const isWalking = stepped.walking;
      st.walk += ((isWalking ? 1 : 0) - st.walk) * Math.min(1, dt * 8);
      // Smoothly rotate to face direction of travel; snap to target.yaw at rest. A bonked idle robot
      // looks at you for a moment; a busy one only glances during the wobble. An engaged robot (RPS
      // with the user) faces the player in walk mode, or the camera in the overview.
      const desired = isWalking && heading !== undefined
        ? heading
        : engaged || faceViewer || bonkLooking(bonkState(agent.id), Date.now())
          ? yawToViewer(st.x, st.z, camera.position.x, camera.position.z)
          : target.yaw;
      st.yaw += angleDiff(desired, st.yaw) * Math.min(1, dt * TURN_RATE);
    }
    // Mutate the shared entry in place: no per-frame object per robot.
    const lp = livePositions.get(agent.id);
    if (lp) {
      lp.x = st.x;
      lp.z = st.z;
      lp.walking = st.path.length > 0 && !engaged;
      lp.waiting = status === "waiting";
    } else livePositions.set(agent.id, { x: st.x, z: st.z, walking: st.path.length > 0 && !engaged, waiting: status === "waiting" });
    // Hop onto the seat only once arrived; walk on the floor.
    const seatGoal = !held && st.path.length === 0 && Math.abs(target.x - st.x) + Math.abs(target.z - st.z) < 0.1 ? (target.yOffset ?? 0) : 0;
    st.seat += (seatGoal - st.seat) * Math.min(1, dt * 8);
    g.position.set(st.x, st.lift + st.seat, st.z);
    const ba = bubbleAnchor.current;
    if (ba) {
      camera.getWorldDirection(camDir);
      ba.position.y = bubbleAnchorY(BUBBLE_HEAD_Y, g.position.y, camera.position.y, Math.asin(Math.max(-1, Math.min(1, camDir.y))), Math.hypot(camera.position.x - st.x, camera.position.z - st.z), walking);
    }

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
      // Engaged in RPS: the right fist pumps "rock, paper, scissors" (shoulder raised, bobbing).
      armR.current.rotation.x = engaged ? -1.1 + Math.sin(t * 9) * 0.35 : s * 0.7 * w + idleWave;
    }
    // Last slap / greeting: the wobble after a slap, the nod after a greeting (0 when idle).
    const lastHit = bonkState(agent.id);
    const nowMs = Date.now();
    const wob = interactionWobble(lastHit, nowMs);
    if (tilt.current) {
      if (fainted) {
        // Lying down: tilt forward ~90°, settle gently
        const faintTilt = -Math.PI / 2 * Math.min(1, 0.5 + 0.5 * Math.sin(t * 0.4 - 0.5));
        tilt.current.rotation.x = faintTilt;
        tilt.current.rotation.z = 0;
        tilt.current.position.y = 0.05 + 0.28 * Math.max(0, Math.sin(faintTilt));
      } else {
        // A greeted robot nods (two small forward dips); a slapped one jolts back and rocks sideways,
        // readable even from right next to it in walk mode.
        tilt.current.rotation.x = 0.13 * w + 0.3 * interactionNod(lastHit, nowMs) - 0.16 * Math.max(0, wob);
        tilt.current.rotation.z = Math.sin(st.phase) * 0.05 * w + 0.1 * wob;
        tilt.current.position.y = 0.05;
      }
    }

    // Idle animation: gentle breathing bob and occasional look-around
    const idle = Math.max(0, 1 - w);
    const idleLook = idle > 0.6 && !faceViewer && !engaged ? Math.sin(t * 0.5 + seed) * Math.sin(t * 0.18 + seed * 2) * 0.15 : 0;
    if (yawG.current) yawG.current.rotation.y = st.yaw + idleLook;

    const b = body.current;
    if (b) {
      if (busy && w < 0.5) {
        const p = 1 + Math.sin(t * 6 + seed) * 0.035;
        b.scale.set(p, 1 / p, p);
        b.position.y = 0.02 * Math.abs(Math.sin(t * 6 + seed));
      } else {
        const breath = 1 + Math.sin(t * 2.2 + seed) * 0.02 * idle;
        b.scale.set(breath, 2 - breath, breath);
        b.position.y = Math.sin(t * 2.2 + seed) * 0.04 * idle + Math.abs(Math.cos(st.phase)) * 0.07 * w;
      }
      // Bonk wobble: squash-and-stretch on top of whatever the body is doing (no allocations).
      if (wob !== 0) {
        const side = 1 + 0.18 * wob;
        b.scale.set(b.scale.x * side, b.scale.y * (1 - 0.22 * wob), b.scale.z * side);
      }
    }
    if (antennaTip.current) {
      const m = antennaTip.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = status === "waiting" ? 1.2 + Math.sin(t * 8) * 1.1 : status === "error" ? 1.6 + Math.sin(t * 12) * 0.6 : busy ? 1.6 : 0.7;
    }
    if (eyes.current) {
      // Smooth blink: opens and shuts over 0.12 s within a ~5.6 s cycle.
      const blinkCycle = (t * 0.75 + seed * 0.5) % 4.2;
      if (blinkCycle > 4.05) {
        const phase = (blinkCycle - 4.05) / 0.15; // 0→1
        eyes.current.scale.y = phase < 0.5 ? 1 - phase * 1.8 : 0.1 + (phase - 0.5) * 1.8;
      } else {
        eyes.current.scale.y = 1;
      }
    }
    // Pulse the body's emissive when active (thinking / editing / waiting / error).
    if (bodyMat.current) {
      const pulse = STATUS_PULSE[status];
      bodyMat.current.emissiveIntensity = pulse
        ? (selected ? 0.32 : 0.1) + Math.sin(t * pulse + seed) * 0.07
        : selected ? 0.38 : 0.07;
    }
    // Animate the status glow ring opacity.
    if (glowMat.current) {
      const pulse = STATUS_PULSE[status];
      glowMat.current.opacity = pulse ? 0.18 + Math.sin(t * pulse * 0.7 + seed) * 0.1 : 0;
      // Opacity 0 still costs a (transparent) draw call per robot: hide it instead.
      if (glowMesh.current) glowMesh.current.visible = Boolean(pulse);
    }

    // Clamp tag scaling when zoomed in
    const dx = camera.position.x - st.x;
    const dy = camera.position.y - st.lift;
    const dz = camera.position.z - st.z;
    const camDist = Math.hypot(dx, dy, dz);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 38;
    const fovRad = (fov * Math.PI) / 180;
    const dreiScale = (1 / (2 * Math.tan(fovRad / 2) * Math.max(1, camDist))) * 18;
    const clampedScale = Math.min(1.15, Math.max(0.55, dreiScale)) / dreiScale;
    // Only touch the DOM when the clamp changes visibly (was a style write per robot per frame).
    const tagEl = tagWrapRef.current;
    if (tagEl && (tagEl !== tagScale.current.el || Math.abs(clampedScale - tagScale.current.s) > 0.004)) {
      tagScale.current.el = tagEl;
      tagScale.current.s = clampedScale;
      tagEl.style.transform = `scale(${clampedScale.toFixed(3)})`;
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Alt+click: a playful bonk instead of selecting.
    if (e.altKey) { bonk(agent.id); return; }
    if (Date.now() - useDrag.getState().droppedAt < 250) return;
    select(selected ? undefined : agent.id);
    onBodyClick?.(agent.id);
  };

  return (
    <group ref={root}>
      <group ref={yawG} scale={ROBOT_SCALE}>
        <group ref={tilt} position={[0, 0.05, 0]}>
          <group
            ref={body}
            onClick={onClick}
            userData={{ robotAgentId: agent.id }}
            onPointerDown={onGrab ? (e) => onGrab(agent.id, e) : undefined}
            onPointerOver={() => (document.body.style.cursor = onGrab ? "grab" : "pointer")}
            onPointerOut={() => (document.body.style.cursor = "")}
          >
            <mesh position={[0, 0.9, 0]} castShadow geometry={G.body}>
              <meshPhysicalMaterial
                ref={bodyMat}
                color={agent.appearance.color}
                roughness={0.25}
                metalness={0.14}
                clearcoat={0.75}
                clearcoatRoughness={0.15}
                emissive={busy || status === "waiting" || status === "error" ? statusColor : selected ? agent.appearance.accent : agent.appearance.color}
                emissiveIntensity={selected ? 0.38 : 0.07}
              />
            </mesh>
            <Eyes kind={fainted ? "visor" : agent.appearance.eyes} accent={fainted ? "#666880" : agent.appearance.accent} status={status} statusColor={fainted ? "#555770" : statusColor} blink={eyes} />
            <mesh position={[0, 1.66, 0]} geometry={G.stem} material={stdMat({ color: "#c9ced9", metalness: 0.6, roughness: 0.35 })} />
            <mesh ref={antennaTip} position={[0, 1.88, 0]} geometry={G.tip}>
              <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={0.8} toneMapped={false} />
            </mesh>
            {accents.secondAntenna && (
              <group position={[0.22, 1.5, 0]} rotation={[0, 0, -0.45]}>
                <mesh position={[0, 0.14, 0]} geometry={G.stem2} material={stdMat({ color: "#c9ced9", metalness: 0.6, roughness: 0.35 })} />
                <mesh position={[0, 0.32, 0]} geometry={G.tip2} material={stdMat({ color: accent, emissive: accent, emissiveIntensity: 0.9, toneMapped: false })} />
              </group>
            )}
            {accents.crown && (
              <mesh
                position={[0, 1.46, 0]}
                rotation={[Math.PI / 2, 0, 0]}
                geometry={G.crown}
                material={stdMat({ color: "#ffd166", emissive: "#ffd166", emissiveIntensity: 0.7, metalness: 0.8, roughness: 0.25, toneMapped: false })}
              />
            )}
            {/* Little arms, pivoting at the shoulder. */}
            <group ref={armL} position={[-0.6, 0.95, 0]}>
              <mesh position={[-0.03, -0.17, 0]} rotation={[0, 0, -0.12]} castShadow geometry={G.arm} material={armMat} />
              <mesh position={[-0.05, -0.36, 0]} geometry={G.hand} material={HAND_MAT()} />
            </group>
            <group ref={armR} position={[0.6, 0.95, 0]}>
              <mesh position={[0.03, -0.17, 0]} rotation={[0, 0, 0.12]} castShadow geometry={G.arm} material={armMat} />
              <mesh position={[0.05, -0.36, 0]} geometry={G.hand} material={HAND_MAT()} />
            </group>
            <mesh position={[0, 0.34, 0]} geometry={G.base} material={stdMat({ color: "#232635", roughness: 0.6, metalness: 0.3 })} />
          </group>
        </group>
        <mesh ref={footL} position={[-0.19, 0.07, 0.04]} castShadow geometry={G.foot} material={FOOT_MAT()} />
        <mesh ref={footR} position={[0.19, 0.07, 0.04]} castShadow geometry={G.foot} material={FOOT_MAT()} />
      </group>
      <mesh
        position={[0, 0.03, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        geometry={selected ? G.ringSelected : G.ring}
        material={stdMat({ color: statusColor, emissive: statusColor, emissiveIntensity: busy || status === "waiting" || status === "error" ? 1.6 : 0.55, toneMapped: false })}
      />
      {/* Inner glow ring; animated opacity via glowMat ref when active, hidden (no draw call) when idle. */}
      <mesh ref={glowMesh} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} geometry={G.glow} visible={false}>
        <meshBasicMaterial ref={glowMat} color={statusColor} transparent opacity={0} toneMapped={false} />
      </mesh>
      {accents.glowRing && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} geometry={G.glowAccent} material={basicMat({ color: accent === "#ffffff" ? agent.appearance.color : accent, opacity: 0.22 })} />
      )}
      {tagsVisible && (
      <Html center distanceFactor={18} position={[0, 2.35 * ROBOT_SCALE + 0.15, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        {/* Stop DOM events here: fiber listens on the canvas wrapper, so a click on the tag would otherwise count as a "pointer missed" and deselect. */}
        <div
          ref={tagWrapRef}
          className={`tag-wrap ${selected ? "tag-selected" : ""}`}
          data-status={status}
          style={{ transformOrigin: "bottom center" }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {agent.limit?.limited && (
            <>
              <LimitChip limit={agent.limit} onSwitch={() => setSwitchOpen(true)} />
              {switchOpen && (
                <SwitchAgentModal
                  agentId={agent.id}
                  agentName={agent.name}
                  currentProvider={agent.provider}
                  currentModel={agent.model}
                  onClose={() => setSwitchOpen(false)}
                />
              )}
            </>
          )}
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
          <button
            type="button"
            className="tag"
            onClick={() => select(selected ? undefined : agent.id)}
            style={{
              borderColor: statusColor,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: activity ? 2 : 0,
              padding: activity ? "3px 8px" : undefined,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="tag-name">{agent.name}</span>
              <span className="tag-level">Lv {agent.stats.level}</span>
              {agent.provider === "claude-session" && agent.session && (
                <span className={`tag-session ${sessionInfo?.online ? "tag-session-on" : ""}`} title={sessionInfo?.model ?? undefined}>
                  {sessionInfo?.name ?? agent.session.name ?? "session"}
                </span>
              )}
            </div>
            {activity && (
              <span
                className="tag-activity"
                style={{
                  display: "block",
                  fontSize: "11px",
                  lineHeight: "1.2",
                  fontWeight: 500,
                  color: statusColor,
                  opacity: 0.95,
                  maxWidth: 190,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={activity}
              >
                {activity}
              </span>
            )}
          </button>
        </div>
      </Html>
      )}
      {!tagsVisible && bubble?.bonk && bubbleText && (
        <group ref={bubbleAnchor} position={[0, BUBBLE_HEAD_Y, 0]}>
        <Html center distanceFactor={walking ? WALK_BUBBLE_DISTANCE_FACTOR : 10} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className={`bubble bubble-text bubble-bonk${bubble.greet ? " bubble-greet" : ""}`} data-testid={bubble.greet ? "greet-bubble" : "bonk-bubble"}>{bubbleText}</div>
        </Html>
        </group>
      )}
      {fainted && tagsVisible && (
        <Html center position={[0, 2.2 * ROBOT_SCALE, 0]} distanceFactor={18} zIndexRange={[18, 0]} style={{ pointerEvents: "none" }}>
          <div className="faint-zz" aria-label="Fainted – quota exceeded">
            <span className="faint-z z1">z</span>
            <span className="faint-z z2">Z</span>
            <span className="faint-z z3">Z</span>
          </div>
        </Html>
      )}
      {/* Extra overlays (file chips) follow the tags: unmounted, not just hidden, in walk mode / tags off. */}
      {tagsVisible && children}
    </group>
  );
}
