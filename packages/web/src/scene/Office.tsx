import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls, PerformanceMonitor, useCursor } from "@react-three/drei";
import * as THREE from "three";
import { HEX_R, managerHome, seatPose, spaceAt, visitPose, yawToward, loungeSpots, assignLoungeSpots, rpsFacing, type Agent, type Space, type Task } from "@agenticview/shared";
import { useStore, sortedAgents, fileChipsFor, type FileChip } from "../state/store";
import { useLoungeBreaks, agentRevivePhase } from "./breaks";
import { MeetingTV } from "./MeetingTV";
import { layoutFor, seatKey, type OfficeLayout } from "./layout";
import { Robot, type RobotTarget } from "./Robot";
import { Beam } from "./Beam";
import { Confetti } from "./Confetti";
import { PlusIcon } from "../hud/ui";
import { Kit, buildWalls, furnishSpace } from "./kit";
import { Batches, useMaterials } from "./Batches";
import { PALETTES, carpetTexture, useSceneTheme, woodTexture, type Palette } from "./theme";
import { dragPoint, livePos, livePositions, useDrag, useFocus } from "./motion";
import { PodBoard } from "../hud/PodBoard";
import { BOARD_COLORS, podBoard } from "../state/boards";
import { keyToRoom } from "./roomKeys";

import { MiniMap } from "./MiniMap";
import { WalkMode } from "./WalkMode";
import { Whiteboard } from "./Whiteboard";
import { AllDeskMonitors } from "./DeskMonitor";
import { useWalk } from "../state/walk";
import { LoungeScoreboard } from "./LoungeScoreboard";
import { buildColliders } from "./colliders";
import { usePositions, type AgentActivity } from "../state/positions";

const DEG = Math.PI / 180;

