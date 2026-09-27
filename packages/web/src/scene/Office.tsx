import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls, PerformanceMonitor, useCursor } from "@react-three/drei";
import * as THREE from "three";
import { HEX_R, managerHome, seatPose, spaceAt, yawToward, type Agent, type ServerMessage, type Space, type Task } from "@agenticview/shared";
import { useStore, sortedAgents, fileChipsFor, FILE_CHIP_MAX, type FeedItem, type FileChip } from "../state/store";
import { useLoungeBreaks, isFaintedCrash, limitWalk, limitWalkBubble } from "./breaks";
import { MeetingTV } from "./MeetingTV";
import { awaySeatSignature, layoutFor, seatKey, type OfficeLayout } from "./layout";
import { Robot, type RobotTarget } from "./Robot";
import { Beam } from "./Beam";
import { Confetti } from "./Confetti";
import { PlusIcon } from "../hud/ui";
import { Kit, buildWalls, furnishSpace, type Item } from "./kit";
import { Batches, useMaterials, type InstanceRegistry } from "./Batches";
import { chairField } from "./pushChairs";
import { PALETTES, carpetTexture, useSceneTheme, woodTexture, type Palette } from "./theme";
import { dragPoint, livePos, livePositions, useDrag, useFocus } from "./motion";
import { PodBoard } from "../hud/PodBoard";
import { BOARD_COLORS, podBoard } from "../state/boards";
import { keyToRoom } from "./roomKeys";

import { MiniMap } from "./MiniMap";
import { WalkMode } from "./WalkMode";
import { handState } from "./handGesture";
import { Whiteboard, whiteboardPose } from "./Whiteboard";
import { AllDeskMonitors } from "./DeskMonitor";
import { useWalk } from "../state/walk";
import { LoungeScoreboard } from "./LoungeScoreboard";
import { buildColliders } from "./colliders";
import { usePositions, type AgentActivity, type AgentPosition } from "../state/positions";
import { computeTargets, nextVisitExpiry } from "./targets";
import { ShadowScheduler, applyRenderTuning } from "./renderTuning";
import { ingestMessage } from "../net/ws";

const DEG = Math.PI / 180;

/** Chips naming the files an agent touched in the last few seconds, floating above it and fading out. */
const NO_CHIPS: FileChip[] = [];
const NO_CHIPS_FEED: FeedItem[] = [];

function sameChips(a: FileChip[], b: FileChip[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]!.path !== b[i]!.path || Math.abs(a[i]!.opacity - b[i]!.opacity) > 0.01) return false;
  return true;
}

/** Identity of the newest few file_changed events in a feed: changes only when a file event arrives. */
export function fileChipKey(feed: FeedItem[] | undefined): string {
  if (!feed) return "";
  let key = "";
  let n = 0;
  for (let i = feed.length - 1; i >= 0 && n < FILE_CHIP_MAX; i--) {
    const item = feed[i]!;
    if (!("event" in item) || item.event.type !== "file_changed") continue;
    key += `${item.ts}:${item.event.path}|`;
    n++;
  }
  return key;
}

function FileChips({ agentId }: { agentId: string }) {
  // Keyed on the file events only, so text/tool events streaming in do not re-render the chips.
  const fileKey = useStore((s) => fileChipKey(s.feed[agentId]));
  const feed = useMemo(() => useStore.getState().feed[agentId], [agentId, fileKey]);
  const [chips, setChips] = useState<FileChip[]>(NO_CHIPS);
  // Perf: the fade timer only runs while chips are showing, and an unchanged (empty) result keeps the
  // previous state. It used to tick every 250 ms for every worker forever with a fresh [] each time,
  // which was ~48 React commits/s in an idle 12-worker office.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      const next = fileChipsFor(feed ?? NO_CHIPS_FEED);
      setChips((prev) => (sameChips(prev, next) ? prev : next.length ? next : NO_CHIPS));
      if (!next.length && id !== undefined) {
        clearInterval(id);
        id = undefined;
      }
      return next.length > 0;
    };
    if (update()) id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [feed]);
  if (chips.length === 0) return null;
  return (
    <Html center position={[0, 2.45, 0]} distanceFactor={16} zIndexRange={[12, 0]} style={{ pointerEvents: "none" }}>
      <div className="file-chips">
        {chips.map((c) => (
          <span key={c.path} className="file-chip" style={{ opacity: c.opacity }} title={c.path}>
            ✎ {c.name}
          </span>
        ))}
      </div>
    </Html>
  );
}

// ---------- floors, labels, hover ----------

let slab: THREE.CylinderGeometry | undefined;
let outline: THREE.RingGeometry | undefined;
function floorGeometry() {
  slab ??= new THREE.CylinderGeometry(HEX_R - 0.02, HEX_R - 0.02, 0.12, 6, 1);
  outline ??= new THREE.RingGeometry(HEX_R - 0.32, HEX_R - 0.1, 6, 1);
  return { slab, outline };
}

function useFloorMaterials(p: Palette) {
  return useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({ color: p.floorEdge, roughness: 0.9 });
    const top = (map: THREE.Texture, roughness: number) => new THREE.MeshStandardMaterial({ map, roughness, color: "#ffffff" });
    return {
      office: [edge, top(woodTexture(p.walnut), 0.55), edge],
      pod: [edge, top(carpetTexture(p.carpetPod), 0.95), edge],
      meeting: [edge, top(carpetTexture(p.carpetMeeting), 0.95), edge],
      lounge: [edge, top(woodTexture(p.wood), 0.6), edge],
    } satisfies Record<Space["kind"], THREE.Material[]>;
  }, [p]);
}

