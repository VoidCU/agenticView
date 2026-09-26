/**
 * Lounge spot model and assignment for the AgenticView lounge room.
 *
 * `loungeSpots(capacityHint, hexR)` returns a deterministic, scale-aware set of
 * physical spots inside (and optionally outside) the lounge room.  Pixel reads
 * the companion `furniture` array to place meshes at the same positions.
 *
 * `assignLoungeSpots(agentIds, spots, prior?)` assigns each agent to a unique
 * spot and is stable: agents in `prior` keep their spot when it is still free.
 *
 * `rpsFacing(a, b)` returns yaw angles so two players look at each other.
 */
import { HEX_APOTHEM, HEX_R } from "./office.js";
// ─── Internals ────────────────────────────────────────────────────────────────
const TWO_PI = 2 * Math.PI;
function facingFromYaw(yaw) {
    return { x: Math.sin(yaw), z: Math.cos(yaw) };
}
/** Yaw so a point at `from` looks toward `to`. */
function yawToward(from, to) {
    return Math.atan2(to.x - from.x, to.z - from.z);
}
function spot(idx, kind, x, z, yaw, pose, seatHeight, waiting = false) {
    const norm = ((yaw % TWO_PI) + TWO_PI) % TWO_PI;
    return { id: `${kind}-${idx}`, kind, x, z, yaw: norm, pose, seatHeight, facing: facingFromYaw(norm), ...(waiting ? { waiting: true } : {}) };
}
// ─── Spot generation ──────────────────────────────────────────────────────────
/**
 * Generate a full lounge layout scaled to `hexR` (default `HEX_R`).
 *
 * Base capacity (no waiting spots): 16 spots.
 * When `capacityHint > 16`, additional waiting spots are appended (distinct
 * positions just outside the main doorway).
 *
 * All positions are **local to the lounge room centre** so the caller can add
 * the room's world (x, z) to get world coordinates.
 */