/** Chips naming the files an agent touched in the last few seconds, floating above it and fading out. */
function FileChips({ agentId }: { agentId: string }) {
  const feed = useStore((s) => s.feed[agentId]);
  const [chips, setChips] = useState<FileChip[]>([]);
  useEffect(() => {
    const update = () => setChips(fileChipsFor(feed ?? []));
    update();
    const id = setInterval(update, 250);
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

function Furniture({ spaces, layout, agents, palette }: { spaces: Space[]; layout: OfficeLayout; agents: Record<string, Agent>; palette: Palette }) {
  const materials = useMaterials(palette);
  // Only rebuild when the floor plan or who-sits-where changes, not on every stats update.
  const signature = useMemo(() => {
    const occ = [...layout.occupied.entries()].map(([k, id]) => `${k}=${agents[id]?.appearance.color ?? ""}`).sort();
    return `${spaces.map((s) => s.id).join(",")}|${occ.join(",")}`;
  }, [spaces, layout, agents]);
  const items = useMemo(() => {
    const kit = new Kit();
    buildWalls(kit, spaces);
    const bg = new THREE.Color(palette.screenOff);
    for (const s of spaces) {
      const seats = new Map<number, string>();
      for (let seat = 0; seat < s.seats; seat++) {
        const id = layout.occupied.get(`${s.id}#${seat}`);
        const color = id ? agents[id]?.appearance.color : undefined;
        if (color) seats.set(seat, `#${new THREE.Color(color).lerp(bg, 0.25).getHexString()}`);
      }
      furnishSpace(kit, s, { seats });
    }
    // Screens without anyone at them are dark.
    for (const it of kit.items) if (it.mat === "screen" && !it.color) it.color = palette.screenOff;
    return kit.items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, palette]);
  return <Batches items={items} materials={materials} />;
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
      <Html center position={[0, 1.5, 0]} distanceFactor={14} zIndexRange={[15, 0]} style={{ pointerEvents: "none" }}>
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
      </Html>
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
  const lastSnapshotRef = useRef<string>("");

  const targets = useMemo(() => {
    const out: Record<string, RobotTarget> = {};
    for (const [id, pose] of Object.entries(layout.poses)) out[id] = pose;

    // Lounge: collect all agents going to the lounge, assign spots via loungeSpots().
    if (lounge) {
      // Build the full list of agents heading to the lounge (breaks, server-side lounging, fainted).
      const loungeAgentIds: string[] = [];
      for (const [id] of loungeBreaks) loungeAgentIds.push(id);
      for (const a of list) {
        if (loungeBreaks.has(a.id)) continue; // already included above
        if (a.lounging && a.role === "worker") { loungeAgentIds.push(a.id); continue; }
        const phase = agentRevivePhase(a);
        if (phase === "fainted" || phase === "reviving") loungeAgentIds.push(a.id);
      }

      if (loungeAgentIds.length > 0) {
        // Get a layout large enough for overflow agents (waiting spots outside door).
        const loungeLayout = loungeSpots(Math.max(16, loungeAgentIds.length + 2));
        // Stable assignment: agents keep their spot unless it's gone.
        const assignment = assignLoungeSpots(loungeAgentIds, loungeLayout.spots, prevLoungeAssign.current);
        prevLoungeAssign.current = assignment;

        for (const agentId of loungeAgentIds) {
          const spotId = assignment[agentId];
          if (!spotId) continue;
          const spot = loungeLayout.spots.find((sp) => sp.id === spotId);
          if (!spot) continue;
          out[agentId] = {
            x: lounge.x + spot.x,
            z: lounge.z + spot.z,
            yaw: spot.yaw,
            yOffset: spot.seatHeight,
          };
        }
      }
    }

    // Manager walks to fainted agent when phase is 'reviving'
    if (manager && lounge) {
      const faintingAgent = list.find((a) => agentRevivePhase(a) === "reviving");
      if (faintingAgent && !visiting) {
        const agentPos = out[faintingAgent.id];
        if (agentPos) {
          const visitP = { x: agentPos.x + 0.6, z: agentPos.z };
          out[manager.id] = { ...visitP, yaw: yawToward(visitP, agentPos) };
        }
      }
    }

    // Manager task visits (existing logic; overrides the faint walk when visiting is set)
    if (manager && visiting) {
      const p = layout.placements[visiting];
      const s = p && spaces.find((o) => o.id === p.space);
      if (s && p) out[manager.id] = visitPose(s, p.seat);
    }

    // RPS game.started: walk both players to the designated game spots and face each other.
    // This overrides their lounge seat assignment while the match is active.
    if (activeRpsMatch && lounge) {
      const gameLayout = loungeSpots();
      for (let i = 0; i < 2; i++) {
        const playerId = activeRpsMatch.players[i]!;
        const spotId = activeRpsMatch.spotIds[i]!;
        // Search all game spot pairs for the matching id
        for (const [gsa, gsb] of gameLayout.gameSpots) {
          const gs = gsa.id === spotId ? gsa : gsb.id === spotId ? gsb : null;
          if (gs) {
            out[playerId] = {
              x: lounge.x + gs.x,
              z: lounge.z + gs.z,
              yaw: gs.yaw,
              yOffset: 0,
            };
            break;
          }
        }
      }
    }

    // RPS game.result: after the match ends, make both players face each other for the badge (~3 s).
    if (gameAnimation && Date.now() - gameAnimation.at < 3000) {
      const [playerA, playerB] = gameAnimation.match.players;
      const posA = out[playerA];
      const posB = out[playerB];
      if (posA && posB) {
        const { yawA, yawB } = rpsFacing(posA, posB);
        out[playerA] = { ...posA, yaw: yawA };
        out[playerB] = { ...posB, yaw: yawB };
      }
    }

    return out;
  }, [layout, manager, visiting, spaces, loungeBreaks, lounge, list, gameAnimation, activeRpsMatch]);

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

  const colliders = useMemo(() => buildColliders(layout), [layout]);
  const nextPose = layout.next && spaces.find((s) => s.id === layout.next!.space) ? seatPose(spaces.find((s) => s.id === layout.next!.space)!, layout.next.seat) : undefined;
  const at = (id: string) => livePos(id, targets[id]);

  // Throttled position publisher: push to usePositions ~4 times per second, only on change.
  // Reads livePositions (updated by Robot.tsx every frame) and augments with activity/spaceId.
  const layoutRef = useRef(layout);
  const spacesRef = useRef(spaces);
  const listRef = useRef(list);
  const targetsRef = useRef(targets);
  const loungeBreaksRef = useRef(loungeBreaks);
  layoutRef.current = layout;
  spacesRef.current = spaces;
  listRef.current = list;
  targetsRef.current = targets;
  loungeBreaksRef.current = loungeBreaks;

  useFrame(({ clock: _clock }) => {
    const now = Date.now();
    if (now - lastPublishRef.current < 250) return; // ~4 Hz
    lastPublishRef.current = now;

    const curLayout = layoutRef.current;
    const curSpaces = spacesRef.current;
    const curList = listRef.current;
    const curLoungeBreaks = loungeBreaksRef.current;
    const curTargets = targetsRef.current;

    // Build a lounge agent set for fast lookup.
    const loungeAgentSet = new Set<string>();
    for (const [id] of curLoungeBreaks) loungeAgentSet.add(id);
    for (const a of curList) {
      if (a.lounging && a.role === "worker") loungeAgentSet.add(a.id);
      const phase = agentRevivePhase(a);
      if (phase === "fainted" || phase === "reviving") loungeAgentSet.add(a.id);
    }

    // Determine waiting agents (those assigned to lounge overflow spots).
    const loungeSpace = curSpaces.find((s) => s.kind === "lounge");

    const result: Record<string, import("../state/positions").AgentPosition> = {};
    for (const a of curList) {
      const target = curTargets[a.id];
      if (!target) continue;
      const lp = livePositions.get(a.id);
      const x = lp?.x ?? target.x;
      const z = lp?.z ?? target.z;

      // Determine activity from the live path and current room, with lounge/faint state taking precedence.
      const liveSpace = spaceAt(curSpaces, x, z) ?? spaceAt(curSpaces, target.x, target.z);
      let activity: AgentActivity;
      if (loungeAgentSet.has(a.id)) {
        const phase = agentRevivePhase(a);
        if (phase === "fainted" || phase === "reviving") {
          activity = "fainted";
        } else if (lp?.walking) {
          activity = "walking";
        } else if (curLoungeBreaks.has(a.id)) {
          activity = "break";
        } else if (liveSpace?.kind !== "lounge") {
          activity = "waiting";
        } else {
          activity = "lounge";
        }
      } else {
        if (lp?.walking) activity = "walking";
        else if (liveSpace?.kind === "meeting") activity = "meeting";
        else if (lp?.waiting) activity = "waiting";
        else activity = "desk";
      }

      // Determine spaceId.
      const placement = curLayout.placements[a.id];
      const spaceId = liveSpace?.id ?? (loungeAgentSet.has(a.id) ? loungeSpace?.id : placement?.space) ?? curSpaces[0]!.id;

      result[a.id] = { x, z, spaceId, activity };
    }

    // Only publish when the snapshot actually changed.
    const snapshot = JSON.stringify(result);
    if (snapshot === lastSnapshotRef.current) return;
    lastSnapshotRef.current = snapshot;
    usePositions.getState().set(result);
  });

  return (
    <>
      <color attach="background" args={[palette.bg]} />
      <fog attach="fog" args={[palette.bg, palette.fog[0], palette.fog[1]]} />
      <Lights palette={palette} spaces={spaces} />
      <Ground palette={palette} />
      <Floors spaces={spaces} palette={palette} layout={layout} managerName={manager?.name} />
      <Furniture spaces={spaces} layout={layout} agents={agents} palette={palette} />
      {spaces.filter(s => s.kind !== "lounge").map(s => <Whiteboard key={s.id} space={s} onOpen={onBoard} />)}
      {spaces.filter(s => s.kind === "meeting").map(s => <MeetingTV key={`tv-${s.id}`} space={s} />)}
      <DropMarker spaces={spaces} />

      {list.map((a) => {
        const target = targets[a.id];
        if (!target) return null;
        const fresh = a.role === "worker" && Date.parse(a.createdAt) > mountedAt.current - FRESH_MS;
        const home = managerHome(office);
        const phase = agentRevivePhase(a);
        const isFainted = phase === "fainted" || phase === "reviving";
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
          >
            {a.role === "worker" && <FileChips agentId={a.id} />}
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
