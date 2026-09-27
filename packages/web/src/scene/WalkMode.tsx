/**
 * WalkMode — true first-person walk camera.
 *
 * When useWalk().walking is true:
 *  - Camera is placed at eye height; OrbitControls disabled.
 *  - WASD/arrows move the player; smooth acceleration/deceleration.
 *  - Mouse look via Pointer Lock API (click canvas → captured; Esc → released + exit walk mode).
 *  - Subtle walking head-bob (a few mm; eased in/out with speed; none when standing still).
 *  - Collision via movePlayer (AABB sub-step + isWalkable outer wall).
 *  - Every walk session starts in My Office (walkStartPose: one step behind the pushable desk
 *    chair, facing WALL_SCREEN) rather than the props' startX/startZ, which stay only as a fallback
 *    for layouts/tests with no "myoffice" space. My Office's hex is data (scene/layout.ts
 *    layoutFor / shared planOffice), so this tracks the layout wherever that room moves.
 *  - Screen-centre raycast: clicking while locked fires select on the nearest
 *    DeskMonitor or whiteboard within MAX_INTERACT_DIST; E (or a click) on a robot within
 *    BONK_RANGE gives it a playful bonk (state/bonk.ts); clicking the My Office wall screen
 *    (userData.wallScreenKind === "myoffice") opens Settings on the Connections tab.
 *  - C on a robot within CHAT_RANGE opens its chat, expanded, mouse freed, message box focused
 *    (state/walkChat.ts); Esc then closes it and walking resumes (click the view to look around).
 *  - Keys ignored while typing in inputs or a modal is open (and C ignored with Ctrl/Cmd/Alt: copy).
 */