export function loungeSpots(capacityHint = 0, hexR = HEX_R) {
    const s = hexR / 7; // scale factor (1.0 at default HEX_R=7)
    const spots = [];
    const furniture = [];
    let sofaIdx = 0;
    let armIdx = 0;
    let ctrIdx = 0;
    let beanIdx = 0;
    let standIdx = 0;
    // ── Sofas: two units of 3 seats each ──────────────────────────────────────
    // Sofa A: behind the low table, occupants face +x (toward the room).
    // Seats arranged along z at z = +2.0 s.
    {
        const sz = 2.0 * s;
        const sxBase = -0.8 * s;
        const seatSpacing = 0.9 * s;
        const yaw = Math.PI / 2; // face +x
        for (let c = 0; c < 3; c++) {
            spots.push(spot(sofaIdx++, "sofa", sxBase + c * seatSpacing - seatSpacing, sz, yaw, "sit", 0.45 * s));
        }
        furniture.push({ kind: "sofa", x: sxBase, z: sz, yaw, seats: 3 });
    }
    // Sofa B: facing −x (back to wall), z = −2.0 s.
    {
        const sz = -2.0 * s;
        const sxBase = -0.8 * s;
        const seatSpacing = 0.9 * s;
        const yaw = -Math.PI / 2; // face −x
        for (let c = 0; c < 3; c++) {
            spots.push(spot(sofaIdx++, "sofa", sxBase + c * seatSpacing - seatSpacing, sz, yaw, "sit", 0.45 * s));
        }
        furniture.push({ kind: "sofa", x: sxBase, z: sz, yaw, seats: 3 });
    }
    // ── Armchairs: two in opposite corners ────────────────────────────────────
    {
        const pairs = [
            [2.4 * s, 2.4 * s],
            [2.4 * s, -2.4 * s],
        ];
        for (const [cx, cz] of pairs) {
            const yaw = yawToward({ x: cx, z: cz }, { x: 0, z: 0 });
            spots.push(spot(armIdx++, "armchair", cx, cz, yaw, "sit", 0.5 * s));
            furniture.push({ kind: "armchair", x: cx, z: cz, yaw, seats: 1 });
        }
    }
    // ── Coffee counter: 3 standing spots along a back wall at x = −3.5 s ──────
    {
        const cx = -3.5 * s;
        const zOffsets = [-0.7 * s, 0, 0.7 * s];
        const yaw = Math.PI / 2; // face +x (toward room)
        for (const cz of zOffsets) {
            spots.push(spot(ctrIdx++, "counter", cx, cz, yaw, "stand", 0));
        }
        furniture.push({ kind: "counter", x: cx - 0.25 * s, z: 0, yaw: 0, seats: 3 });
    }
    // ── Beanbags / floor cushions: 2 near the centre ─────────────────────────
    {
        const pairs = [
            [0.8 * s, 0.8 * s],
            [-0.4 * s, -1.0 * s],
        ];
        for (const [bx, bz] of pairs) {
            const yaw = yawToward({ x: bx, z: bz }, { x: 0, z: 0 });
            spots.push(spot(beanIdx++, "beanbag", bx, bz, yaw, "floor", 0.2 * s));
            furniture.push({ kind: "beanbag", x: bx, z: bz, yaw, seats: 1 });
        }
    }
    // ── Standing spots near window / scoreboard wall ─────────────────────────
    // Placed near the +x wall which faces the main area.
    {
        const triples = [
            [3.2 * s, 0],
            [2.8 * s, 1.6 * s],
            [2.8 * s, -1.6 * s],
        ];
        for (const [wx, wz] of triples) {
            const yaw = yawToward({ x: wx, z: wz }, { x: 0, z: 0 });
            spots.push(spot(standIdx++, "standing", wx, wz, yaw, "stand", 0));
        }
    }
    // Base count: 3+3+2+3+2+3 = 16
    const baseCapacity = spots.length;
    // ── Waiting spots (overflow) outside the main doorway ─────────────────────
    // The lounge hex is at axial (-1,0).  Its doorway toward hex (0,0) — the
    // manager's office — is at DOOR_ANGLES[0] = 30° (local to the lounge room).
    // Waiting agents queue just outside, fanning outward from the doorway.
    const needed = Math.max(0, capacityHint - baseCapacity);
    if (needed > 0) {
        // Doorway local position (at the wall).
        const doorAngle = Math.PI / 6; // 30°
        const doorX = HEX_APOTHEM * Math.cos(doorAngle) * s;
        const doorZ = HEX_APOTHEM * Math.sin(doorAngle) * s;
        // Place waiting spots in a small arc just beyond the door.
        // Continue the standIdx so waiting spot IDs don't collide with the 3 regular standing spots.
        const outwardStep = 1.2 * s;
        for (let i = 0; i < needed; i++) {
            const spread = (i - (needed - 1) / 2) * 0.8 * s;
            const perpAngle = doorAngle + Math.PI / 2;
            const wx = doorX + (i + 1) * outwardStep * Math.cos(doorAngle) + spread * Math.cos(perpAngle);
            const wz = doorZ + (i + 1) * outwardStep * Math.sin(doorAngle) + spread * Math.sin(perpAngle);
            // Face back toward the room.
            const yaw = yawToward({ x: wx, z: wz }, { x: 0, z: 0 });
            spots.push(spot(standIdx + i, "standing", wx, wz, yaw, "stand", 0, true));
        }
    }
    return { spots, furniture };
}
// ─── Assignment ───────────────────────────────────────────────────────────────
/**
 * Deterministically assign each agentId to a unique LoungeSpot.
 *
 * Rules:
 * 1. Agents present in `prior` keep their spot when the spot still exists.
 * 2. Unassigned agents are given the next free spot in `spots` order, sorted by agentId.
 * 3. If there are more agents than spots the excess agents remain unassigned.
 *
 * Returns a map `agentId → spotId`.
 */
export function assignLoungeSpots(agentIds, spots, prior = {}) {
    const spotById = new Map(spots.map((s) => [s.id, s]));
    const taken = new Set();
    const result = {};
    // Pass 1: honour prior assignments for agents still present.
    for (const id of agentIds) {
        const prevSpot = prior[id];
        if (prevSpot && spotById.has(prevSpot) && !taken.has(prevSpot)) {
            result[id] = prevSpot;
            taken.add(prevSpot);
        }
    }
    // Pass 2: assign remaining agents in sorted order (deterministic).
    const unassigned = [...agentIds].filter((id) => !result[id]).sort();
    let spotIdx = 0;
    for (const id of unassigned) {
        while (spotIdx < spots.length && taken.has(spots[spotIdx].id))
            spotIdx++;
        if (spotIdx >= spots.length)
            break;
        result[id] = spots[spotIdx].id;
        taken.add(spots[spotIdx].id);
        spotIdx++;
    }
    return result;
}
// ─── RPS facing ───────────────────────────────────────────────────────────────
/**
 * Given the positions of two RPS players (local to any common origin), return
 * the yaw each should use so they look directly at each other.
 */
export function rpsFacing(a, b) {
    return {
        yawA: yawToward(a, b),
        yawB: yawToward(b, a),
    };
}
//# sourceMappingURL=lounge.js.map