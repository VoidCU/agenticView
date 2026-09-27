import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { applyLayoutMoves, axialToWorld, buildSpacesFromLayout, defaultLayout, hexDistance, hexRing, MAX_RINGS, setRoomKind, validateLayout, type Hex, type OfficeLayout, type SpaceKind } from "@agenticview/shared";
import { apiFetch } from "../net/ws";
import { useStore } from "../state/store";

const key = ({ q, r }: Hex) => `${q},${r}`;
const ALL_HEXES = Array.from({ length: MAX_RINGS + 1 }, (_, ring) => hexRing(ring)).flat();
const KIND_LABEL: Record<SpaceKind, string> = { office: "Manager's Office", myoffice: "My Office", pod: "Pod", meeting: "Meeting Room", lounge: "Lounge", production: "Production", research: "Research" };
const EDITABLE_KINDS: SpaceKind[] = ["pod", "meeting", "lounge", "production", "research"];
const SVG_SIZE = 520;
const SCALE = 6.1;
const RADIUS = 40;

function points(x: number, y: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI * i / 3;
    return `${x + RADIUS * Math.cos(a)},${y + RADIUS * Math.sin(a)}`;
  }).join(" ");
}

/** Draft edits remain local until Save; Cancel remounts from the authoritative store layout. */
export function LayoutEditor() {
  const serverLayout = useStore((s) => s.layout);
  const agents = useStore((s) => s.agents);
  const spaceNames = useStore((s) => s.spaceNames);
  const [draft, setDraft] = useState<OfficeLayout>(() => serverLayout ?? defaultLayout(Object.values(agents).filter((a) => a.role === "worker").length));
  const [draftNames, setDraftNames] = useState<Record<string, string>>(() => ({ ...spaceNames }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Hex>({ q: 0, r: 0 });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const hexRefs = useRef<Record<string, SVGGElement | null>>({});

  // A broadcast is authoritative unless the user is editing a draft.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty && serverLayout) setDraft(serverLayout);
  }, [serverLayout, dirty]);

  const placements = useMemo(() => Object.fromEntries(Object.values(agents).filter((a) => a.role === "worker" && a.placement).map((a) => [a.id, a.placement!])), [agents]);
  const validation = useMemo(() => validateLayout(draft, { placements, previous: serverLayout }), [draft, placements, serverLayout]);
  const names = useMemo(() => new Map(buildSpacesFromLayout(draft, draftNames).map((s) => [s.id, s.name])), [draft, draftNames]);
  const selected = draft.rooms.find((r) => r.id === selectedId);
  const selectedHex = selected ?? (selectedId === null ? cursor : undefined);
  // The room the type picker acts on: the selected room, else whatever sits under the keyboard cursor.
  const target = selected ?? (selectedHex ? draft.rooms.find((r) => r.q === selectedHex.q && r.r === selectedHex.r) : undefined);
  const occupied = selected ? Object.values(placements).some((p) => p.space === selected.id) : false;

  const chooseHex = (hex: Hex) => {
    const room = draft.rooms.find((r) => r.q === hex.q && r.r === hex.r);
    setCursor(hex);
    setSaveError("");
    if (selectedId) {
      if (selectedId !== room?.id) {
        setDraft((current) => applyLayoutMoves(current, [{ space: selectedId, toHex: hex }]));
        setDirty(true);
      }
      setSelectedId(null);
    } else {
      setSelectedId(room?.id ?? null);
    }
  };

  const onHexKey = (event: KeyboardEvent<SVGGElement>, hex: Hex) => {
    const steps: Record<string, Hex> = {
      ArrowLeft: { q: -1, r: 0 }, ArrowRight: { q: 1, r: 0 },
      ArrowUp: { q: 0, r: -1 }, ArrowDown: { q: 0, r: 1 },
    };
    const step = steps[event.key];
    if (step) {
      event.preventDefault();
      const next = { q: hex.q + step.q, r: hex.r + step.r };
      if (hexDistance(next, { q: 0, r: 0 }) <= MAX_RINGS) {
        setCursor(next);
        hexRefs.current[key(next)]?.focus();
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseHex(hex);
    } else if (event.key === "Escape" && selectedId) {
      // Drop the selection only; with nothing selected Escape closes Settings as usual.
      event.preventDefault();
      event.stopPropagation();
      setSelectedId(null);
    }
  };

  const changeKind = (kind: SpaceKind | null) => {
    if (!selectedHex) return;
    setDraft((current) => setRoomKind(current, selectedHex, kind));
    setDirty(true);
    setSelectedId(null);
    setSaveError("");
  };

  const cancel = () => {
    setDraft(serverLayout ?? defaultLayout(Object.values(agents).filter((a) => a.role === "worker").length));
    setDraftNames({ ...spaceNames });
    setSelectedId(null);
    setDirty(false);
    setSaveError("");
  };

  const save = async () => {
    if (!validation.ok || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      // A cleared name restores the default (the server rejects empty names).
      const cleanNames = Object.fromEntries(Object.entries(draftNames).map(([id, n]) => [id, n.trim()]).filter(([, n]) => n));
      const response = await apiFetch("/api/layout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, spaceNames: cleanNames }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Layout save failed (${response.status})`);
      }
      setDirty(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Layout save failed");
    } finally {
      setSaving(false);
    }
  };

  return <section className="layout-editor" aria-label="Layout editor">
    <p className="section-desc">Choose a room, then choose another hex to move or swap it. Arrow keys move between hexes; Enter selects or places a room.</p>
    <svg className="layout-editor-map" viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} role="group" aria-label="Office hex grid">
      {ALL_HEXES.map((hex) => {
        const room = draft.rooms.find((r) => r.q === hex.q && r.r === hex.r);
        const world = axialToWorld(hex.q, hex.r);
        const x = SVG_SIZE / 2 + world.x * SCALE;
        const y = SVG_SIZE / 2 + world.z * SCALE;
        const label = room ? names.get(room.id) ?? KIND_LABEL[room.kind] : "Empty hex";
        const active = selectedId === room?.id && !!room;
        return <g key={key(hex)} ref={(node) => { hexRefs.current[key(hex)] = node; }} role="button" tabIndex={key(cursor) === key(hex) ? 0 : -1}
          aria-label={`${label}, hex ${hex.q},${hex.r}`} aria-pressed={active} data-kind={room?.kind ?? "empty"}
          className={`layout-editor-hex${active ? " is-selected" : ""}`}
          onClick={() => chooseHex(hex)} onKeyDown={(event) => onHexKey(event, hex)}>
          <title>{label}</title>
          <polygon points={points(x, y)} />
          <text x={x} y={y} textAnchor="middle" dominantBaseline="central" textLength={room && label.length > 10 ? 66 : undefined} lengthAdjust="spacingAndGlyphs" aria-hidden="true">{room ? label : "+"}</text>
        </g>;
      })}
    </svg>
    <div className="layout-editor-controls">
      <label htmlFor="layout-room-kind">Room type</label>
      <select id="layout-room-kind" value={target?.kind ?? ""} disabled={!selectedHex || target?.kind === "office" || target?.kind === "myoffice"}
        onChange={(event) => changeKind(event.target.value ? event.target.value as SpaceKind : null)}>
        <option value="">{target ? "Remove room" : "Empty hex"}</option>
        {EDITABLE_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
      </select>
      {selected && <label htmlFor="layout-room-name">Room name</label>}
      {selected && <input id="layout-room-name" value={draftNames[selected.id] ?? selected.name ?? ""} placeholder={names.get(selected.id)} maxLength={40}
        onChange={(event) => { setDraftNames((current) => ({ ...current, [selected.id]: event.target.value })); setDirty(true); }} />}
      {selected && occupied && <p className="hint">This room has seated workers. Its seats must remain available.</p>}
    </div>
    {!validation.ok && <div className="layout-editor-errors" role="alert">{validation.errors.map((error) => <p key={error}>{error}</p>)}</div>}
    {saveError && <p className="hint hint-error" role="alert">{saveError}</p>}
    <div className="form-actions">
      <button type="button" className="btn btn-ghost" onClick={cancel}>Cancel layout changes</button>
      <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || !validation.ok || saving}>{saving ? "Saving…" : "Save layout"}</button>
    </div>
  </section>;
}