import { useRef, useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { spaceAt, WALL_SCREEN, type Space } from "@agenticview/shared";
import { myOfficeChairFrame } from "./kit";
import { CHAIR_D } from "./solids";
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
import { endWalkChat, installWalkChatEscape, isTypingTarget, isWalkChatKey, openWalkChat, useWalkChat } from "../state/walkChat";

// ---- Constants ----

/** Camera height above floor (eye level). */
const EYE_HEIGHT = 1.7;
/** Mouse sensitivity (radians per pixel via pointer lock movementX/Y). */
const MOUSE_SENSITIVITY = 0.0022;


/** Max distance for monitor/whiteboard interaction raycast. */
const MAX_INTERACT_DIST = 7;

/** Gap left between the walker's collision circle and the My Office chair's back at the start. */
export const WALK_START_CLEARANCE = 0.12;

/**
 * Where a walk session starts in My Office, as a camera pose (walk yaw: forward = (-sin, -cos)).
 * userHome() is the seated spot at the executive desk; the pushable desk chair sits between it and the
 * room centre, so spawning there shoved the chair (and the walker) the first frame. Instead start one
 * small step behind the chair, on the same line (room centre -> desk -> WALL_SCREEN), so the view is
 * unchanged: desk and chair in front, the wall screen straight ahead.
 */
export function walkStartPose(space: { x: number; z: number }): { x: number; z: number; yaw: number } {
  const chair = myOfficeChairFrame();
  // Unit vector from the room centre toward the screen (the chair, the seated spot and the desk lie on it).
  const len = Math.hypot(WALL_SCREEN.x, WALL_SCREEN.z) || 1;
  const ux = WALL_SCREEN.x / len;
  const uz = WALL_SCREEN.z / len;
  // The chair faces the screen (yaw = home.yaw), so its depth axis lies along this line.
  const chairAlong = chair.x * ux + chair.z * uz;
  const along = chairAlong - CHAIR_D / 2 - PLAYER_RADIUS - WALK_START_CLEARANCE;
  const x = space.x + ux * along;
  const z = space.z + uz * along;
  const dx = space.x + WALL_SCREEN.x - x;
  const dz = space.z + WALL_SCREEN.z - z;
  return { x, z, yaw: Math.atan2(-dx, -dz) };
}

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

  // Every session starts in My Office just behind the desk chair, facing WALL_SCREEN — not wherever
  // the last session ended (Office.tsx's exitAt only drives the 'You' robot walking home afterwards).
  // Falls back to the caller's startX/startZ when the layout has no "myoffice" space (older buildSpaces
  // layouts, tests). walkStartPose returns a camera yaw already (forward = (-sin, -cos), see
  // walkDelta's unit test); userHome()'s robot-facing yaw would need + PI.
  const myOffice = spaces.find((s) => s.kind === "myoffice");
  const home = myOffice ? walkStartPose(myOffice) : { x: startX, z: startZ, yaw: 0 };
  const homeCamYaw = home.yaw;

  // Mutable per-frame state (not React state — no re-render on change).
  const st = useRef({
    x: home.x,
    z: home.z,
    yaw: homeCamYaw,   // horizontal look (Y-axis rotation)
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
    chatPending: false,  // user pressed C: open a chat with the agent under the crosshair
  });

  const keys = useRef(new Set<string>());
  // Pushable chairs: clearance test built once per floor plan; one scratch point for the walker.
  const chairClear = useMemo(() => chairField.clearFn(solids, (x, z) => isWalkable(spaces, x, z)), [solids, spaces]);
  const walker = useRef({ x: 0, z: 0 });
  const lastPlayerPosition = useRef<{ x: number; z: number; yaw: number; spaceId: string; at: number } | null>(null);

  useEffect(() => () => {
    // Leaving walk mode ends a walk chat as it stands (the panel's collapsed state is left as it is).
    const chat = useWalkChat.getState().session;
    endWalkChat();
    chat?.release();
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
    const w = window as unknown as Record<string, unknown>;
    w.__teleportWalk = teleport;
    // Read-only: where the walker stands (Playwright walk tests).
    w.__walkPos = () => ({ x: st.current.x, z: st.current.z, yaw: st.current.yaw });
    return () => {
      delete w.__teleportWalk;
      delete w.__walkPos;
    };
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
      // Clicking back into the view ends a walk chat (the chat column hides with the walk HUD again).
      if (st.current.locked) endWalkChat();
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
    // Esc while a walk chat is open closes the chat instead of leaving walk mode (capture phase).
    const uninstallChatEscape = installWalkChatEscape();
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement) || isTypingTarget(e.target instanceof Element ? e.target : null)) return;
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
      // C: chat. Never with a modifier (Ctrl/Cmd+C is copy), and not while an overlay has the mouse.
      if (isWalkChatKey(e)) st.current.chatPending = true;
      keys.current.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      uninstallChatEscape();
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

    // Screen-centre raycast: fire when a click, E, G, H or C press is pending.
    if (cur.clickPending || cur.bonkPending || cur.challengePending || cur.greetPending || cur.chatPending) {
      const intent: WalkIntent = cur.clickPending ? "click" : cur.bonkPending ? "bonk" : cur.challengePending ? "challenge" : cur.greetPending ? "greet" : "chat";
      cur.clickPending = false;
      cur.bonkPending = false;
      cur.challengePending = false;
      cur.greetPending = false;
      cur.chatPending = false;
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
      else if (action?.kind === "chat") openWalkChat(action.id);
      else if (action?.kind === "board") onBoard?.(action.id);
      else if (action?.kind === "challenge") window.dispatchEvent(new CustomEvent("agenticview:play-rps", { detail: { agentId: action.id } }));
      else if (action?.kind === "settings") {
        // Same pattern as opening an agent's chat: free the mouse before the modal grabs it.
        openOverlayFromWalk();
        window.dispatchEvent(new CustomEvent("agenticview:open-settings", { detail: { tab: action.id } }));
      }
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

export type WalkAction = { kind: "bonk" | "select" | "board" | "challenge" | "greet" | "settings" | "chat"; id: string };
/** What triggered the crosshair raycast: a click, E (bonk), G (challenge to rock-paper-scissors), H (say hi) or C (chat). */
export type WalkIntent = "click" | "bonk" | "challenge" | "greet" | "chat";
/** Walk mode: challenge an agent to RPS from this close (anywhere: desk, corridor, lounge). */
export const CHALLENGE_RANGE = 3;
/** Walk mode: C opens the chat of an agent under the crosshair this close (same targeting as E/H/G). */
export const CHAT_RANGE = 3;
/** The walk-mode key hint shown at the bottom of the view (App.tsx). */
export const WALK_HINT_KEYS = "E slap · H say hi · G play RPS · C chat · Esc exit";

/**
 * What a screen-centre click (or E press, `bonkOnly`) does, given the raycast hits (nearest first).
 * A robot within BONK_RANGE (horizontal, from the camera to the robot's origin) gets bonked; a
 * farther robot or a desk monitor selects its agent; a whiteboard opens its board; the My Office
 * wall screen opens Settings on the Connections tab.
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
        if (intent === "chat") return dist <= CHAT_RANGE ? { kind: "chat", id } : undefined;
        if (dist <= BONK_RANGE) return { kind: "bonk", id };
        return clickOnly ? undefined : { kind: "select", id };
      }
      if (ud?.agentId) return clickOnly ? undefined : { kind: "select", id: ud.agentId as string };
      if (ud?.boardSpaceId) return clickOnly ? undefined : { kind: "board", id: ud.boardSpaceId as string };
      // My Office wall screen (userData.wallScreenKind === "myoffice", tagged by the mesh Pixel
      // renders from screenWall()/WALL_SCREEN): opens Settings on the Connections tab. The Production
      // Room screen carries the same tag with kind "production" but has no click action yet.
      if (ud?.wallScreenKind === "myoffice") return clickOnly ? undefined : { kind: "settings", id: "connections" };
      obj = obj.parent;
    }
  }
  return undefined;
}
