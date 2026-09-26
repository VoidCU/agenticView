/**
 * Solid obstacles extracted from an OfficeLayout.
 *
 * Provides a unified list of 2D XZ collision obstacles (boxes and circles) representing
 * furniture (desks, chairs, shelves, sofas, tables, plants, credenzas) and walls (glass
 * partitions and honeycomb walls with doorway gaps).
 *
 * Used by WalkMode and collision systems (scene/colliders.ts) to resolve player
 * and agent movement against the 3D scene's physical obstacles.
 */
import {
  AXIAL_DIRS,
  DOOR_ANGLES,
  HEX_R,
  seatLocal,
  yawToward,
  managerHome,
  loungeSpots,
  type Space,
} from "@agenticview/shared";
import type { OfficeLayout } from "./layout";

export interface SolidBox {
  kind: string;
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
}

export interface SolidCircle {
  kind: string;
  x: number;
  z: number;
  r: number;
}

export type SolidObstacle = SolidBox | SolidCircle;

const DEG = Math.PI / 180;
const DOOR_W = 1.8;
const WALL_THICKNESS = 0.1;

/** Pose of corner furniture in a hexagonal space. */
function cornerPose(s: Space, angleDeg: number, at = 4.55): { x: number; z: number; rot: number } {
  const dist = (at * HEX_R) / 6;
  const a = angleDeg * DEG;
  const lx = dist * Math.cos(a);
  const lz = dist * Math.sin(a);
  const yaw = yawToward({ x: lx, z: lz }, { x: 0, z: 0 });
  return { x: s.x + lx, z: s.z + lz, rot: yaw };
}

/**
 * Returns all solid obstacles (walls, partitions, desks, chairs, tables, shelves, credenzas, sofas, plants)
 * for the given office layout.
 */
