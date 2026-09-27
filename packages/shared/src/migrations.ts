import type { Agent, Placement } from "./agent.js";
import {
  DEFAULT_HEXES,
  MAX_RINGS,
  buildSpaces,
  buildSpacesFromLayout,
  defaultRoomName,
  growLayout,
  hexDistance,
  nextGrowthHex,
  planOfficeWithSpaces,
  reachableRooms,
  ringsFor,
  type ExplicitRoom,
  type LayoutRoom,
  type OfficeLayout,
} from "./office.js";

export interface LegacyLayoutInput {
  /** rooms.json of 0.2.16 and earlier (manager implicitly at 0,0; lounge at -1,0); null when the file never existed. */
  rooms: ExplicitRoom[] | null;
  /** office.json: custom room names by room id. */
  spaceNames: Record<string, string>;
  /** Every agent (non-workers are ignored); their persisted `placement` is checked against the new plan. */
  workers: Agent[];
  /** An already migrated layout (layout.json). When present rooms.json is ignored and the layout kept as is. */
  layout?: OfficeLayout | null;
}

export interface LayoutMigration {
  layout: OfficeLayout;
  /** Custom names of rooms that still exist (names of rooms that are gone are dropped). */
  spaceNames: Record<string, string>;
  /** New placement for every worker whose persisted seat no longer exists or is contested (agent id → seat). */
  placements: Record<string, Placement>;
  /** Legacy room ids that did not fit into the new plan (only when the old office used every hex). */
  dropped: string[];
  /** True when anything must be written back (layout, names or placements). */
  changed: boolean;
}

const key = (h: { q: number; r: number }) => `${h.q},${h.r}`;

/** Hexes the new rooms (and the swapped office / lounge) take in the default plan. */
const RESERVED = new Set(Object.values(DEFAULT_HEXES).map(key));


/**
 * Turn a 0.2.16 office (rooms.json + office.json + agent placements) into the layout-as-data plan.
 *
 * - The result is the new default plan: lounge in the centre and the manager's office on the lounge's
 *   old hex (-1,0) (they swap), meeting room north, My Office / Production Room / Research Room on
 *   the west of ring 2.
 * - Every old pod / meeting room / extra lounge keeps its id, custom name and hex when that hex is still
 *   free; one standing on a hex the new rooms now use moves to the next free hex that shares a doorway
 *   with the plan (nearest ring first, camera-facing side first). A lounge is always in the centre.
 * - office.json names are kept for rooms that still exist and dropped for rooms that do not.
 * - Worker seats that no longer exist (or are contested) are remapped to the first free pod desk, and
 *   pods grow when the desks run out.
 *
 * Pure and idempotent: with `input.layout` set (already migrated) the layout and names are returned
 * unchanged and only invalid seats are remapped, so running it on its own output changes nothing.
 */
export function migrateLegacyLayout(input: LegacyLayoutInput): LayoutMigration {
  const workers = input.workers.filter((a) => a.role === "worker");
  if (input.layout) {
    const spaceNames = { ...input.spaceNames };
    const placements = remapSeats(input.layout, spaceNames, workers);
    return { layout: input.layout, spaceNames, placements, dropped: [], changed: Object.keys(placements).length > 0 };
  }

  const legacy: ExplicitRoom[] =
    input.rooms ??
    buildSpaces(ringsFor(workers.length))
      .filter((s) => s.kind !== "office")
      .map((s) => ({ id: s.id, kind: s.kind as ExplicitRoom["kind"], name: s.name, q: s.q, r: s.r }));

  type Entry = { room: Omit<LayoutRoom, "q" | "r">; hex: { q: number; r: number } | null };
  const taken = new Set<string>(RESERVED);
  const entries: Entry[] = [];
  let hasLounge = false;
  for (const r of legacy) {
    const custom = r.name.trim() && r.name.trim() !== defaultRoomName(r.kind, r.id) ? r.name.trim().slice(0, 40) : undefined;
    const room: Entry["room"] = { id: r.id, kind: r.kind, ...(custom ? { name: custom } : {}) };
    if (r.kind === "lounge" && !hasLounge) {
      // The lounge swaps with the manager's office: it now takes the centre hex.
      hasLounge = true;
      entries.push({ room, hex: { ...DEFAULT_HEXES.lounge } });
      continue;
    }
    const k = key(r);
    if (!taken.has(k) && hexDistance(r, { q: 0, r: 0 }) <= MAX_RINGS) {
      taken.add(k);
      entries.push({ room, hex: { q: r.q, r: r.r } });
    } else entries.push({ room, hex: null });
  }

  const fixed: LayoutRoom[] = [
    { id: "myoffice", kind: "myoffice", ...DEFAULT_HEXES.myoffice },
    { id: "production", kind: "production", ...DEFAULT_HEXES.production },
    { id: "research", kind: "research", ...DEFAULT_HEXES.research },
  ];
  if (!hasLounge) fixed.unshift({ id: "lounge", kind: "lounge", ...DEFAULT_HEXES.lounge });
  const office: LayoutRoom = { id: "office", kind: "office", ...DEFAULT_HEXES.office };

  const assemble = (): OfficeLayout => ({
    version: 1,
    rooms: [office, ...entries.flatMap((e) => (e.hex ? [{ ...e.room, ...e.hex }] : [])), ...fixed],
  });

  // Rooms displaced by the new rooms, then rooms cut off from the office, move to the next free hex.
  const dropped: string[] = [];
  const relocate = (e: Entry) => {
    e.hex = null;
    const h = nextGrowthHex(assemble(), e.room.kind);
    if (h) e.hex = h;
    else dropped.push(e.room.id);
  };
  for (const e of entries) if (!e.hex) relocate(e);
  for (let guard = 0; guard < entries.length; guard++) {
    const reach = reachableRooms(assemble());
    const cut = entries.find((e) => e.hex && !reach.has(e.room.id));
    if (!cut) break;
    relocate(cut);
  }

  const layout = growLayout(assemble(), workers.length);
  const ids = new Set(layout.rooms.map((r) => r.id));
  const spaceNames = Object.fromEntries(Object.entries(input.spaceNames).filter(([id]) => ids.has(id)));
  const placements = remapSeats(layout, spaceNames, workers);
  return { layout, spaceNames, placements, dropped, changed: true };
}

/** New seats for workers whose persisted placement is invalid on `layout` (workers without one are left alone). */
function remapSeats(layout: OfficeLayout, spaceNames: Record<string, string>, workers: Agent[]): Record<string, Placement> {
  const plan = planOfficeWithSpaces(buildSpacesFromLayout(layout, spaceNames), workers);
  const out: Record<string, Placement> = {};
  for (const w of workers) {
    const p = w.placement;
    const next = plan.placements[w.id];
    if (p && next && (p.space !== next.space || p.seat !== next.seat)) out[w.id] = next;
  }
  return out;
}
