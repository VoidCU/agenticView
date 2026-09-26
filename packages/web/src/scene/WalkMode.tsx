/**
 * WalkMode — true first-person walk camera.
 *
 * When useWalk().walking is true:
 *  - Camera is placed at eye height; OrbitControls disabled.
 *  - WASD/arrows move the player; smooth acceleration/deceleration.
 *  - Mouse look via Pointer Lock API (click canvas → captured; Esc → released + exit walk mode).
 *  - Subtle walking head-bob (a few mm; eased in/out with speed; none when standing still).
 *  - Collision via movePlayer (AABB sub-step + isWalkable outer wall).
 *  - Screen-centre raycast: clicking while locked fires select on the nearest
 *    DeskMonitor or whiteboard within MAX_INTERACT_DIST; E (or a click) on a robot within
 *    BONK_RANGE gives it a playful bonk (state/bonk.ts).
 *  - Keys ignored while typing in inputs or a modal is open.
 */
import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { spaceAt, type Space } from "@agenticview/shared";
import { useWalk } from "../state/walk";
import { useStore } from "../state/store";
import { movePlayer, walkDelta, clampPitch, applyVelocity, BOB_FREQ, bobWeightStep, headBobSide, headBobY } from "./walkPhysics";
import { type Solid } from "./colliders";
import { usePositions } from "../state/positions";
import { bonk, BONK_RANGE } from "../state/bonk";

// ---- Constants ----

/** Camera height above floor (eye level). */
const EYE_HEIGHT = 1.7;
/** Mouse sensitivity (radians per pixel via pointer lock movementX/Y). */
const MOUSE_SENSITIVITY = 0.0022;


/** Max distance for monitor/whiteboard interaction raycast. */
const MAX_INTERACT_DIST = 7;

// ---- Pointer-lock helpers ----

/** True when the canvas is currently pointer-locked. */
function isLocked(domElement: HTMLElement): boolean {
  return document.pointerLockElement === domElement;
}

// ---- Inner controller (mounted only while walking) ----

interface WalkControllerProps {
  spaces: Space[];
  startX: number;
  startZ: number;
  solids?: Solid[];
  /** Called when the player clicks a whiteboard (identified by its space id). */
  onBoard?: (spaceId: string) => void;
}

/**
 * Inner component: handles input, updates the camera, enforces collision.
 * Mounted only while useWalk().walking is true.
 */