const decalCache = new Map<string, THREE.CanvasTexture>();

function getDecalTexture(name: string, isDark: boolean): THREE.CanvasTexture {
  const key = `${name}::${isDark ? "dark" : "light"}`;
  let tex = decalCache.get(key);
  if (tex) return tex;

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(1024, 256)
      : typeof document !== "undefined"
        ? document.createElement("canvas")
        : null;

  if (!canvas) {
    tex = new THREE.CanvasTexture(new Image());
    decalCache.set(key, tex);
    return tex;
  }

  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (ctx) {
    ctx.clearRect(0, 0, 1024, 256);

    // Painted straight onto the floor like a stencil: big uppercase letters, no background plate,
    // a thin contrasting outline so the paint reads on carpet and wood alike.
    const label = name.toUpperCase();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let fontSize = 150;
    const setFont = () => (ctx.font = `800 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`);
    setFont();
    while (ctx.measureText(label).width > 980 && fontSize > 48) {
      fontSize -= 6;
      setFont();
    }
    if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = "6px";
    ctx.lineJoin = "round";
    ctx.lineWidth = 10;
    ctx.strokeStyle = isDark ? "rgba(0, 0, 0, 0.35)" : "rgba(255, 255, 255, 0.55)";
    ctx.strokeText(label, 512, 132);
    ctx.fillStyle = isDark ? "rgba(226, 236, 255, 0.78)" : "rgba(28, 38, 58, 0.72)";
    ctx.fillText(label, 512, 132);
  }

  tex = new THREE.CanvasTexture(canvas as any);
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  decalCache.set(key, tex);
  return tex;
}

const decalGeometry = new THREE.PlaneGeometry(4.6, 1.15);

function FloorDecal({
  space,
  isDark,
  isHovered,
  isFocused,
}: {
  space: Space;
  isDark: boolean;
  isHovered: boolean;
  isFocused: boolean;
}) {
  const setFocus = useFocus((s) => s.setFocus);
  const setHover = useFocus((s) => s.setHover);
  const texture = useMemo(() => getDecalTexture(space.name, isDark), [space.name, isDark]);

  const a = 45 * DEG;
  // In the open floor between the room's furniture and its front wall, toward the camera.
  const dist = space.kind === "office" ? 4.2 : space.kind === "meeting" ? 4.6 : 4.3;
  const x = space.x + dist * Math.cos(a);
  const z = space.z + dist * Math.sin(a);

  return (
    <mesh
      geometry={decalGeometry}
      position={[x, 0.006, z]}
      rotation={[-Math.PI / 2, 0, Math.PI / 4]}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (e.delta > 4) return;
        e.stopPropagation();
        useStore.getState().select(undefined);
        setFocus(isFocused ? undefined : space.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(space.id);
      }}
      onPointerOut={() => useFocus.getState().hoverSpace === space.id && setHover(undefined)}
    >
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        opacity={isFocused ? 1.0 : isHovered ? 0.95 : 0.82}
        toneMapped={false}
      />
    </mesh>
  );
}

function Floors({ spaces, palette, layout, managerName }: { spaces: Space[]; palette: Palette; layout: OfficeLayout; managerName?: string }) {
  const mats = useFloorMaterials(palette);
  const { slab, outline } = floorGeometry();
  const hover = useFocus((s) => s.hoverSpace);
  const focus = useFocus((s) => s.focus);
  const setHover = useFocus((s) => s.setHover);
  const setFocus = useFocus((s) => s.setFocus);
  const dropSpace = useDrag((s) => (s.active ? s.overSpace : undefined));
  const isDark = palette.bg === PALETTES.dark.bg;

  return (
    <group>
      {spaces.map((s) => {
        const lit = dropSpace ? dropSpace === s.id : hover === s.id || focus === s.id;
        const color = dropSpace === s.id ? (s.seats > 0 ? palette.dropOk : "#ef4444") : palette.hover;
        return (
          <group key={s.id}>
            <mesh
              geometry={slab}
              material={mats[s.kind]}
              position={[s.x, -0.06, s.z]}
              rotation={[0, Math.PI / 6, 0]}
              receiveShadow
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(s.id);
              }}
              onPointerOut={() => useFocus.getState().hoverSpace === s.id && setHover(undefined)}
              onClick={(e: ThreeEvent<MouseEvent>) => {
                if (e.delta > 4) return;
                e.stopPropagation();
                useStore.getState().select(undefined);
                setFocus(s.id);
              }}
            />
            {lit && (
              <mesh geometry={outline} position={[s.x, 0.02, s.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
                <meshBasicMaterial color={color} transparent opacity={dropSpace ? 0.9 : hover === s.id ? 0.75 : 0.4} toneMapped={false} />
              </mesh>
            )}
            <FloorDecal space={s} isDark={isDark} isHovered={hover === s.id} isFocused={focus === s.id} />
          </group>
        );
      })}
    </group>
  );
}

// ---------- furniture ----------

