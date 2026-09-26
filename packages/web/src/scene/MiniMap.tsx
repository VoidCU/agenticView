import { useMemo, useCallback, useEffect } from "react";
import { HEX_R } from "@agenticview/shared";
import { useStore, sortedAgents, agentStatus, STATUS_COLORS } from "../state/store";
import { useMapOpen } from "../state/map";
import { useFocus } from "./motion";
import { useSceneTheme } from "./theme";
import { layoutFor } from "./layout";
import { viewOrder } from "./roomKeys";
import { usePositions } from "../state/positions";
import { activityLabel, resolveMapPoint, roomOccupancy, spreadRoomPoints } from "../state/minimap";
import { useWalk } from "../state/walk";

const MAP_SIZE = 180;
const PAD = 13;

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i;
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

const KIND_FILL_DARK: Record<string, string> = { office: "#1e2240", pod: "#1a2232", meeting: "#1a2832", lounge: "#221e2a" };
const KIND_FILL_LIGHT: Record<string, string> = { office: "#e8eaf6", pod: "#f0f4ff", meeting: "#e8f4f0", lounge: "#f4eeff" };
const ACTIVITY_MARK: Record<string, string> = { lounge: "☕", break: "☕", fainted: "+", meeting: "◇" };

export function MiniMap() {
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const permissions = useStore((s) => s.permissions);
  const questions = useStore((s) => s.questions);
  const feed = useStore((s) => s.feed);
  const spaceNames = useStore((s) => s.spaceNames);
  const selectAgent = useStore((s) => s.select);
  const positions = usePositions((s) => s.byAgent);
  const player = usePositions((s) => s.player);
  const walking = useWalk((s) => s.walking);
  const focus = useFocus((s) => s.focus);
  const setFocus = useFocus((s) => s.setFocus);
  const theme = useSceneTheme();
  const isDark = theme === "dark";
  const { open, setOpen } = useMapOpen();

  useEffect(() => {
    try {
      const stored = localStorage.getItem("av:map-open");
      if (stored === "false") setOpen(false);
    } catch { /* storage may be disabled */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { localStorage.setItem("av:map-open", String(open)); } catch { /* storage may be disabled */ }
  }, [open]);

  const list = useMemo(() => sortedAgents(agents), [agents]);
  const layout = useMemo(() => layoutFor(list, spaceNames), [list, spaceNames]);
  const { spaces } = layout;
  const { svgScale, svgCx, svgCy, hexR } = useMemo(() => {
    const extent = spaces.reduce((m, s) => Math.max(m, Math.hypot(s.x, s.z)), 0) + HEX_R;
    const svgScale = extent > 0 ? (MAP_SIZE / 2 - PAD) / extent : 1;
    return { svgScale, svgCx: MAP_SIZE / 2, svgCy: MAP_SIZE / 2, hexR: HEX_R * svgScale * 0.88 };
  }, [spaces]);
  const points = useMemo(() => {
    const validIds = new Set(spaces.map((s) => s.id));
    return list.flatMap((agent) => {
      const fallbackPose = layout.poses[agent.id];
      const resolved = resolveMapPoint(
        agent.id,
        positions[agent.id],
        fallbackPose ? { x: fallbackPose.x, z: fallbackPose.z, spaceId: fallbackPose.space } : undefined,
        validIds,
      );
      return resolved ? [{ ...resolved, color: STATUS_COLORS[agentStatus(agent, Object.values(tasks), permissions, questions, feed[agent.id] ?? [])], name: agent.name }] : [];
    });
  }, [list, layout, positions, spaces, tasks, permissions, questions, feed]);
  const occupancy = useMemo(() => roomOccupancy(points), [points]);
  const dotsBySpace = useMemo(() => {
    const map = new Map<string, Array<(typeof points)[number] & { sx: number; sy: number }>>();
    for (const space of spaces) {
      const roomPoints = points.filter((p) => p.spaceId === space.id).map((p) => ({
        ...p,
        x: svgCx + p.x * svgScale,
        y: svgCy + p.z * svgScale,
      }));
      const cx = svgCx + space.x * svgScale;
      const cy = svgCy + space.z * svgScale;
      const spread = spreadRoomPoints(roomPoints, { x: cx, y: cy }, hexR * 0.52, Math.max(4.5, hexR * 0.28));
      map.set(space.id, spread.map((p) => ({ ...p, sx: p.x, sy: p.y })));
    }
    return map;
  }, [points, spaces, svgCx, svgCy, svgScale, hexR]);
  const order = useMemo(() => viewOrder(spaces), [spaces]);
  const handleRoomClick = useCallback((spaceId: string) => setFocus(focus === spaceId ? undefined : spaceId), [focus, setFocus]);

  const containerBg = isDark ? "rgba(18, 20, 34, 0.92)" : "rgba(236, 239, 250, 0.92)";
  const containerBorder = isDark ? "rgba(70, 82, 130, 0.65)" : "rgba(150, 165, 210, 0.65)";
  const textFill = isDark ? "rgba(210, 222, 255, 0.85)" : "rgba(28, 38, 80, 0.85)";
  const keyFill = isDark ? "rgba(110, 130, 210, 0.7)" : "rgba(70, 95, 180, 0.7)";
  const focusFill = isDark ? "#3b5bdb" : "#4c6ef5";
  const anchorStyle: React.CSSProperties = { position: "absolute", bottom: 88, right: 16, zIndex: 30, userSelect: "none" };

  if (!open) return <div className="mini-map-hud" style={anchorStyle}>
    <button type="button" className="minimap-toggle-btn" onClick={() => setOpen(true)} title="Show mini-map (M)" aria-label="Show mini-map">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M9 4v13M15 7v13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
    </button>
  </div>;

  return <div className="mini-map-hud" style={{ ...anchorStyle, pointerEvents: "none" }}>
    <div style={{ background: containerBg, border: `1px solid ${containerBorder}`, borderRadius: 10, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", overflow: "visible", boxShadow: isDark ? "0 4px 18px rgba(0,0,0,0.45)" : "0 4px 18px rgba(0,0,0,0.12)", position: "relative" }}>
      <button type="button" className="minimap-close-btn" onClick={() => setOpen(false)} title="Hide mini-map (M)" aria-label="Hide mini-map" style={{ pointerEvents: "auto" }}>×</button>
      <svg width={MAP_SIZE} height={MAP_SIZE} viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`} style={{ display: "block", pointerEvents: "auto" }} aria-label="Office mini-map" role="img">
        {spaces.map((space) => {
          const svgX = svgCx + space.x * svgScale;
          const svgY = svgCy + space.z * svgScale;
          const isFocused = space.id === focus;
          const fill = isFocused ? focusFill : (isDark ? KIND_FILL_DARK : KIND_FILL_LIGHT)[space.kind] ?? (isDark ? "#1a1e30" : "#f0f4ff");
          const stroke = isFocused ? (isDark ? "#6b8fff" : "#3b5bdb") : (isDark ? "rgba(55, 68, 110, 0.9)" : "rgba(170, 185, 225, 0.9)");
          const roomCount = occupancy.get(space.id) ?? 0;
          const nameSize = Math.max(5.5, Math.min(8, hexR * 0.34));
          const dots = dotsBySpace.get(space.id) ?? [];
          const keyNum = order.indexOf(space.id) + 1;
          return <g key={space.id} className="minimap-room" onClick={() => handleRoomClick(space.id)} style={{ cursor: "pointer" }}>
            <polygon points={hexPoints(svgX, svgY, hexR)} fill={fill} stroke={stroke} strokeWidth={isFocused ? 2 : 1}/>
            <text x={svgX} y={svgY} textAnchor="middle" dominantBaseline="middle" fontSize={nameSize} fontWeight={650} fill={isFocused ? "#fff" : textFill} fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" textLength={hexR * 1.55} lengthAdjust="spacingAndGlyphs" aria-label={`${space.name}${roomCount ? ` ${roomCount}` : ""}`} style={{ pointerEvents: "none" }}>
              {`${space.name}${roomCount ? ` ${roomCount}` : ""}`}
              <title>{`${space.name}${roomCount ? ` · ${roomCount} agent${roomCount === 1 ? "" : "s"}` : ""}`}</title>
            </text>
            {dots.map((dot) => {
              const mark = ACTIVITY_MARK[dot.activity];
              return <g key={dot.agentId} data-agent-id={dot.agentId} data-live-position={dot.live || undefined} className={`minimap-agent minimap-agent-${dot.activity}`} role="button" tabIndex={0} aria-label={`${dot.name}, ${activityLabel(dot.activity)}, ${space.name}`} onClick={(event) => { event.stopPropagation(); selectAgent(dot.agentId); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); selectAgent(dot.agentId); } }}>
                <title>{`${dot.name} · ${activityLabel(dot.activity)}`}</title>
                {mark && <circle className="minimap-activity-ring" cx={dot.sx} cy={dot.sy} r="5.4" fill="none" stroke={dot.color} strokeWidth="1.2"/>}
                <circle cx={dot.sx} cy={dot.sy} r="3.5" fill={dot.color} stroke={isDark ? "#111522" : "white"} strokeWidth="1.2" className="minimap-agent-dot"/>
                {mark && <text x={dot.sx + 4} y={dot.sy - 3} fontSize="5" fill={textFill} pointerEvents="none">{mark}</text>}
              </g>;
            })}
            {keyNum >= 1 && keyNum <= 9 && <text x={svgX - hexR * 0.58} y={svgY - hexR * 0.57} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(5, hexR * 0.22)} fontWeight={700} fill={keyFill} pointerEvents="none">{keyNum}</text>}
          </g>;
        })}
        {walking && player && <g className="minimap-player" aria-label="You are here" pointerEvents="none">
          <title>You · facing direction</title>
          <circle cx={svgCx + player.x * svgScale} cy={svgCy + player.z * svgScale} r="5.5" fill="#ffffff" stroke="#3976ff" strokeWidth="2"/>
          <path d={`M 0 -8 L -4 3 L 0 1 L 4 3 Z`} fill="#3976ff" transform={`translate(${svgCx + player.x * svgScale} ${svgCy + player.z * svgScale}) rotate(${(-player.yaw * 180) / Math.PI})`}/>
          <text x={svgCx + player.x * svgScale + 6} y={svgCy + player.z * svgScale - 5} fontSize="6" fill={textFill}>You</text>
        </g>}
      </svg>
    </div>
  </div>;
}
