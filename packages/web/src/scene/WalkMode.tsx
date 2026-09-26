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
import { useRef, useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { spaceAt, type Space } from "@agenticview/shared";
import { useWalk } from "../state/walk";
import { useStore } from "../state/store";
import { isWalkable, movePlayer, walkDelta, clampPitch, applyVelocity, BOB_FREQ, bobWeightStep, headBobSide, headBobY } from "./walkPhysics";
import { MAX_DEPEN_PER_FRAME, PLAYER_RADIUS, type Solid } from "./colliders";
import { chairField } from "./pushChairs";
import { usePositions } from "../state/positions";
import { bonk, BONK_RANGE, greet, GREET_RANGE } from "../state/bonk";
import { SLAP_HIT_MS, triggerHand } from "./handGesture";
import { WalkHand, updateWalkHand } from "./WalkHand";
import { openOverlayFromWalk } from "../state/pointerLock";

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
  const setEvents = useThree((s) => s.setEvents);

  // While walking, the crosshair raycast below is the only way to interact with the scene. R3F's own
  // pointer events would fire at the (frozen, off-centre) mouse position: a click that only meant to
  // capture the mouse used to open a whiteboard's board BEHIND a pointer lock that then kept the
  // cursor hidden and spun the camera behind the board.
  useEffect(() => {
    setEvents({ enabled: false });
    return () => setEvents({ enabled: true });
  }, [setEvents]);
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
    greetPending: false, // user pressed H: say hi to the agent under the crosshair
  });

  const keys = useRef(new Set<string>());
  // Pushable chairs: clearance test built once per floor plan; one scratch point for the walker.
  const chairClear = useMemo(() => chairField.clearFn(solids, (x, z) => isWalkable(spaces, x, z)), [solids, spaces]);
  const walker = useRef({ x: 0, z: 0 });
  const lastPlayerPosition = useRef<{ x: number; z: number; yaw: number; spaceId: string; at: number } | null>(null);

  useEffect(() => () => {
    usePositions.getState().setPlayer(undefined);
    // Remember where we stopped so the 'You' robot can walk home from here.
    useWalk.getState().setExitAt({ x: st.current.x, z: st.current.z });
  }, []);

  // ---- Test hook: teleport walk position ----
  useEffect(() => {
    const teleport = (x: number, z: number, yaw = 0, pitch = 0) => {
      st.current.x = x;
      st.current.z = z;
      st.current.yaw = yaw;
      st.current.pitch = clampPitch(pitch);
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
      useWalk.getState().setLocked(st.current.locked);
      // Re-locked by a click on the view (after a chat or board freed the mouse): walking resumes.
      if (st.current.locked && document.querySelector('[role="dialog"]')) {
        // The lock landed while an overlay is open (a late grant): hand the mouse straight back.
        useWalk.getState().setPaused(true);
        document.exitPointerLock();
        return;
      }
      if (st.current.locked && useWalk.getState().paused) useWalk.getState().setPaused(false);
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
      if (e.code === "KeyH" && !e.repeat) st.current.greetPending = true;
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
  const hand = useRef<THREE.Group>(null);
  const scratch = useRef({ euler: new THREE.Euler(0, 0, 0, "YXZ"), centre: new THREE.Vector2(0, 0), world: new THREE.Vector3() });

  // ---- Per-frame update ----

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.08);
    const cur = st.current;
    // An overlay freed the mouse: drop held keys so the walker does not keep drifting behind it.
    if (keys.current.size > 0 && useWalk.getState().paused) keys.current.clear();

    // Movement direction from keys.
    const { dx, dz } = walkDelta(keys.current, cur.yaw);

    // Smooth velocity.
    const vel = applyVelocity(cur.vx, cur.vz, dx, dz, dt);
    cur.vx = vel.vx;
    cur.vz = vel.vz;

    const moveDist = Math.hypot(cur.vx, cur.vz) * dt;
    {
      // Always resolve, even standing still: a walker left overlapping furniture (a chair shoved them,
      // a long frame) is eased out through the nearest face a little per frame instead of being
      // thrown across the obstacle on the next step.
      const still = moveDist <= 1e-4;
      const next = movePlayer(spaces, cur.x, cur.z, still ? 0 : cur.vx * dt, still ? 0 : cur.vz * dt, solids);
      cur.x = next.x;
      cur.z = next.z;
    }
    // Chairs: shove the ones you walk into, glide the ones still sliding, and keep you out of fixed
    // (or blocked) ones. Runs every frame so a shoved chair settles even after you stop.
    {
      const w = walker.current;
      w.x = cur.x;
      w.z = cur.z;
      chairField.interact(w, PLAYER_RADIUS, dt, chairClear, performance.now(), MAX_DEPEN_PER_FRAME);
      if ((w.x !== cur.x || w.z !== cur.z) && isWalkable(spaces, w.x, w.z)) {
        cur.x = w.x;
        cur.z = w.z;
      }
    }
    if (moveDist > 1e-4) {
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
      // MiniMap marker: at most 4 Hz (room changes immediately). Turning used to publish every frame.
      const nowMs = performance.now();
      if (!prev || prev.spaceId !== currentSpace.id || (nowMs - prev.at >= 250 && (Math.hypot(cur.x - prev.x, cur.z - prev.z) >= 0.12 || Math.abs(cur.yaw - prev.yaw) >= 0.045))) {
        lastPlayerPosition.current = { x: cur.x, z: cur.z, yaw: cur.yaw, spaceId: currentSpace.id, at: nowMs };
        usePositions.getState().setPlayer({ x: cur.x, z: cur.z, yaw: cur.yaw, spaceId: currentSpace.id });
      }
    }

    // Build rotation from yaw + pitch.
    const euler = scratch.current.euler.set(cur.pitch, cur.yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(euler);

    // Screen-centre raycast: fire when a click, E, G or H press is pending.
    if (cur.clickPending || cur.bonkPending || cur.challengePending || cur.greetPending) {
      const intent: WalkIntent = cur.clickPending ? "click" : cur.bonkPending ? "bonk" : cur.challengePending ? "challenge" : "greet";
      cur.clickPending = false;
      cur.bonkPending = false;
      cur.challengePending = false;
      cur.greetPending = false;
      raycaster.current.setFromCamera(scratch.current.centre, camera);
      const hits = raycaster.current.intersectObjects(scene.children, true);
      const action = walkInteraction(hits, camera.position, scratch.current.world, intent);
      if (action?.kind === "bonk") {
        // The hand swings in; the agent's wobble starts when it lands (SLAP_HIT_MS later).
        if (bonk(action.id, Date.now() + SLAP_HIT_MS) !== undefined) triggerHand("slap", performance.now());
      } else if (action?.kind === "greet") {
        if (greet(action.id) !== undefined) triggerHand("wave", performance.now());
      } else if (action?.kind === "select") {
        // The agent's chat opens beside the view: free the mouse so it can be used (click the view to walk on).
        openOverlayFromWalk();
        select(action.id);
      }
      else if (action?.kind === "board") onBoard?.(action.id);
      else if (action?.kind === "challenge") window.dispatchEvent(new CustomEvent("agenticview:play-rps", { detail: { agentId: action.id } }));
    }
    // First-person hand: posed after the camera moved this frame (hidden and skipped when idle).
    updateWalkHand(hand.current, camera, performance.now());
  });

  // No avatar body in first-person mode: only the hand, while it slaps or waves.
  return <WalkHand ref={hand} />;
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

export type WalkAction = { kind: "bonk" | "select" | "board" | "challenge" | "greet"; id: string };
/** What triggered the crosshair raycast: a click, E (bonk), G (challenge to rock-paper-scissors) or H (say hi). */
export type WalkIntent = "click" | "bonk" | "challenge" | "greet";
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
        if (intent === "greet") return dist <= GREET_RANGE ? { kind: "greet", id } : undefined;
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