function Furniture({ spaces, layout, agents, palette, away = "" }: { spaces: Space[]; layout: OfficeLayout; agents: Record<string, Agent>; palette: Palette; away?: string }) {
  const materials = useMaterials(palette);
  // Only rebuild when the floor plan or who-sits-where changes, not on every stats update.
  const signature = useMemo(() => {
    const occ = [...layout.occupied.entries()].map(([k, id]) => `${k}=${agents[id]?.appearance.color ?? ""}`).sort();
    const manager = Object.values(agents).find((a) => a.role === "manager");
    return `${spaces.map((s) => s.id).join(",")}|${occ.join(",")}|m=${manager?.appearance.color ?? ""}|away=${away}`;
  }, [spaces, layout, agents, away]);
  const items = useMemo(() => {
    const kit = new Kit();
    const awayKeys = away ? away.split(",") : [];
    buildWalls(kit, spaces);
    const bg = new THREE.Color(palette.screenOff);
    for (const s of spaces) {
      const seats = new Map<number, string>();
      for (let seat = 0; seat < s.seats; seat++) {
        const id = layout.occupied.get(`${s.id}#${seat}`);
        const color = id ? agents[id]?.appearance.color : undefined;
        if (color) seats.set(seat, `#${new THREE.Color(color).lerp(bg, 0.25).getHexString()}`);
      }
      if (s.kind === "office") {
        const manager = Object.values(agents).find((a) => a.role === "manager");
        if (manager) seats.set(0, manager.appearance.color);
      }
      const awaySeats = new Set<number>();
      for (const key of awayKeys) if (key.startsWith(`${s.id}#`)) awaySeats.add(Number(key.slice(s.id.length + 1)));
      furnishSpace(kit, s, { seats, away: awaySeats });
    }
    // Screens without anyone at them are dark.
    for (const it of kit.items) if (it.mat === "screen" && !it.color) it.color = palette.screenOff;
    // Walk-mode chair pushing: chairs as drawn (a seated owner's chair is fixed; others pushable).
    chairField.sync(kit.chairs);
    return kit.items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, palette]);
  // Pushed chairs: move their instances in place (only chairs that changed; no allocations).
  const registry = useMemo<InstanceRegistry>(() => new Map(), []);
  useFrame(() => {
    // Pushed chairs left alone glide home (checked about once a second; advanced only while gliding).
    chairField.tick(performance.now());
    applyChairOffsets(items, registry);
  });
  return <Batches items={items} materials={materials} registry={registry} />;
}

const chairMatrix = new THREE.Matrix4();
const chairQuat = new THREE.Quaternion();
const chairEuler = new THREE.Euler();
const chairPos = new THREE.Vector3();
const chairScale = new THREE.Vector3();

/** Rewrite the instance matrices of chairs whose pushed pose changed since the last frame. */
function applyChairOffsets(items: Item[], registry: InstanceRegistry) {
  for (const c of chairField.chairs) {
    if (!c.dirty) continue;
    let done = true;
    // Drawn pose = base pose swivelled by spin about the seat centre, then moved to (x, z).
    const cs = Math.cos(c.spin);
    const sn = Math.sin(c.spin);
    for (let i = c.first; i < c.first + c.count; i++) {
      const it = items[i];
      const slot = registry.get(i);
      if (!it || !slot) {
        done = false;
        continue;
      }
      const lx = it.x - c.baseX;
      const lz = it.z - c.baseZ;
      chairEuler.set(it.rx, it.yaw + c.spin, it.rz, "YXZ");
      chairQuat.setFromEuler(chairEuler);
      chairMatrix.compose(chairPos.set(c.x + lx * cs + lz * sn, it.y, c.z - lx * sn + lz * cs), chairQuat, chairScale.set(it.sx, it.sy, it.sz));
      slot.mesh.setMatrixAt(slot.index, chairMatrix);
      slot.mesh.instanceMatrix.needsUpdate = true;
    }
    // Keep it dirty until the batches have registered (first frame after a rebuild).
    if (done) c.dirty = false;
  }
}


// ---------- lights and ground ----------

function Lights({ palette, spaces }: { palette: Palette; spaces: Space[] }) {
  const extent = Math.max(...spaces.map((s) => Math.hypot(s.x, s.z))) + HEX_R + 2;
  const sun = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    const cam = l.shadow.camera;
    cam.left = cam.bottom = -extent;
    cam.right = cam.top = extent;
    cam.near = 1;
    cam.far = 90;
    cam.updateProjectionMatrix();
  }, [extent]);
  return (
    <>
      <hemisphereLight args={[palette.sky, palette.groundLight, palette.hemi]} />
      <ambientLight intensity={palette.ambient} />
      <directionalLight
        ref={sun}
        castShadow
        position={[16, 30, 10]}
        intensity={palette.sunIntensity}
        color={palette.sun}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
      <directionalLight position={[-18, 14, -12]} intensity={palette.fillIntensity} color={palette.fill} />
      {palette.lamps > 0 &&
        spaces
          .filter((s) => s.ring <= 1)
          .map((s) => <pointLight key={s.id} position={[s.x, 3.4, s.z]} color={palette.lampGlow} intensity={24} distance={12} decay={1.6} />)}
    </>
  );
}

function Ground({ palette }: { palette: Palette }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.13, 0]} receiveShadow raycast={() => null}>
      <circleGeometry args={[140, 64]} />
      <meshStandardMaterial color={palette.ground} roughness={1} />
    </mesh>
  );
}

// ---------- new-agent pad ----------