export function WalkModeController({
  spaces,
  startX,
  startZ,
  solids = [],
  onBoard,
}: WalkControllerProps) {
  const { camera, gl, scene } = useThree();
  const setWalking = useWalk((s) => s.setWalking);
  const select = useStore((s) => s.select);

  // Mutable per-frame state (not React state — no re-render on change).
  const st = useRef({
    x: startX,
    z: startZ,
    yaw: 0,   // horizontal look (Y-axis rotation)
    pitch: 0, // vertical look (X-axis rotation)
    vx: 0,    // horizontal velocity X
    vz: 0,    // horizontal velocity Z
    bobPhase: 0,
    bobWeight: 0,
    locked: false,       // is pointer lock active?
    clickPending: false, // user pressed primary button while locked
    bonkPending: false,  // user pressed E: bonk the agent under the crosshair if close
    challengePending: false, // user pressed G: challenge the agent under the crosshair to RPS
  });

  const keys = useRef(new Set<string>());
  const lastPlayerPosition = useRef<{ x: number; z: number; yaw: number; spaceId: string } | null>(null);

  useEffect(() => () => {
    usePositions.getState().setPlayer(undefined);
    // Remember where we stopped so the 'You' robot can walk home from here.
    useWalk.getState().setExitAt({ x: st.current.x, z: st.current.z });
  }, []);

  // ---- Test hook: teleport walk position ----
  useEffect(() => {
    const teleport = (x: number, z: number, yaw = 0) => {
      st.current.x = x;
      st.current.z = z;
      st.current.yaw = yaw;
      st.current.vx = 0;
      st.current.vz = 0;
    };
    (window as unknown as Record<string, unknown>).__teleportWalk = teleport;
    return () => { delete (window as unknown as Record<string, unknown>).__teleportWalk; };
  }, []);

  // ---- Pointer lock setup ----

  useEffect(() => {
    const canvas = gl.domElement;

    // Click canvas → request pointer lock (only if not already locked).
    const onCanvasClick = () => {
      if (!isLocked(canvas)) {
        canvas.requestPointerLock();
      } else {
        // Already locked: schedule a raycast interaction on next frame.
        st.current.clickPending = true;
      }
    };

    // Lock acquired.
    const onLockChange = () => {
      st.current.locked = isLocked(canvas);
      if (!st.current.locked && !useWalk.getState().paused) {
        // Pointer lock released (user pressed Esc, or browser forced unlock).
        setWalking(false);
      }
    };

    // Mouse look (only runs while locked).
    const onMouseMove = (e: MouseEvent) => {
      if (!isLocked(canvas)) return;
      st.current.yaw -= e.movementX * MOUSE_SENSITIVITY;
      st.current.pitch = clampPitch(
        st.current.pitch - e.movementY * MOUSE_SENSITIVITY,
      );
    };

    canvas.addEventListener("click", onCanvasClick);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMouseMove);
    return () => {
      canvas.removeEventListener("click", onCanvasClick);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMouseMove);
      // Release lock if still held when component unmounts.
      if (isLocked(canvas)) document.exitPointerLock();
    };
  }, [gl, setWalking]);

  // ---- Keyboard input ----

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "Escape") {
        // Esc: release pointer lock → onLockChange fires → setWalking(false).
        // If not locked (e.g. browser already released), exit manually.
        if (!isLocked(gl.domElement)) setWalking(false);
        // If locked, exitPointerLock triggers the pointerlockchange handler.
        return;
      }
      if (e.code === "KeyE" && !e.repeat) st.current.bonkPending = true;
      if (e.code === "KeyG" && !e.repeat) st.current.challengePending = true;
      keys.current.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [gl, setWalking]);

  // ---- Raycaster for screen-centre interaction ----

  const raycaster = useRef(new THREE.Raycaster());
  const scratch = useRef({ euler: new THREE.Euler(0, 0, 0, "YXZ"), centre: new THREE.Vector2(0, 0), world: new THREE.Vector3() });

  // ---- Per-frame update ----

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.08);
    const cur = st.current;

    // Movement direction from keys.
    const { dx, dz } = walkDelta(keys.current, cur.yaw);

    // Smooth velocity.
    const vel = applyVelocity(cur.vx, cur.vz, dx, dz, dt);
    cur.vx = vel.vx;
    cur.vz = vel.vz;

    const moveDist = Math.hypot(cur.vx, cur.vz) * dt;
    if (moveDist > 1e-4) {
      const next = movePlayer(spaces, cur.x, cur.z, cur.vx * dt, cur.vz * dt, solids);
      cur.x = next.x;
      cur.z = next.z;
      cur.bobPhase += moveDist * BOB_FREQ;
    }

    // Head-bob: applied only while moving.
    const speed = Math.hypot(cur.vx, cur.vz);
    cur.bobWeight = bobWeightStep(cur.bobWeight, speed, dt);
    const bobY = headBobY(cur.bobPhase, cur.bobWeight);
    const side = headBobSide(cur.bobPhase, cur.bobWeight);

    // Apply camera.
    // Sway along the camera's right vector (cos yaw, -sin yaw), not world X.
    camera.position.set(cur.x + Math.cos(cur.yaw) * side, EYE_HEIGHT + bobY, cur.z - Math.sin(cur.yaw) * side);

    const currentSpace = spaceAt(spaces, cur.x, cur.z);
    if (currentSpace) {
      const prev = lastPlayerPosition.current;
      if (!prev || prev.spaceId !== currentSpace.id || Math.hypot(cur.x - prev.x, cur.z - prev.z) >= 0.12 || Math.abs(cur.yaw - prev.yaw) >= 0.045) {
        lastPlayerPosition.current = { x: cur.x, z: cur.z, yaw: cur.yaw, spaceId: currentSpace.id };
        usePositions.getState().setPlayer({ x: cur.x, z: cur.z, yaw: cur.yaw, spaceId: currentSpace.id });
      }
    }

    // Build rotation from yaw + pitch.
    const euler = scratch.current.euler.set(cur.pitch, cur.yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(euler);

    // Screen-centre raycast: fire when a click or E press is pending.
    if (cur.clickPending || cur.bonkPending || cur.challengePending) {
      const intent: WalkIntent = cur.clickPending ? "click" : cur.bonkPending ? "bonk" : "challenge";
      cur.clickPending = false;
      cur.bonkPending = false;
      cur.challengePending = false;
      raycaster.current.setFromCamera(scratch.current.centre, camera);
      const hits = raycaster.current.intersectObjects(scene.children, true);
      const action = walkInteraction(hits, camera.position, scratch.current.world, intent);
      if (action?.kind === "bonk") bonk(action.id);
      else if (action?.kind === "select") select(action.id);
      else if (action?.kind === "board") onBoard?.(action.id);
      else if (action?.kind === "challenge") window.dispatchEvent(new CustomEvent("agenticview:play-rps", { detail: { agentId: action.id } }));
    }
  });

  // No visual avatar in first-person mode.
  return null;
}

