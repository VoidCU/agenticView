/**
 * WalkMode — third-person walk camera and player avatar.
 *
 * When useWalk().walking is true:
 *  - OrbitControls are replaced by WASD/arrow movement + mouse-drag look.
 *  - A "You" avatar follows the player position.
 *  - Collision is enforced via walkPhysics.movePlayer.
 *  - Esc or setWalking(false) returns to overview.
 *  - Keys are ignored while typing in inputs or when a modal is open.
 *  - Near a whiteboard, clicking it fires the onOpenBoard callback.
 */
import { useRef, useEffect, useCallback, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { type Space } from "@agenticview/shared";
import { useWalk } from "../state/walk";
import { movePlayer, walkDelta, clampPitch } from "./walkPhysics";
import { Robot } from "./Robot";

/** Walk speed in world units per second. */
const WALK_SPEED = 4.5;
/** Mouse sensitivity (radians per pixel). */
const MOUSE_SENSITIVITY = 0.004;
/** Camera height above floor (eye level). */
const EYE_HEIGHT = 1.7;
/** Camera follows player at this distance behind + above (third-person). */
const CAM_OFFSET_BACK = 3.2;
const CAM_OFFSET_UP = 1.2;

/** Player you-avatar definition (reuses scene YOU constant shape). */
const YOU_AGENT = {
  id: "__walk_you__",
  name: "You",
  role: "worker" as const,
  scope: "project" as const,
  specialty: "You",
  description: "",
  provider: "claude" as const,
  model: null,
  systemPrompt: "",
  tools: { edit: true, shell: true, web: true, screenshot: false },
  permissionMode: "ask" as const,
  appearance: { color: "#e6e8f0", accent: "#ffd166", eyes: "dots" as const },
  stats: { xp: 0, level: 1, tasksDone: 0, tasksFailed: 0 },
  createdAt: "",
  updatedAt: "",
};

interface WalkModeProps {
  spaces: Space[];
  /** Initial player world-space start position. */
  startX: number;
  startZ: number;
}

/** Inner component: handles input, updates camera, renders avatar. Mounted only while walking. */
export function WalkModeController({ spaces, startX, startZ }: WalkModeProps) {
  const { camera, gl } = useThree();
  const setWalking = useWalk((s) => s.setWalking);

  // Mutable state (not React state: updated per-frame without triggering re-renders).
  const state = useRef({
    x: startX,
    z: startZ,
    yaw: 0,     // camera look direction (Y rotation)
    pitch: 0,   // camera tilt (X rotation)
    dragging: false,
    /** True while pointer is down but hasn't moved far enough to be a real drag yet. */
    dragPending: false,
    prevMX: 0,
    prevMY: 0,
  });

  const keys = useRef(new Set<string>());

  // Position vector for Robot target
  const robotTarget = useMemo(
    () => ({ x: startX, z: startZ, yaw: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ---- Input setup ----

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in a text input or modal.
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "Escape") {
        setWalking(false);
        return;
      }
      keys.current.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [setWalking]);

  // Mouse drag for look.
  // We do NOT start rotating the camera until the pointer has moved > 4 px; this
  // ensures that a clean click on a whiteboard (or any 3D mesh) does not cause a
  // camera jerk and lets the R3F onClick event fire without interference.
  useEffect(() => {
    const canvas = gl.domElement;
    const DRAG_THRESHOLD = 4;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      state.current.dragPending = true;
      state.current.dragging = false;
      state.current.prevMX = e.clientX;
      state.current.prevMY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      const st = state.current;
      if (!st.dragPending && !st.dragging) return;
      const dx = e.clientX - st.prevMX;
      const dy = e.clientY - st.prevMY;
      if (st.dragPending) {
        // Activate look-drag only once threshold is exceeded.
        if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
          st.dragPending = false;
          st.dragging = true;
        } else {
          return; // not yet a drag — don't rotate
        }
      }
      st.prevMX = e.clientX;
      st.prevMY = e.clientY;
      st.yaw -= dx * MOUSE_SENSITIVITY;
      st.pitch = clampPitch(st.pitch - dy * MOUSE_SENSITIVITY);
    };
    const onUp = () => {
      state.current.dragging = false;
      state.current.dragPending = false;
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [gl]);

  // ---- Per-frame update ----

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.08);
    const st = state.current;

    // Movement
    const { dx, dz } = walkDelta(keys.current, st.yaw);
    if (dx !== 0 || dz !== 0) {
      const step = WALK_SPEED * dt;
      const next = movePlayer(spaces, st.x, st.z, dx * step, dz * step);
      st.x = next.x;
      st.z = next.z;
      // Face the direction of movement
      if (Math.abs(dx) + Math.abs(dz) > 0.01) {
        st.yaw = Math.atan2(dx, dz);
      }
    }

    // Update robot target to match player position
    robotTarget.x = st.x;
    robotTarget.z = st.z;
    robotTarget.yaw = st.yaw;

    // Third-person camera: behind and above the player
    const sinY = Math.sin(st.yaw);
    const cosY = Math.cos(st.yaw);
    const camX = st.x - sinY * CAM_OFFSET_BACK;
    const camZ = st.z - cosY * CAM_OFFSET_BACK;
    const camY = EYE_HEIGHT + CAM_OFFSET_UP;
    camera.position.lerp(new THREE.Vector3(camX, camY, camZ), Math.min(1, dt * 10));
    // Look at the player's eye level from behind
    const lookX = st.x + sinY * 1.5;
    const lookZ = st.z + cosY * 1.5;
    camera.lookAt(lookX, EYE_HEIGHT * 0.85, lookZ);
  });

  return (
    <Robot
      agent={YOU_AGENT}
      target={robotTarget}
      spaces={spaces}
    />
  );
}

/**
 * Mount point: renders WalkModeController only while walking=true.
 * Also disables OrbitControls while walking.
 */
interface WalkModeProps2 {
  spaces: Space[];
  startX: number;
  startZ: number;
}

export function WalkMode({ spaces, startX, startZ }: WalkModeProps2) {
  const walking = useWalk((s) => s.walking);
  if (!walking) return null;
  return <WalkModeController spaces={spaces} startX={startX} startZ={startZ} />;
}
