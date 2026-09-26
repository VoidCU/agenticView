/**
 * WalkMode — true first-person walk camera.
 *
 * When useWalk().walking is true:
 *  - Camera is placed at eye height; OrbitControls disabled.
 *  - WASD/arrows move the player; smooth acceleration/deceleration.
 *  - Mouse look via Pointer Lock API (click canvas → captured; Esc → released + exit walk mode).
 *  - Walking head-bob (vertical sine + lateral cosine).
 *  - Collision via movePlayer (AABB sub-step + isWalkable outer wall).
 *  - Screen-centre raycast: clicking while locked fires select on the nearest
 *    DeskMonitor or whiteboard within MAX_INTERACT_DIST.
 *  - Keys ignored while typing in inputs or a modal is open.
 */
import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { type Space } from "@agenticview/shared";
import { useWalk } from "../state/walk";
import { useStore } from "../state/store";
import { movePlayer, walkDelta, clampPitch, applyVelocity } from "./walkPhysics";
import { type Solid } from "./colliders";

// ---- Constants ----

/** Camera height above floor (eye level). */
const EYE_HEIGHT = 1.7;
/** Mouse sensitivity (radians per pixel via pointer lock movementX/Y). */
const MOUSE_SENSITIVITY = 0.0022;

/** Head-bob amplitude (Y, world units). */
const BOB_AMP_Y = 0.055;
/** Head-bob amplitude (X, lateral sway). */
const BOB_AMP_X = 0.022;
/** Head-bob frequency (cycles per world-unit walked). */
const BOB_FREQ = 3.8;

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
    locked: false,       // is pointer lock active?
    clickPending: false, // user pressed primary button while locked
  });

  const keys = useRef(new Set<string>());

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
      if (!st.current.locked) {
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
    const bobWeight = Math.min(1, speed / 2);
    const bobY = Math.sin(cur.bobPhase * 2) * BOB_AMP_Y * bobWeight;
    const bobX = Math.cos(cur.bobPhase) * BOB_AMP_X * bobWeight;

    // Apply camera.
    camera.position.set(cur.x + bobX, EYE_HEIGHT + bobY, cur.z);

    // Build rotation from yaw + pitch.
    const euler = new THREE.Euler(cur.pitch, cur.yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(euler);

    // Screen-centre raycast: fire when click was pending.
    if (cur.clickPending) {
      cur.clickPending = false;
      raycaster.current.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hits = raycaster.current.intersectObjects(scene.children, true);
      for (const hit of hits) {
        if (hit.distance > MAX_INTERACT_DIST) break;
        // Walk up the hierarchy looking for userData.agentId or userData.boardSpaceId.
        let obj: THREE.Object3D | null = hit.object;
        while (obj) {
          if (obj.userData?.agentId) {
            select(obj.userData.agentId as string);
            break;
          }
          if (obj.userData?.boardSpaceId) {
            onBoard?.(obj.userData.boardSpaceId as string);
            break;
          }
          obj = obj.parent;
        }
        if (obj) break;
      }
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
