/**
 * The office is a honeycomb of flat-top hexagonal rooms ("spaces").
 * Axial coordinates (q, r); world x/z on the floor plane (y up).
 * Angles are measured in the x/z plane: angle 0 points along +x, 90 degrees along +z.
 */
/** Circumradius of one hex room (center to corner). */
export const HEX_R = 5;
/** Center to the middle of a wall (where the doorway is). */
export const HEX_APOTHEM = (HEX_R * Math.sqrt(3)) / 2;
/** Everyone walks along this circle inside a room; furniture stays inside it or out in the corners. */
export const WALK_R = 2.85;
/** Widest honeycomb the office grows to. */
export const MAX_RINGS = 3;
/** Neighbour offsets. Direction i points from a center toward the doorway at angle DOOR_ANGLES[i]. */
export const AXIAL_DIRS = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
];
const DEG = Math.PI / 180;
export const DOOR_ANGLES = [30 * DEG, -30 * DEG, -90 * DEG, -150 * DEG, 150 * DEG, 90 * DEG];
export const SEATS_BY_KIND = { office: 0, pod: 4, meeting: 6, lounge: 4 };
export function axialToWorld(q, r, size = HEX_R) {
    return { x: size * 1.5 * q, z: size * Math.sqrt(3) * (r + q / 2) };
}
export function worldToAxial(x, z, size = HEX_R) {
    const qf = x / (1.5 * size);
    const rf = z / (Math.sqrt(3) * size) - qf / 2;
    // Cube rounding.
    const sf = -qf - rf;
    let q = Math.round(qf);
    let r = Math.round(rf);
    const s = Math.round(sf);
    const dq = Math.abs(q - qf);
    const dr = Math.abs(r - rf);
    const ds = Math.abs(s - sf);
    if (dq > dr && dq > ds)
        q = -r - s;
    else if (dr > ds)
        r = -q - s;
    return { q: q + 0, r: r + 0 };
}
export function hexDistance(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}
/** Hexes of ring k, walked in a fixed order. */
export function hexRing(k) {
    if (k === 0)
        return [{ q: 0, r: 0 }];
    const out = [];
    let q = AXIAL_DIRS[4][0] * k;
    let r = AXIAL_DIRS[4][1] * k;
    for (let i = 0; i < 6; i++) {
        for (let j = 0; j < k; j++) {
            out.push({ q, r });
            q += AXIAL_DIRS[i][0];
            r += AXIAL_DIRS[i][1];
        }
    }
    return out;
}
function podLetter(i) {
    let s = "";
    let n = i;
    do {
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
}
/** The camera sits toward +x/+z; pods closest to that side fill first so the busy rooms face you. */
const VIEW_ANGLE = 45 * DEG;
function viewOrder(a, b) {
    const pa = axialToWorld(a.q, a.r);
    const pb = axialToWorld(b.q, b.r);
    const da = Math.abs(angleDiff(Math.atan2(pa.z, pa.x), VIEW_ANGLE));
    const db = Math.abs(angleDiff(Math.atan2(pb.z, pb.x), VIEW_ANGLE));
    return da - db || a.q - b.q || a.r - b.r;
}
/** Pods on ring 1 (the meeting room and lounge take the two back hexes). */
const RING1_PODS = [
    [1, 0],
    [0, 1],
    [1, -1],
    [-1, 1],
];
const MEETING_HEX = [0, -1];
const LOUNGE_HEX = [-1, 0];
/** Every space of a honeycomb with `rings` rings around the manager's office (clamped to 1..MAX_RINGS). */
export function buildSpaces(rings) {
    const n = Math.max(1, Math.min(MAX_RINGS, Math.floor(rings)));
    const mk = (id, name, kind, q, r, ring) => ({ id, name, kind, q, r, ring, ...axialToWorld(q, r), seats: SEATS_BY_KIND[kind] });
    const out = [mk("office", "Manager's Office", "office", 0, 0, 0)];
    let pod = 0;
    const addPod = (q, r, ring) => {
        const letter = podLetter(pod++);
        out.push(mk(`pod-${letter.toLowerCase()}`, `Pod ${letter}`, "pod", q, r, ring));
    };
    for (const [q, r] of RING1_PODS)
        addPod(q, r, 1);
    out.push(mk("meeting", "Meeting Room", "meeting", MEETING_HEX[0], MEETING_HEX[1], 1));
    out.push(mk("lounge", "Lounge", "lounge", LOUNGE_HEX[0], LOUNGE_HEX[1], 1));
    for (let k = 2; k <= n; k++) {
        for (const h of hexRing(k).sort(viewOrder))
            addPod(h.q, h.r, k);
    }
    return out;
}
export function podCount(rings) {
    return buildSpaces(rings).filter((s) => s.kind === "pod").length;
}
/** Id of the pod with the given index (0 → pod-a), independent of ring count. */
export function podId(index) {
    return `pod-${podLetter(index).toLowerCase()}`;
}
/** Rings needed to seat `workers` in pods with at least one desk to spare. */
export function ringsFor(workers) {
    for (let k = 1; k <= MAX_RINGS; k++) {
        if (podCount(k) * SEATS_BY_KIND.pod > workers)
            return k;
    }
    return MAX_RINGS;
}
export function spaceAt(spaces, x, z) {
    const { q, r } = worldToAxial(x, z);
    return spaces.find((s) => s.q === q && s.r === r);
}
export function neighbors(spaces, s) {
    const out = [];
    AXIAL_DIRS.forEach(([dq, dr], dir) => {
        const n = spaces.find((o) => o.q === s.q + dq && o.r === s.r + dr);
        if (n)
            out.push({ dir, space: n });
    });
    return out;
}
/** World-space midpoint of the doorway in wall `dir` of space `s`. */
export function doorPoint(s, dir) {
    const a = DOOR_ANGLES[dir];
    return { x: s.x + HEX_APOTHEM * Math.cos(a), z: s.z + HEX_APOTHEM * Math.sin(a) };
}
/** The six corners of a space, starting at angle 0 and going counter-clockwise in angle. */
export function hexCorners(s, radius = HEX_R) {
    return Array.from({ length: 6 }, (_, i) => ({ x: s.x + radius * Math.cos(i * 60 * DEG), z: s.z + radius * Math.sin(i * 60 * DEG) }));
}
export function yawToward(from, to) {
    return Math.atan2(to.x - from.x, to.z - from.z);
}
/** Local seat layout of each kind, relative to the space center. */
export function seatLocal(kind, seat) {
    switch (kind) {
        case "pod": {
            // A 2x2 desk cluster, desks back to back; each robot sits outside facing its monitor.
            const sx = seat % 2 === 0 ? -0.65 : 0.65;
            const sz = seat < 2 ? -1.22 : 1.22;
            return { x: sx, z: sz, yaw: sz < 0 ? 0 : Math.PI };
        }
        case "meeting": {
            const a = seat * 60 * DEG;
            const p = { x: 1.9 * Math.cos(a), z: 1.9 * Math.sin(a) };
            return { ...p, yaw: yawToward(p, { x: 0, z: 0 }) };
        }
        case "lounge": {
            const a = (45 + seat * 90) * DEG;
            const p = { x: 1.6 * Math.cos(a), z: 1.6 * Math.sin(a) };
            return { ...p, yaw: yawToward(p, { x: 0, z: 0 }) };
        }
        default:
            return { x: 0, z: 0, yaw: 0 };
    }
}
export function seatPose(s, seat) {
    const l = seatLocal(s.kind, seat);
    return { x: s.x + l.x, z: s.z + l.z, yaw: l.yaw };
}
/** Where the manager stands in its own office: behind the desk, looking toward the camera. */
export function managerHome(s) {
    const a = 225 * DEG;
    return { x: s.x + 1.35 * Math.cos(a), z: s.z + 1.35 * Math.sin(a), yaw: Math.PI / 4 };
}
/** Where the manager stops to talk to whoever sits at `seat`: a step toward the walkway, facing them. */
export function visitPose(s, seat) {
    const l = seatLocal(s.kind, seat);
    const a = Math.atan2(l.z, l.x);
    const rr = Math.hypot(l.x, l.z) + 1.05;
    const p = { x: s.x + rr * Math.cos(a), z: s.z + rr * Math.sin(a) };
    return { ...p, yaw: yawToward(p, { x: s.x + l.x, z: s.z + l.z }) };
}
// ---------- routing ----------
export function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI)
        d -= 2 * Math.PI;
    while (d < -Math.PI)
        d += 2 * Math.PI;
    return d;
}
function ringPoint(s, a, radius = WALK_R) {
    return { x: s.x + radius * Math.cos(a), z: s.z + radius * Math.sin(a) };
}
/** Walk the walkway circle from angle a to angle b the short way, in steps of at most 30 degrees. */
function arc(s, a, b) {
    const d = angleDiff(b, a);
    const steps = Math.max(1, Math.ceil(Math.abs(d) / (30 * DEG) - 1e-9));
    const out = [];
    for (let i = 1; i <= steps; i++)
        out.push(ringPoint(s, a + (d * i) / steps));
    return out;
}
/** Cheapest chain of spaces from a to b. Crossing the meeting room or lounge costs more than going round. */
export function spacePath(spaces, from, to) {
    const dist = new Map([[from.id, 0]]);
    const prev = new Map();
    const open = new Set([from.id]);
    const byId = new Map(spaces.map((s) => [s.id, s]));
    while (open.size) {
        let cur;
        for (const id of open)
            if (!cur || dist.get(id) < dist.get(cur.id))
                cur = byId.get(id);
        if (!cur)
            break;
        open.delete(cur.id);
        if (cur.id === to.id)
            break;
        for (const { space: n } of neighbors(spaces, cur)) {
            const step = n.id !== to.id && (n.kind === "meeting" || n.kind === "lounge") ? 4 : 1;
            const nd = dist.get(cur.id) + step;
            if (nd < (dist.get(n.id) ?? Infinity)) {
                dist.set(n.id, nd);
                prev.set(n.id, cur);
                open.add(n.id);
            }
        }
    }
    if (!dist.has(to.id))
        return [from, to];
    const chain = [to];
    while (chain[0].id !== from.id)
        chain.unshift(prev.get(chain[0].id));
    return chain;
}
function dirBetween(a, b) {
    return AXIAL_DIRS.findIndex(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}
/**
 * Waypoints from `from` to `to`, never crossing a wall: step out to the room's walkway,
 * go round it to a doorway, through the doorway, and so on until the target room, then step in to the target.
 * The first point is `from` itself.
 */
export function route(spaces, from, to) {
    const a = spaceAt(spaces, from.x, from.z) ?? spaces[0];
    const b = spaceAt(spaces, to.x, to.z) ?? spaces[0];
    const pts = [{ x: from.x, z: from.z }];
    const chain = spacePath(spaces, a, b);
    let angle = Math.atan2(from.z - a.z, from.x - a.x);
    pts.push(ringPoint(a, angle));
    for (let i = 0; i < chain.length - 1; i++) {
        const cur = chain[i];
        const next = chain[i + 1];
        const dir = dirBetween(cur, next);
        if (dir < 0)
            continue;
        const doorAngle = DOOR_ANGLES[dir];
        pts.push(...arc(cur, angle, doorAngle));
        pts.push(doorPoint(cur, dir));
        angle = doorAngle + Math.PI;
        pts.push(ringPoint(next, angle));
    }
    const targetAngle = Math.atan2(to.z - b.z, to.x - b.x);
    pts.push(...arc(b, angle, targetAngle));
    pts.push({ x: to.x, z: to.z });
    return dedupe(pts);
}
function dedupe(pts) {
    const out = [];
    for (const p of pts) {
        const last = out[out.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 1e-3)
            out.push(p);
    }
    return out;
}
export function pathLength(pts) {
    let n = 0;
    for (let i = 1; i < pts.length; i++)
        n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    return n;
}
// ---------- seating ----------
function byCreation(a, b) {
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
/**
 * Resolve every worker's seat. Workers keep a valid persisted placement (first come by creation wins a
 * contested seat); everyone else fills free pod desks in pod order. The honeycomb grows a ring only
 * when every pod desk of the existing rings is taken: a persisted placement in a ring the roster does
 * not need (a stale seat from a bigger roster, or a global agent seated in another world) is ignored
 * and that worker is reseated inside.
 */
export function planOffice(agents) {
    const workers = agents.filter((a) => a.role === "worker").sort(byCreation);
    const spaces = buildSpaces(ringsFor(workers.length));
    const byId = new Map(spaces.map((s) => [s.id, s]));
    const taken = new Set();
    const placements = {};
    const key = (p) => `${p.space}#${p.seat}`;
    for (const w of workers) {
        const p = w.placement;
        const s = p && byId.get(p.space);
        if (!p || !s || p.seat < 0 || p.seat >= s.seats || taken.has(key(p)))
            continue;
        placements[w.id] = { space: p.space, seat: p.seat };
        taken.add(key(p));
    }
    for (const w of workers) {
        if (placements[w.id])
            continue;
        const free = firstFreeSeat(spaces, taken);
        if (!free)
            continue;
        placements[w.id] = free;
        taken.add(key(free));
    }
    return { spaces, placements };
}
export function firstFreeSeat(spaces, taken) {
    for (const s of spaces) {
        if (s.kind !== "pod")
            continue;
        for (let seat = 0; seat < s.seats; seat++)
            if (!taken.has(`${s.id}#${seat}`))
                return { space: s.id, seat };
    }
    return undefined;
}
/** The seat a newly created worker would take. */
export function nextPlacement(agents) {
    const plan = planOffice(agents);
    const taken = new Set(Object.values(plan.placements).map((p) => `${p.space}#${p.seat}`));
    return firstFreeSeat(plan.spaces, taken) ?? firstFreeSeat(buildSpaces(MAX_RINGS), taken);
}
/** Find a space by id or (case-insensitive) name. */
export function findSpace(spaces, ref) {
    const k = ref.trim().toLowerCase();
    return spaces.find((s) => s.id === k || s.name.toLowerCase() === k) ?? spaces.find((s) => s.id === k.replace(/\s+/g, "-"));
}
/** Everywhere a worker could be moved to: every seat of the current honeycomb (it grows by itself when full). */
export function assignableSpaces(agents) {
    return planOffice(agents).spaces.filter((s) => s.seats > 0);
}
//# sourceMappingURL=office.js.map