// ---- Public mount point ----

interface WalkModeProps {
  spaces: Space[];
  startX: number;
  startZ: number;
  /** Optional interior solid obstacles (from scene/colliders.ts buildColliders). */
  solids?: Solid[];
  /** Called when the player clicks a whiteboard (identified by its space id). */
  onBoard?: (spaceId: string) => void;
}

/**
 * Renders WalkModeController only while useWalk().walking is true.
 * Place inside the R3F Canvas alongside OrbitControls; WalkMode suppresses
 * OrbitControls via the walk state which the Office component reads.
 */
export function WalkMode({ spaces, startX, startZ, solids, onBoard }: WalkModeProps) {
  const walking = useWalk((s) => s.walking);
  if (!walking) return null;
  return (
    <WalkModeController
      spaces={spaces}
      startX={startX}
      startZ={startZ}
      solids={solids}
      onBoard={onBoard}
    />
  );
}

export type WalkAction = { kind: "bonk" | "select" | "board" | "challenge"; id: string };
/** What triggered the crosshair raycast: a click, E (bonk) or G (challenge to rock-paper-scissors). */
export type WalkIntent = "click" | "bonk" | "challenge";
/** Walk mode: challenge an agent to RPS from this close (anywhere: desk, corridor, lounge). */
export const CHALLENGE_RANGE = 3;

/**
 * What a screen-centre click (or E press, `bonkOnly`) does, given the raycast hits (nearest first).
 * A robot within BONK_RANGE (horizontal, from the camera to the robot's origin) gets bonked; a
 * farther robot or a desk monitor selects its agent; a whiteboard opens its board.
 * `tmp` is a caller-owned scratch vector so this never allocates.
 */
export function walkInteraction(
  hits: ReadonlyArray<{ distance: number; object: THREE.Object3D }>,
  cam: { x: number; z: number },
  tmp: THREE.Vector3,
  intent: WalkIntent = "click",
): WalkAction | undefined {
  const clickOnly = intent !== "click";
  for (const hit of hits) {
    if (hit.distance > MAX_INTERACT_DIST) return undefined;
    let obj: THREE.Object3D | null = hit.object;
    while (obj) {
      const ud = obj.userData;
      if (ud?.robotAgentId) {
        const root = obj.parent?.parent?.parent ?? obj; // body -> tilt -> yaw -> root group
        root.getWorldPosition(tmp);
        const dist = Math.hypot(tmp.x - cam.x, tmp.z - cam.z);
        const id = ud.robotAgentId as string;
        if (intent === "challenge") return dist <= CHALLENGE_RANGE ? { kind: "challenge", id } : undefined;
        if (dist <= BONK_RANGE) return { kind: "bonk", id };
        return clickOnly ? undefined : { kind: "select", id };
      }
      if (ud?.agentId) return clickOnly ? undefined : { kind: "select", id: ud.agentId as string };
      if (ud?.boardSpaceId) return clickOnly ? undefined : { kind: "board", id: ud.boardSpaceId as string };
      obj = obj.parent;
    }
  }
  return undefined;
}
