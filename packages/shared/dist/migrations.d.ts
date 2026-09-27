import type { Agent, Placement } from "./agent.js";
import { type ExplicitRoom, type OfficeLayout } from "./office.js";
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
export declare function migrateLegacyLayout(input: LegacyLayoutInput): LayoutMigration;
