import { useMemo, useCallback, useEffect } from "react";
import { HEX_R } from "@agenticview/shared";
import { useStore, sortedAgents, agentStatus, STATUS_COLORS } from "../state/store";
import { useMapOpen } from "../state/map";
import { useFocus } from "./motion";
import { useSceneTheme } from "./theme";
import { layoutFor } from "./layout";
import { viewOrder } from "./roomKeys";

const MAP_SIZE = 180;
const PAD = 12;

/** Flat-top hexagon polygon points string for SVG. */
function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i; // 0°, 60°, 120°, 180°, 240°, 300°
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

const KIND_FILL_DARK: Record<string, string> = {
  office: "#1e2240",
  pod: "#1a2232",
  meeting: "#1a2832",
  lounge: "#221e2a",
};
const KIND_FILL_LIGHT: Record<string, string> = {
  office: "#e8eaf6",
  pod: "#f0f4ff",
  meeting: "#e8f4f0",
  lounge: "#f4eeff",
};

/**
 * Mini-map overlay: top-down view of the office hex grid with agent status dots.
 * Rendered as a plain HTML/SVG element outside the R3F Canvas.
 * Positioned in the bottom-right corner; M key or close × toggles it.
 */
export function MiniMap() {
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const permissions = useStore((s) => s.permissions);
  const questions = useStore((s) => s.questions);
  const feed = useStore((s) => s.feed);
  const spaceNames = useStore((s) => s.spaceNames);
  const focus = useFocus((s) => s.focus);
  const setFocus = useFocus((s) => s.setFocus);
  const theme = useSceneTheme();
  const isDark = theme === "dark";

  const { open, setOpen } = useMapOpen();

  // Persist open/closed state to localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("av:map-open");
      if (stored === "false") setOpen(false);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { localStorage.setItem("av:map-open", String(open)); } catch { /* ignore */ }
  }, [open]);

  const list = useMemo(() => sortedAgents(agents), [agents]);
  const layout = useMemo(() => layoutFor(list, spaceNames), [list, spaceNames]);
  const { spaces } = layout;

  // Compute SVG scale to fit all rooms inside MAP_SIZE
  const { svgScale, svgCx, svgCy, hexR } = useMemo(() => {
    const maxDist = spaces.reduce((m, s) => Math.max(m, Math.hypot(s.x, s.z)), 0);
    const extent = maxDist + HEX_R;
    const viewR = MAP_SIZE / 2 - PAD;
    const svgScale = extent > 0 ? viewR / extent : 1;
    const hexR = HEX_R * svgScale * 0.88;
    return { svgScale, svgCx: MAP_SIZE / 2, svgCy: MAP_SIZE / 2, hexR };
  }, [spaces]);

  // Group agent status dots by space id
  const dotsBySpace = useMemo(() => {
    const map = new Map<string, { id: string; color: string }[]>();
    for (const agent of list) {
      const placement = layout.placements[agent.id];
      if (!placement) continue;
      const status = agentStatus(agent, Object.values(tasks), permissions, questions, feed[agent.id] ?? []);
      const dots = map.get(placement.space) ?? [];
      dots.push({ id: agent.id, color: STATUS_COLORS[status] });
      map.set(placement.space, dots);
    }
    return map;
  }, [list, layout, tasks, permissions, questions, feed]);

  const order = useMemo(() => viewOrder(spaces), [spaces]);

  const handleClick = useCallback(
    (spaceId: string) => {
      setFocus(focus === spaceId ? undefined : spaceId);
    },
    [focus, setFocus],
  );

  // Theme-dependent colours
  const containerBg = isDark ? "rgba(18, 20, 34, 0.92)" : "rgba(236, 239, 250, 0.92)";
  const containerBorder = isDark ? "rgba(70, 82, 130, 0.65)" : "rgba(150, 165, 210, 0.65)";
  const textFill = isDark ? "rgba(210, 222, 255, 0.72)" : "rgba(28, 38, 80, 0.72)";
  const keyFill = isDark ? "rgba(110, 130, 210, 0.7)" : "rgba(70, 95, 180, 0.7)";
  const focusFill = isDark ? "#3b5bdb" : "#4c6ef5";
  const focusText = "#ffffff";

  // Bottom-right anchor; above the commandbar area (~80px) and right gutter (16px).
  const anchorStyle: React.CSSProperties = {
    position: "absolute",
    bottom: 88,
    right: 16,
    zIndex: 30,
    userSelect: "none",
  };

  // Small round button shown when map is closed
  if (!open) {
    return (
      <div className="mini-map-hud" style={anchorStyle}>
        <button
          type="button"
          className="minimap-toggle-btn"
          onClick={() => setOpen(true)}
          title="Show mini-map (M)"
          aria-label="Show mini-map"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
            <path d="M9 4v13M15 7v13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="mini-map-hud" style={{ ...anchorStyle, pointerEvents: "none" }}>
      <div
        style={{
          background: containerBg,
          border: `1px solid ${containerBorder}`,
          borderRadius: 10,
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          overflow: "visible",
          boxShadow: isDark ? "0 4px 18px rgba(0,0,0,0.45)" : "0 4px 18px rgba(0,0,0,0.12)",
          position: "relative",
        }}
      >
        {/* Close button */}
        <button
          type="button"
          className="minimap-close-btn"
          onClick={() => setOpen(false)}
          title="Hide mini-map (M)"
          aria-label="Hide mini-map"
          style={{ pointerEvents: "auto" }}
        >
          ×
        </button>
        <svg
          width={MAP_SIZE}
          height={MAP_SIZE}
          viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
          style={{ display: "block", pointerEvents: "auto" }}
          aria-label="Office mini-map"
          role="img"
        >
          {spaces.map((space) => {
            const svgX = svgCx + space.x * svgScale;
            const svgY = svgCy + space.z * svgScale;
            const pts = hexPoints(svgX, svgY, hexR);
            const isFocused = space.id === focus;
            const fill = isFocused ? focusFill : (isDark ? KIND_FILL_DARK : KIND_FILL_LIGHT)[space.kind] ?? (isDark ? "#1a1e30" : "#f0f4ff");
            const stroke = isFocused ? (isDark ? "#6b8fff" : "#3b5bdb") : (isDark ? "rgba(55, 68, 110, 0.9)" : "rgba(170, 185, 225, 0.9)");
            const strokeW = isFocused ? 2 : 1;
            const dots = dotsBySpace.get(space.id) ?? [];
            const keyNum = order.indexOf(space.id) + 1;
            const label = space.name.length > 8 ? space.name.slice(0, 7) + "…" : space.name;
            // Vertical offset: shift name up if dots are shown
            const nameOffsetY = dots.length > 0 ? -hexR * 0.2 : 0;
            const fontSize = Math.max(hexR * 0.27, 6);
            const dotR = Math.max(hexR * 0.115, 2.2);
            const dotRowY = svgY + hexR * 0.38;
            const dotSpacing = Math.min(dotR * 2.4, (hexR * 1.5) / Math.max(dots.length, 1));

            return (
              <g
                key={space.id}
                onClick={() => handleClick(space.id)}
                style={{ cursor: "pointer" }}
              >
                {/* Room hex */}
                <polygon
                  points={pts}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeW}
                />
                {/* Room display name */}
                <text
                  x={svgX}
                  y={svgY + nameOffsetY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={fontSize}
                  fontWeight={600}
                  fill={isFocused ? focusText : textFill}
                  fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                  style={{ pointerEvents: "none" }}
                >
                  {label}
                </text>
                {/* Agent status dots */}
                {dots.map((dot, di) => {
                  const total = dots.length;
                  const dotX = svgX + (di - (total - 1) / 2) * dotSpacing;
                  return (
                    <circle
                      key={dot.id}
                      cx={dotX}
                      cy={dotRowY}
                      r={dotR}
                      fill={dot.color}
                      style={{ pointerEvents: "none" }}
                    />
                  );
                })}
                {/* Keyboard shortcut badge (1-9) */}
                {keyNum >= 1 && keyNum <= 9 && (
                  <text
                    x={svgX - hexR * 0.6}
                    y={svgY - hexR * 0.58}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={Math.max(hexR * 0.22, 5)}
                    fontWeight={700}
                    fill={isFocused ? "rgba(255,255,255,0.7)" : keyFill}
                    fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                    style={{ pointerEvents: "none" }}
                  >
                    {keyNum}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