export function solidsForLayout(layout: OfficeLayout): SolidObstacle[] {
  const solids: SolidObstacle[] = [];
  const spaces = layout.spaces;
  const has = (q: number, r: number) => spaces.some((s) => s.q === q && s.r === r);

  // 1. Honeycomb walls and doorway openings
  for (const s of spaces) {
    AXIAL_DIRS.forEach(([dq, dr], dir) => {
      const nq = s.q + dq;
      const nr = s.r + dr;
      const shared = has(nq, nr);
      // Build a shared wall from the room with the smaller (q, r) only.
      if (shared && (nq < s.q || (nq === s.q && nr < s.r))) return;
      const n = DOOR_ANGLES[dir]!;
      const c1 = { x: s.x + HEX_R * Math.cos(n - 30 * DEG), z: s.z + HEX_R * Math.sin(n - 30 * DEG) };
      const c2 = { x: s.x + HEX_R * Math.cos(n + 30 * DEG), z: s.z + HEX_R * Math.sin(n + 30 * DEG) };
      const rot = Math.atan2(c2.x - c1.x, c2.z - c1.z) - Math.PI / 2;

      if (!shared) {
        // Solid outer wall partition
        const mx = (c1.x + c2.x) / 2;
        const mz = (c1.z + c2.z) / 2;
        const len = Math.hypot(c2.x - c1.x, c2.z - c1.z);
        solids.push({ kind: "wall", x: mx, z: mz, w: len, d: WALL_THICKNESS, rot });
        return;
      }

      // Shared wall with doorway gap in the center
      const ux = (c2.x - c1.x) / HEX_R;
      const uz = (c2.z - c1.z) / HEX_R;
      const segLen = (HEX_R - DOOR_W) / 2;
      const g1 = { x: c1.x + ux * segLen, z: c1.z + uz * segLen };
      const g2 = { x: c2.x - ux * segLen, z: c2.z - uz * segLen };

      solids.push({ kind: "wall", x: (c1.x + g1.x) / 2, z: (c1.z + g1.z) / 2, w: segLen, d: WALL_THICKNESS, rot });
      solids.push({ kind: "wall", x: (c2.x + g2.x) / 2, z: (c2.z + g2.z) / 2, w: segLen, d: WALL_THICKNESS, rot });
    });
  }

  // 2. Interior furniture per space
  for (const s of spaces) {
    switch (s.kind) {
      case "pod": {
        // Desks and chairs for 6 pod seats (2 rows of 3)
        for (let seat = 0; seat < s.seats; seat++) {
          const l = seatLocal("pod", seat);
          const dz = l.z < 0 ? -0.36 : 0.36;
          const deskRot = l.z < 0 ? Math.PI : 0;
          solids.push({ kind: "desk", x: s.x + l.x, z: s.z + dz, w: 1.24, d: 0.66, rot: deskRot });
          solids.push({ kind: "chair", x: s.x + l.x, z: s.z + l.z + (l.z < 0 ? -0.1 : 0.1), w: 0.5, d: 0.5, rot: l.yaw });
        }
        // Felt privacy screen partition
        solids.push({ kind: "partition", x: s.x, z: s.z, w: 3.8, d: 0.06, rot: 0 });

        // Corners
        const b180 = cornerPose(s, 180);
        solids.push({ kind: "shelf", x: b180.x, z: b180.z, w: 1.3, d: 0.36, rot: b180.rot });
        const w240 = cornerPose(s, 240, 4.4);
        solids.push({ kind: "whiteboard", x: w240.x, z: w240.z, w: 1.7, d: 0.1, rot: w240.rot });
        const c300 = cornerPose(s, 300);
        solids.push({ kind: "credenza", x: c300.x, z: c300.z, w: 1.6, d: 0.46, rot: c300.rot });
        const p0 = cornerPose(s, 0, 4.7);
        solids.push({ kind: "plant", x: p0.x, z: p0.z, r: 0.55 });
        const p120 = cornerPose(s, 120, 4.7);
        solids.push({ kind: "plant", x: p120.x, z: p120.z, r: 0.45 });
        const c60 = cornerPose(s, 60, 4.7);
        solids.push({ kind: "credenza", x: c60.x, z: c60.z, w: 1.6, d: 0.46, rot: c60.rot });
        break;
      }

      case "office": {
        const home = managerHome({ ...s, x: 0, z: 0 });
        const toCam = { x: Math.cos(45 * DEG), z: Math.sin(45 * DEG) };
        const deskAt = { x: home.x + toCam.x * 0.78, z: home.z + toCam.z * 0.78 };
        const rot = yawToward(deskAt, home);
        solids.push({ kind: "desk", x: s.x + deskAt.x, z: s.z + deskAt.z, w: 2.1, d: 0.95, rot });

        const front = { x: deskAt.x + toCam.x * 1.05, z: deskAt.z + toCam.z * 1.05 };
        for (const side of [-0.62, 0.62]) {
          const p = { x: front.x + side * toCam.z, z: front.z - side * toCam.x };
          solids.push({ kind: "chair", x: s.x + p.x, z: s.z + p.z, w: 0.5, d: 0.5, rot: yawToward(p, home) });
        }

        const b180 = cornerPose(s, 180, 4.5);
        solids.push({ kind: "shelf", x: b180.x, z: b180.z, w: 1.3, d: 0.36, rot: b180.rot });
        const w240 = cornerPose(s, 240, 4.4);
        solids.push({ kind: "whiteboard", x: w240.x, z: w240.z, w: 1.7, d: 0.1, rot: w240.rot });
        const c300 = cornerPose(s, 300);
        solids.push({ kind: "credenza", x: c300.x, z: c300.z, w: 1.6, d: 0.46, rot: c300.rot });
        const a0 = cornerPose(s, 0, 4.4);
        solids.push({ kind: "sofa", x: a0.x, z: a0.z, w: 0.95, d: 0.86, rot: a0.rot });
        const p60 = cornerPose(s, 60, 4.8);
        solids.push({ kind: "plant", x: p60.x, z: p60.z, r: 0.6 });
        const p120 = cornerPose(s, 120, 4.7);
        solids.push({ kind: "plant", x: p120.x, z: p120.z, r: 0.5 });
        break;
      }

      case "meeting": {
        // Walnut meeting table (radius 1.7)
        solids.push({ kind: "table", x: s.x, z: s.z, r: 1.7 });
        for (let seat = 0; seat < s.seats; seat++) {
          const l = seatLocal("meeting", seat);
          const back = Math.hypot(l.x, l.z) + 0.12;
          const a = Math.atan2(l.z, l.x);
          solids.push({ kind: "chair", x: s.x + back * Math.cos(a), z: s.z + back * Math.sin(a), w: 0.5, d: 0.5, rot: l.yaw });
        }

        const t240 = cornerPose(s, 240, 4.5);
        solids.push({ kind: "shelf", x: t240.x, z: t240.z, w: 1.9, d: 0.6, rot: t240.rot });
        const w180 = cornerPose(s, 180, 4.4);
        solids.push({ kind: "whiteboard", x: w180.x, z: w180.z, w: 1.7, d: 0.1, rot: w180.rot });
        const c300 = cornerPose(s, 300);
        solids.push({ kind: "credenza", x: c300.x, z: c300.z, w: 1.6, d: 0.46, rot: c300.rot });
        const p0 = cornerPose(s, 0, 4.7);
        solids.push({ kind: "plant", x: p0.x, z: p0.z, r: 0.55 });
        const p60 = cornerPose(s, 60, 4.8);
        solids.push({ kind: "plant", x: p60.x, z: p60.z, r: 0.45 });
        const p120 = cornerPose(s, 120, 4.7);
        solids.push({ kind: "plant", x: p120.x, z: p120.z, r: 0.6 });
        break;
      }

      case "lounge": {
        // Coffee table at center (radius 0.75)
        solids.push({ kind: "table", x: s.x, z: s.z, r: 0.75 });

        // Use loungeSpots furniture for collision obstacles (matches kit.ts rendering exactly)
        const { furniture: loungeFurniture } = loungeSpots();
        for (const fp of loungeFurniture) {
          const wx = s.x + fp.x;
          const wz = s.z + fp.z;
          if (fp.kind === "sofa") {
            const sofaW = fp.seats >= 3 ? 2.6 : 1.9;
            solids.push({ kind: "sofa", x: wx, z: wz, w: sofaW, d: 0.86, rot: fp.yaw });
          } else if (fp.kind === "armchair") {
            solids.push({ kind: "sofa", x: wx, z: wz, w: 0.95, d: 0.86, rot: fp.yaw });
          } else if (fp.kind === "counter") {
            solids.push({ kind: "credenza", x: wx, z: wz, w: 1.94, d: 0.66, rot: fp.yaw });
          } else if (fp.kind === "beanbag") {
            solids.push({ kind: "chair", x: wx, z: wz, w: 0.64, d: 0.64, rot: fp.yaw });
          }
        }

        // Corner decor plants
        const l120 = cornerPose(s, 120, 4.6);
        solids.push({ kind: "plant", x: l120.x, z: l120.z, r: 0.25 });
        const p0 = cornerPose(s, 0, 4.7);
        solids.push({ kind: "plant", x: p0.x, z: p0.z, r: 0.6 });
        break;
      }
    }
  }

  return solids;
}
