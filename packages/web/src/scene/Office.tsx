import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import type { Agent } from "@agenticview/shared";
import { useStore, sortedAgents, fileChipsFor, type FileChip } from "../state/store";
import { useEffect, useState } from "react";
import { layoutFor, nextDeskFor, nextLobbyFor, LOBBY_Z, type Spot } from "./layout";
import { Robot } from "./Robot";
import { Beam } from "./Beam";
import { Confetti } from "./Confetti";
import { PlusIcon } from "../hud/ui";

const PODIUM_H = 0.32;
const LOBBY_H = 0.26;
const BG = "#0e1017";

function baseFor(spot: Spot): number {
  return spot.zone === "podium" ? PODIUM_H : spot.zone === "lobby" ? LOBBY_H : 0;
}

function Desk({ spot, color }: { spot: Spot; color: string }) {
  // The desk sits behind the robot, on the side facing away from the camera.
  const back = -1.05;
  return (
    <group position={[spot.x, baseFor(spot), spot.z]} rotation={[0, Math.PI / 4, 0]}>
      <mesh position={[0, 0.62, back]}>
        <boxGeometry args={[1.9, 0.08, 0.8]} />
        <meshStandardMaterial color="#2c3146" roughness={0.7} />
      </mesh>
      {[-0.85, 0.85].map((x) => (
        <mesh key={x} position={[x, 0.3, back]}>
          <boxGeometry args={[0.08, 0.6, 0.7]} />
          <meshStandardMaterial color="#1f2333" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 0.96, back - 0.22]}>
        <boxGeometry args={[0.9, 0.55, 0.05]} />
        <meshStandardMaterial color="#0b0d14" roughness={0.3} emissive={color} emissiveIntensity={0.55} />
      </mesh>
      <mesh position={[0, 0.72, back - 0.22]}>
        <boxGeometry args={[0.08, 0.14, 0.08]} />
        <meshStandardMaterial color="#3a4058" />
      </mesh>
      <mesh position={[0, 0.68, back + 0.15]}>
        <boxGeometry args={[0.6, 0.03, 0.22]} />
        <meshStandardMaterial color="#3a4058" roughness={0.6} />
      </mesh>
    </group>
  );
}

/** Chips naming the files an agent touched in the last few seconds, floating above its desk and fading out. */
function FileChips({ agentId, spot }: { agentId: string; spot: Spot }) {
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
    <Html center position={[spot.x, baseFor(spot) + 1.75, spot.z - 0.9]} distanceFactor={12} zIndexRange={[12, 0]} style={{ pointerEvents: "none" }}>
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

function Podium() {
  return (
    <group>
      <mesh position={[0, PODIUM_H / 2, 0]}>
        <cylinderGeometry args={[1.5, 1.7, PODIUM_H, 32]} />
        <meshStandardMaterial color="#262b3f" roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[0, PODIUM_H + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.32, 1.42, 48]} />
        <meshStandardMaterial color="#ffd166" emissive="#ffd166" emissiveIntensity={0.9} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 4.5, 0]} color="#ffd9a0" intensity={30} distance={11} decay={2} />
    </group>
  );
}

function Lobby() {
  return (
    <group position={[0, 0, LOBBY_Z]}>
      <mesh position={[0, LOBBY_H / 2, 0]}>
        <boxGeometry args={[26, LOBBY_H, 5.2]} />
        <meshStandardMaterial color="#232a3d" roughness={0.75} />
      </mesh>
      <mesh position={[0, LOBBY_H + 0.005, 2.55]}>
        <boxGeometry args={[26, 0.01, 0.08]} />
        <meshStandardMaterial color="#4fd1ff" emissive="#4fd1ff" emissiveIntensity={0.6} toneMapped={false} />
      </mesh>
      <Html center position={[-11.5, LOBBY_H + 0.4, 0]} distanceFactor={14} style={{ pointerEvents: "none" }}>
        <div className="zone-label">Lobby</div>
      </Html>
    </group>
  );
}