function NewAgentPad({ at, onCreate }: { at: { x: number; z: number }; onCreate: () => void }) {
  const ring = useRef<THREE.Mesh>(null);
  // Like the name tags, the HTML button is an overview control: unmounted in walk mode (it filled the view up close).
  const walking = useWalk((s) => s.walking);
  useFrame(({ clock }) => {
    const m = ring.current;
    if (!m) return;
    const s = 1 + Math.sin(clock.getElapsedTime() * 2.4) * 0.06;
    m.scale.set(s, s, s);
  });
  return (
    <group position={[at.x, 0, at.z]}>
      <mesh ref={ring} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={(e) => (e.stopPropagation(), onCreate())}>
        <ringGeometry args={[0.5, 0.66, 40]} />
        <meshBasicMaterial color="#5b8cff" transparent opacity={0.6} toneMapped={false} />
      </mesh>
      {!walking && <Html center position={[0, 1.5, 0]} distanceFactor={14} zIndexRange={[15, 0]} style={{ pointerEvents: "none" }}>
        <button
          type="button"
          className="pad-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => (e.stopPropagation(), onCreate())}
          title="Hire a new agent for this desk"
        >
          <PlusIcon />
          <span>New agent</span>
        </button>
      </Html>}
    </group>
  );
}

// ---------- manager walks ----------

const VISIT_DWELL_MS = 2200;
const MAX_VISITS = 6;

/**
 * The manager walks over to a worker when it hands them a task and again when the task finishes,
 * lingers a moment, then goes to the next visit or back to its office.
 */
function useManagerVisits(tasks: Record<string, Task>, agents: Record<string, Agent>, managerId?: string) {
  const [queue, setQueue] = useState<string[]>([]);
  const seen = useRef(new Map<string, Task["status"]>());
  const dwelling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const add: string[] = [];
    for (const t of Object.values(tasks)) {
      const prev = seen.current.get(t.id);
      seen.current.set(t.id, t.status);
      if (t.kind !== "work" || !t.assigneeId || prev === t.status) continue;
      if (t.status === "assigned" || (prev !== undefined && (t.status === "done" || t.status === "failed"))) add.push(t.assigneeId);
    }
    if (add.length) setQueue((q) => [...q, ...add].filter((id, i, all) => i === 0 || all[i - 1] !== id).slice(-MAX_VISITS));
  }, [tasks]);

  // Drop visits to agents that no longer exist.
  const current = queue.find((id) => agents[id]);
  useEffect(() => {
    if (queue.length && queue[0] !== current) setQueue((q) => q.filter((id) => agents[id]));
  }, [queue, current, agents]);

  useEffect(() => () => clearTimeout(dwelling.current), []);

  const onArrive = useCallback(
    (id: string) => {
      if (id !== managerId || !current || dwelling.current) return;
      dwelling.current = setTimeout(() => {
        dwelling.current = undefined;
        setQueue((q) => q.slice(1));
      }, VISIT_DWELL_MS);
    },
    [managerId, current],
  );
  return { visiting: current, onArrive };
}

// ---------- drag to reassign ----------

function nearestSeat(space: Space, p: { x: number; z: number }): number {
  let best = 0;
  let bestD = Infinity;
  for (let seat = 0; seat < space.seats; seat++) {
    const s = seatPose(space, seat);
    const d = Math.hypot(s.x - p.x, s.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = seat;
    }
  }
  return best;
}

function useDragToReassign(layout: OfficeLayout) {
  const { camera, gl } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const latest = useRef(layout);
  latest.current = layout;

  return useCallback(
    (id: string, e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (controls) controls.enabled = false;
      const sx = e.nativeEvent.clientX;
      const sy = e.nativeEvent.clientY;
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      useDrag.getState().set({ heldId: id, active: false });
      document.body.style.cursor = "grabbing";

      const move = (ev: PointerEvent) => {
        const st = useDrag.getState();
        if (!st.active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        const rect = gl.domElement.getBoundingClientRect();
        ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        if (!ray.ray.intersectPlane(plane, hit)) return;
        dragPoint.x = hit.x;
        dragPoint.z = hit.z;
        const space = spaceAt(latest.current.spaces, hit.x, hit.z);
        const seat = space && space.seats > 0 ? nearestSeat(space, hit) : undefined;
        if (!st.active || st.overSpace !== space?.id || st.overSeat !== seat) st.set({ active: true, overSpace: space?.id, overSeat: seat });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (controls) controls.enabled = true;
        document.body.style.cursor = "";
        const st = useDrag.getState();
        if (st.active && st.overSpace && st.overSeat !== undefined) {
          const l = latest.current;
          const dest = { space: st.overSpace, seat: st.overSeat };
          const from = l.placements[id];
          if (!from || seatKey(from) !== seatKey(dest)) {
            const send = useStore.getState().send;
            const other = l.occupied.get(seatKey(dest));
            send({ type: "agent.update", id, patch: { placement: dest } });
            if (other && other !== id && from) send({ type: "agent.update", id: other, patch: { placement: from } });
          }
        }
        st.set({ heldId: undefined, active: false, overSpace: undefined, overSeat: undefined, droppedAt: st.active ? Date.now() : st.droppedAt });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [camera, gl, controls],
  );
}

/** Ghost chair marker where a dragged robot would land. */
function DropMarker({ spaces }: { spaces: Space[] }) {
  const over = useDrag((s) => (s.active && s.overSpace && s.overSeat !== undefined ? `${s.overSpace}#${s.overSeat}` : undefined));
  if (!over) return null;
  const [id, seat] = over.split("#") as [string, string];
  const space = spaces.find((s) => s.id === id);
  if (!space) return null;
  const p = seatPose(space, Number(seat));
  return (
    <mesh position={[p.x, 0.04, p.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <ringGeometry args={[0.5, 0.72, 40]} />
      <meshBasicMaterial color="#ffc14d" transparent opacity={0.85} toneMapped={false} />
    </mesh>
  );
}

// ---------- camera ----------

function overviewDistance(spaces: Space[]): number {
  const extent = Math.max(...spaces.map((s) => Math.hypot(s.x, s.z))) + HEX_R;
  return extent * 2.5 + 6;
}

function CameraRig({ spaces }: { spaces: Space[] }) {
  const focus = useFocus((s) => s.focus);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as (THREE.EventDispatcher<{ start: object }> & { target: THREE.Vector3; update(): void }) | null;
  const goal = useRef<{ target: THREE.Vector3; pos: THREE.Vector3 } | null>(null);
  const rings = Math.max(...spaces.map((s) => s.ring));

  useEffect(() => {
    if (!controls) return;
    const space = focus ? spaces.find((s) => s.id === focus) : undefined;
    const target = space ? new THREE.Vector3(space.x, 0.5, space.z) : new THREE.Vector3(1.2, 0, 1.2);
    const az = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    const polar = space ? 0.82 : 0.78;
    const dist = space ? 25 : overviewDistance(spaces);
    const pos = new THREE.Vector3(target.x + dist * Math.sin(polar) * Math.sin(az), dist * Math.cos(polar), target.z + dist * Math.sin(polar) * Math.cos(az));
    goal.current = { target, pos };
    // Rings change the overview distance; a focus change moves there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, rings, controls]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => (goal.current = null);
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-dt * 4.5);
    controls.target.lerp(g.target, k);
    camera.position.lerp(g.pos, k);
    controls.update();
    if (camera.position.distanceTo(g.pos) < 0.02 && controls.target.distanceTo(g.target) < 0.02) goal.current = null;
  });
  return null;
}

// ---------- RPS animation overlay ----------

const MOVE_EMOJI: Record<string, string> = { rock: "✊", paper: "✋", scissors: "✌" };

/**
 * Shows a ~3 s HTML badge over each player when a game.result arrives.
 * Accepts the current `at` resolver so it can read live robot positions.
 */
function RpsAnimation({ at, agents }: { at: (id: string) => { x: number; z: number } | undefined; agents: Record<string, Agent> }) {
  const gameAnimation = useStore((s) => s.gameAnimation);
  const [current, setCurrent] = useState<typeof gameAnimation>(undefined);

  useEffect(() => {
    if (!gameAnimation) return;
    setCurrent(gameAnimation);
    const tid = setTimeout(() => setCurrent(undefined), 3000);
    return () => clearTimeout(tid);
  }, [gameAnimation]);

  if (!current) return null;
  const { match } = current;

  return (
    <>
      {(match.players as [string, string]).map((playerId, idx) => {
        const pos = at(playerId) ?? (agents[playerId] ? undefined : undefined);
        if (!pos) return null;
        const move = match.moves[idx]!;
        const isWinner = match.winner === playerId;
        const isDraw = match.winner === null;
        return (
          <group key={playerId} position={[pos.x, 0, pos.z]}>
            <Html center position={[0, 2.8, 0]} distanceFactor={14} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
              <div className={`rps-badge${isWinner ? " rps-winner" : isDraw ? " rps-draw" : ""}`}>
                <span className="rps-move">{MOVE_EMOJI[move] ?? "?"}</span>
                {isWinner && <span className="rps-label">WIN</span>}
                {isDraw && <span className="rps-label">DRAW</span>}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

// ---------- scene ----------

const YOU: Agent = {
  id: "you",
  name: "You",
  role: "worker",
  scope: "project",
  specialty: "Your Claude Code session",
  description: "",
  provider: "claude",
  model: null,
  systemPrompt: "",
  tools: { edit: true, shell: true, web: true, screenshot: false },
  permissionMode: "ask",
  appearance: { color: "#e6e8f0", accent: "#ffd166", eyes: "dots" },
  stats: { xp: 0, level: 1, tasksDone: 0, tasksFailed: 0 },
  createdAt: "",
  updatedAt: "",
};

const FRESH_MS = 10_000;

/**
 * The shadow map is re-rendered every frame only while a robot moves (plus a short grace period);
 * otherwise at 5 Hz. `signature` pokes a refresh when furniture or the theme changes.
 */
function ShadowThrottle({ signature }: { signature: string }) {
  const gl = useThree((s) => s.gl);
  const sched = useMemo(() => new ShadowScheduler(), []);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => { gl.shadowMap.autoUpdate = true; };
  }, [gl]);
  useEffect(() => sched.poke(), [sched, signature]);
  useFrame(() => {
    const chairsMoving = performance.now() - chairField.lastMove < 100;
    if (sched.tick(Date.now(), livePositions, useDrag.getState().active || chairsMoving)) gl.shadowMap.needsUpdate = true;
  });
  return null;
}

/** Test probe: renderer and scene for Playwright perf / screenshot specs (read-only use). */
function GlProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__agenticviewTest = Object.assign((w.__agenticviewTest as object | undefined) ?? {}, { gl, scene });
  }, [gl, scene]);
  return null;
}

function Scene({ onCreate, palette, onBoard }: { onCreate: () => void; palette: Palette; onBoard: (space: Space) => void }) {
  const walking = useWalk((s) => s.walking);
  const walkExitAt = useWalk((s) => s.exitAt);
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const beams = useStore((s) => s.beams);
  const celebrations = useStore((s) => s.celebrations);
  const mirrorLatest = useStore((s) => s.mirror[0]);
  const spaceNames = useStore((s) => s.spaceNames);
  const settings = useStore((s) => s.settings);
  const gameAnimation = useStore((s) => s.gameAnimation);
  const activeRpsMatch = useStore((s) => s.activeRpsMatch);
  const list = useMemo(() => sortedAgents(agents), [agents]);
  const layout = useMemo(() => layoutFor(list, spaceNames), [list, spaceNames]);
  const { spaces } = layout;
  const office = spaces[0]!;
  const manager = list.find((a) => a.role === "manager");
  const loungeEnabled = (settings as { loungeBreaks?: boolean } | undefined)?.loungeBreaks ?? true;
  const loungeBreaks = useLoungeBreaks(agents, tasks, loungeEnabled);
  const lounge = spaces.find((s) => s.kind === "lounge");
  const { visiting, onArrive } = useManagerVisits(tasks, agents, manager?.id);
  const onGrab = useDragToReassign(layout);
  const mountedAt = useRef(Date.now());
  const prevLoungeAssign = useRef<Record<string, string>>({});
  const lastPublishRef = useRef(0);

  // Re-evaluate targets when the earliest idle visit lapses (the server also clears it; this covers a slow link).
  const [visitClock, setVisitClock] = useState(0);
  useEffect(() => {
    const at = nextVisitExpiry(list, Date.now());
    if (at === undefined) return;
    const t = setTimeout(() => setVisitClock((n) => n + 1), Math.min(at - Date.now() + 50, 600_000));
    return () => clearTimeout(t);
  }, [list, visitClock]);

  const targets = useMemo(() => {
    const r = computeTargets({
      layout, list, lounge, loungeBreaks, prevLoungeAssign: prevLoungeAssign.current,
      managerId: manager?.id, managerVisit: visiting, activeRpsMatch, gameAnimation, now: Date.now(),
    });
    prevLoungeAssign.current = r.loungeAssign;
    return r.targets as Record<string, RobotTarget>;
    // visitClock: re-run when a visit expires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, manager, visiting, loungeBreaks, lounge, list, gameAnimation, activeRpsMatch, visitClock]);
  // Owners who stepped away leave their chair swivelled (plain string so furniture only rebuilds on change).
  // Target-based part updates immediately; the 4 Hz publisher below adds owners still walking back.
  const [liveAway, setLiveAway] = useState("");
  const awaySeats = useMemo(() => {
    const fromTargets = awaySeatSignature(layout, targets);
    if (!liveAway) return fromTargets;
    const merged = new Set(fromTargets ? fromTargets.split(",") : []);
    for (const k of liveAway.split(",")) merged.add(k);
    return [...merged].sort().join(",");
  }, [layout, targets, liveAway]);

  const youPose = useMemo(() => {
    const a = 45 * DEG;
    const p = { x: office.x + 2.25 * Math.cos(a), z: office.z + 2.25 * Math.sin(a) };
    return { ...p, yaw: yawToward(p, managerHome(office)) };
  }, [office]);

  // Desk monitor positions: one per seated worker in pod spaces.
  const deskMonitors = useMemo(() => {
    const out: { agentId: string; spaceX: number; spaceZ: number; seat: number }[] = [];
    for (const [key, agentId] of layout.occupied.entries()) {
      const [spaceId, seatStr] = key.split("#") as [string, string];
      const s = spaces.find((sp) => sp.id === spaceId);
      if (!s || s.kind !== "pod") continue;
      out.push({ agentId, spaceX: s.x, spaceZ: s.z, seat: parseInt(seatStr, 10) });
    }
    return out;
  }, [layout.occupied, spaces]);

  // Office chairs are dynamic (pushChairs.ts: drawn pose, pushable or fixed); everything else is static.
  const colliders = useMemo(() => buildColliders(layout, { excludeKinds: ["chair"] }), [layout]);
  const nextPose = layout.next && spaces.find((s) => s.id === layout.next!.space) ? seatPose(spaces.find((s) => s.id === layout.next!.space)!, layout.next.seat) : undefined;
  const at = (id: string) => livePos(id, targets[id]);

  // Throttled position publisher: push to usePositions ~4 times per second, only on change.
  // Reads livePositions (updated by Robot.tsx every frame) and augments with activity/spaceId.
  // Perf: compares against the last published map field by field (was JSON.stringify of the whole
  // snapshot every 250 ms) and reuses the previous entry object when nothing moved, so the MiniMap
  // (the only subscriber) re-renders only when a robot actually moved or changed activity.
  const layoutRef = useRef(layout);
  const listRef = useRef(list);
  const targetsRef = useRef(targets);
  const loungeBreaksRef = useRef(loungeBreaks);
  const liveAwayRef = useRef("");
  layoutRef.current = layout;
  listRef.current = list;
  targetsRef.current = targets;
  loungeBreaksRef.current = loungeBreaks;

  useFrame(() => {
    const now = Date.now();
    if (now - lastPublishRef.current < 250) return; // ~4 Hz
    lastPublishRef.current = now;

    const curLayout = layoutRef.current;
    const curSpaces = curLayout.spaces;
    const curList = listRef.current;
    const curLoungeBreaks = loungeBreaksRef.current;
    const curTargets = targetsRef.current;
    const prev = usePositions.getState().byAgent;
    const loungeSpace = curSpaces.find((s) => s.kind === "lounge");

    let changed = false;
    let count = 0;
    const result: Record<string, AgentPosition> = {};
    for (const a of curList) {
      const target = curTargets[a.id];
      if (!target) continue;
      const lp = livePositions.get(a.id);
      const x = lp?.x ?? target.x;
      const z = lp?.z ?? target.z;
      const limitW = limitWalk(a);
      const fainted = isFaintedCrash(a);
      // Reporting a provider limit at the Manager's desk (or standing there while it is decided).
      const reporting = Boolean(limitW && limitW.phase !== "switching");
      const inLounge = curLoungeBreaks.has(a.id) || (a.lounging === true && a.role === "worker") || fainted;

      // Activity from the live path and current room, with lounge/faint state taking precedence.
      const liveSpace = spaceAt(curSpaces, x, z) ?? spaceAt(curSpaces, target.x, target.z);
      let activity: AgentActivity;
      if (inLounge) {
        if (fainted) activity = "fainted";
        else if (lp?.walking) activity = "walking";
        else if (curLoungeBreaks.has(a.id)) activity = "break";
        else if (liveSpace?.kind !== "lounge") activity = "waiting";
        else activity = "lounge";
      } else if (lp?.walking) activity = "walking";
      else if (liveSpace?.kind === "meeting") activity = "meeting";
      else if (lp?.waiting || reporting) activity = "waiting";
      else activity = "desk";

      const placement = curLayout.placements[a.id];
      const spaceId = liveSpace?.id ?? (inLounge ? loungeSpace?.id : placement?.space) ?? curSpaces[0]!.id;
      const old = prev[a.id];
      // Round to cm: sub-cm drift is invisible on a 180 px map and would defeat the change check.
      const rx = Math.round(x * 100) / 100;
      const rz = Math.round(z * 100) / 100;
      if (old && old.x === rx && old.z === rz && old.spaceId === spaceId && old.activity === activity) result[a.id] = old;
      else { result[a.id] = { x: rx, z: rz, spaceId, activity }; changed = true; }
      count++;
    }
    if (!changed) for (const id in prev) if (!(id in result)) { changed = true; break; }
    if (changed || count !== Object.keys(prev).length) usePositions.getState().set(result);

    // Chairs of owners still walking back to their seat stay swivelled until they sit down.
    const away = awaySeatSignature(curLayout, curTargets, livePositions);
    if (away !== liveAwayRef.current) {
      liveAwayRef.current = away;
      setLiveAway(away);
    }
  });

  return (
    <>
      <color attach="background" args={[palette.bg]} />
      <fog attach="fog" args={[palette.bg, palette.fog[0], palette.fog[1]]} />
      <Lights palette={palette} spaces={spaces} />
      <ShadowThrottle signature={`${palette.bg}|${spaces.length}|${awaySeats}|${list.length}`} />
      <Ground palette={palette} />
      <Floors spaces={spaces} palette={palette} layout={layout} managerName={manager?.name} />
      <Furniture spaces={spaces} layout={layout} agents={agents} palette={palette} away={awaySeats} />
      {spaces.filter(s => s.kind !== "lounge").map(s => <Whiteboard key={s.id} space={s} onOpen={onBoard} />)}
      {spaces.filter(s => s.kind === "meeting").map(s => <MeetingTV key={`tv-${s.id}`} space={s} />)}
      <DropMarker spaces={spaces} />

      {list.map((a) => {
        const target = targets[a.id];
        if (!target) return null;
        const fresh = a.role === "worker" && Date.parse(a.createdAt) > mountedAt.current - FRESH_MS;
        const home = managerHome(office);
        const limitW = limitWalk(a);
        const isFainted = isFaintedCrash(a);
        const isLounging = a.lounging === true && a.role === "worker";
        return (
          <Robot
            key={a.id}
            agent={a}
            target={target}
            spaces={spaces}
            spawnAt={fresh ? { x: home.x + 1.6, z: home.z + 1.6 } : undefined}
            onArrive={a.role === "manager" ? onArrive : undefined}
            onGrab={a.role === "worker" && !isFainted ? onGrab : undefined}
            onBodyClick={isLounging ? (agentId) => window.dispatchEvent(new CustomEvent("agenticview:play-rps", { detail: { agentId } })) : undefined}
            fainted={isFainted}
            statusBubble={limitW ? limitWalkBubble(limitW) : undefined}
          >
            {a.role === "worker" && !walking && <FileChips agentId={a.id} />}
          </Robot>
        );
      })}

      {/* 'You': hidden while walking (the camera is you); on exit it remounts at the exit spot and walks home. */}
      {!walking && (mirrorLatest || walkExitAt) && <Robot key={walkExitAt ? `you-${walkExitAt.at}` : "you"} agent={YOU} target={youPose} spaces={spaces}
        spawnAt={walkExitAt && Date.now() - walkExitAt.at < 2000 ? walkExitAt : undefined}
        bubbleOverride={mirrorLatest?.text.slice(0, 90)} />}

      {nextPose && <NewAgentPad at={nextPose} onCreate={onCreate} />}

      {beams.map((b) => {
        const from = at(b.from);
        const to = at(b.to);
        if (!from || !to) return null;
        return <Beam key={b.id} from={[from.x, 1.5, from.z]} to={[to.x, 1.5, to.z]} />;
      })}

      {celebrations.map((c, i) => {
        const p = at(c.agentId);
        if (!p) return null;
        return <Confetti key={`${c.agentId}-${c.until}-${i}`} origin={[p.x, 0, p.z]} until={c.until} />;
      })}

      <AllDeskMonitors desks={deskMonitors} />

      {lounge && <LoungeScoreboard lounge={lounge} />}
      <RpsAnimation at={at} agents={agents} />

      <WalkMode spaces={spaces} startX={youPose.x} startZ={youPose.z} solids={colliders}
        onBoard={(id) => { const s = spaces.find((sp) => sp.id === id); if (s) onBoard(s); }}
      />

      <OrbitControls
        makeDefault
        enabled={!walking}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={0.35}
        maxPolarAngle={1.22}
        minDistance={6}
        maxDistance={80}
        target={[1.2, 0, 1.2]}
        enablePan
        panSpeed={0.7}
        screenSpacePanning={false}
      />
      {!walking && <CameraRig spaces={spaces} />}
    </>
  );
}

export function Office({ onCreate }: { onCreate: () => void }) {
  const [boardSpace, setBoardSpace] = useState<Space>();
  const [dpr, setDpr] = useState(1.5);
  const closeBoard = useCallback(() => setBoardSpace(undefined), []);
  const select = useStore((s) => s.select);
  const focus = useFocus((s) => s.focus);
  const setFocus = useFocus((s) => s.setFocus);
  const setWalking = useWalk((s) => s.setWalking);
  const theme = useSceneTheme();
  const palette = PALETTES[theme];

  // Expose walk toggle on window for Playwright tests / TopBar
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__setWalking = setWalking;
    return () => { delete (window as unknown as Record<string, unknown>).__setWalking; };
  }, [setWalking]);

  // Read-only probes for Playwright screenshot specs (store, live robot positions, board poses).
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__agenticviewTest = Object.assign((w.__agenticviewTest as object | undefined) ?? {}, {
      store: useStore,
      inject: (msg: ServerMessage) => ingestMessage(useStore, msg),
      agentPos: (id: string) => livePositions.get(id),
      hand: handState,
      chairs: () => chairField.chairs.map((c) => ({ id: c.id, x: c.x, z: c.z, baseX: c.baseX, baseZ: c.baseZ, yaw: c.yaw, spin: c.spin, pushable: c.pushable, touchedAt: c.touchedAt, gliding: !Number.isNaN(c.glideT0) })),
      chairField,
      spaces: () => {
        const state = useStore.getState();
        return layoutFor(Object.values(state.agents), state.spaceNames).spaces.map((s) => ({ id: s.id, kind: s.kind, x: s.x, z: s.z }));
      },
      boardPose: (spaceId: string) => {
        const state = useStore.getState();
        const space = layoutFor(Object.values(state.agents), state.spaceNames).spaces.find((s) => s.id === spaceId);
        return space ? whiteboardPose(space) : undefined;
      },
    });
    return () => { delete (window as unknown as Record<string, unknown>).__agenticviewTest; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in a text field.
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      // Ignore when a modal dialog is open.
      if (document.querySelector('[role="dialog"]')) return;

      if (e.key === "Escape") {
        // Exit walk mode first, then clear focus.
        if (useWalk.getState().walking) { setWalking(false); return; }
        setFocus(undefined);
        return;
      }

      // 1–9: focus the nth room in viewOrder (overview mode only).
      if (!useWalk.getState().walking && e.key >= "1" && e.key <= "9" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const state = useStore.getState();
        const list = sortedAgents(state.agents);
        const { spaces } = layoutFor(list, state.spaceNames);
        const id = keyToRoom(e.key, spaces);
        if (id) setFocus(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFocus, setWalking]);

  return (
    <div className="office" data-scene-theme={theme}>
      <Canvas
        dpr={dpr}
        camera={{ position: [30, 36, 30], fov: 38, near: 0.5, far: 220 }}
        shadows
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => applyRenderTuning(gl)}
        onPointerMissed={() => {
          select(undefined);
          useFocus.getState().setHover(undefined);
        }}
      >
        {/* Adaptive resolution: render at 1.5x normally, step down toward 1x when the GPU can't keep
            up and back up to 1.75x when it's coasting. Cheaper than any per-object tuning. */}
        <PerformanceMonitor
          onIncline={() => setDpr((d) => Math.min(1.75, d + 0.25))}
          onDecline={() => setDpr((d) => Math.max(1, d - 0.25))}
          flipflops={4}
          onFallback={() => setDpr(1)}
        />
        <GlProbe />
        <Suspense fallback={null}>
          <Scene onCreate={onCreate} palette={palette} onBoard={setBoardSpace} />
        </Suspense>
      </Canvas>
      <MiniMap />
      {boardSpace && <PodBoard space={boardSpace} onClose={closeBoard} />}
      {focus && (
        <button type="button" className="overview-btn" onClick={() => setFocus(undefined)} title="Back to the whole floor (Esc)">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
            <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
          Whole floor
        </button>
      )}
    </div>
  );
}