function Floor() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#1b1e2b" roughness={0.9} />
      </mesh>
      <gridHelper args={[30, 30, "#2b3044", "#232739"]} position={[0, 0.01, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[3.2, 3.26, 64]} />
        <meshBasicMaterial color="#2f3550" transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function NewAgentPad({ spot, onCreate }: { spot: Spot; onCreate: () => void }) {
  const y = baseFor(spot);
  return (
    <group position={[spot.x, y, spot.z]}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={(e) => (e.stopPropagation(), onCreate())}>
        <ringGeometry args={[0.6, 0.8, 40]} />
        <meshBasicMaterial color="#5b8cff" transparent opacity={0.55} />
      </mesh>
      <Html center position={[0, 0.9, 0]} distanceFactor={12} zIndexRange={[15, 0]} style={{ pointerEvents: "none" }}>
        <button
          type="button"
          className="pad-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => (e.stopPropagation(), onCreate())}
          title="Add a new agent at this desk"
        >
          <PlusIcon />
          <span>New agent</span>
        </button>
      </Html>
    </group>
  );
}

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

function Scene({ onCreate }: { onCreate: () => void }) {
  const agents = useStore((s) => s.agents);
  const beams = useStore((s) => s.beams);
  const celebrations = useStore((s) => s.celebrations);
  const world = useStore((s) => s.world);
  const mirrorLatest = useStore((s) => s.mirror[0]);
  const list = useMemo(() => sortedAgents(agents), [agents]);
  const layout = useMemo(() => layoutFor(list), [list]);
  const hub = world?.kind === "hub";
  const padSpot = useMemo(() => (hub ? nextLobbyFor(list) : nextDeskFor(list)), [hub, list]);
  const mirrorSpot: Spot = { x: 7.5, z: 5.5, zone: "desk" };

  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 24, 46]} />
      <hemisphereLight args={["#6f7cff", "#1a1420", 0.55]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[8, 14, 6]} intensity={1.25} color="#dfe6ff" />
      <directionalLight position={[-10, 8, -8]} intensity={0.5} color="#7aa2ff" />

      <Floor />
      <Podium />
      <Lobby />

      {list.map((a) => {
        const spot = layout[a.id];
        if (!spot) return null;
        return (
          <group key={a.id}>
            {spot.zone !== "podium" && <Desk spot={spot} color={a.appearance.color} />}
            <Robot agent={a} spot={spot} baseY={baseFor(spot)} />
            {spot.zone !== "podium" && <FileChips agentId={a.id} spot={spot} />}
          </group>
        );
      })}

      {mirrorLatest && <Robot agent={YOU} spot={mirrorSpot} bubbleOverride={mirrorLatest.text.slice(0, 90)} />}

      <NewAgentPad spot={padSpot} onCreate={onCreate} />

      {beams.map((b) => {
        const from = layout[b.from];
        const to = layout[b.to];
        if (!from || !to) return null;
        return <Beam key={b.id} from={[from.x, baseFor(from) + 1.4, from.z]} to={[to.x, baseFor(to) + 1.4, to.z]} />;
      })}

      {celebrations.map((c, i) => {
        const at = layout[c.agentId];
        if (!at) return null;
        return <Confetti key={`${c.agentId}-${c.until}-${i}`} origin={[at.x, baseFor(at), at.z]} until={c.until} />;
      })}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={0.6}
        maxPolarAngle={1.3}
        minDistance={7}
        maxDistance={40}
        target={[0, 0.6, -1.5]}
        enablePan
        panSpeed={0.6}
      />
    </>
  );
}

export function Office({ onCreate }: { onCreate: () => void }) {
  const select = useStore((s) => s.select);
  return (
    <div className="office">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [11, 12, 11], fov: 40, near: 0.5, far: 80 }}
        shadows={false}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={() => select(undefined)}
      >
        <Suspense fallback={null}>
          <Scene onCreate={onCreate} />
        </Suspense>
      </Canvas>
    </div>
  );
}
