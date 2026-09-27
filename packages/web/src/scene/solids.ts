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
import {
  ARMCHAIR_W,
  BACKDROP_STAND,
  COUNTER_D,
  CREDENZA_SIZE,
  DESK_SIZE,
  EDIT_DESK,
  EXEC_DESK_SIZE,
  GLOBE,
  MYOFFICE_PROPS,
  MY_DESK,
  PRIVACY_SCREEN,
  PRODUCTION_PROPS,
  READING_TABLE,
  RESEARCH_PROPS,
  SCOREBOARD_STAND,
  SHELF_SIZE,
  SIDE_TABLE_D,
  SOFA_D,
  SOFTBOX_BASE_D,
  TRIPOD,
  TV_STAND,
  WHITEBOARD_SLOT,
  WHITEBOARD_STAND,
  cornerFrame,
  myOfficeChairFrame,
  researchShelfFrames,
  scoreboardFrame,
  wallSide,
} from "./kit";

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
/** Chair collider = the seat footprint only (kit chair seat box 0.5 x 0.48), not the swivel base. */
export const CHAIR_W = 0.5;
export const CHAIR_D = 0.48;
/** Plant collider = the pot (kit plant pot diameter 0.42 * size), not the foliage above it. */
export const potRadius = (size: number) => 0.21 * size;

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

  // 1. Honeycomb walls and doorway openings (no doorway in outer walls or walls carrying a screen)
  for (const s of spaces) {
    AXIAL_DIRS.forEach(([dq, dr], dir) => {
      const nq = s.q + dq;
      const nr = s.r + dr;
      const { neighbor, open } = wallSide(spaces, s, dir);
      // Build a shared wall from the room with the smaller (q, r) only.
      if (neighbor && (nq < s.q || (nq === s.q && nr < s.r))) return;
      const n = DOOR_ANGLES[dir]!;
      const c1 = { x: s.x + HEX_R * Math.cos(n - 30 * DEG), z: s.z + HEX_R * Math.sin(n - 30 * DEG) };
      const c2 = { x: s.x + HEX_R * Math.cos(n + 30 * DEG), z: s.z + HEX_R * Math.sin(n + 30 * DEG) };
      const rot = Math.atan2(c2.x - c1.x, c2.z - c1.z) - Math.PI / 2;

      if (!open) {
        // Solid wall: outer, or a screen wall between two rooms
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
          solids.push({ kind: "desk", x: s.x + l.x, z: s.z + dz, w: DESK_SIZE.w, d: DESK_SIZE.d, rot: deskRot });
          solids.push({ kind: "chair", x: s.x + l.x, z: s.z + l.z + (l.z < 0 ? -0.1 : 0.1), w: CHAIR_W, d: CHAIR_D, rot: l.yaw });
        }
        // Felt privacy screen partition
        solids.push({ kind: "partition", x: s.x, z: s.z, w: PRIVACY_SCREEN.w, d: PRIVACY_SCREEN.d, rot: 0 });

        // Corners
        const b180 = cornerPose(s, 180);
        solids.push({ kind: "shelf", x: b180.x, z: b180.z, w: SHELF_SIZE.w, d: SHELF_SIZE.d, rot: b180.rot });
        const w240 = cornerPose(s, 240, 4.4);
        solids.push({ kind: "whiteboard", x: w240.x, z: w240.z, w: WHITEBOARD_STAND.w, d: WHITEBOARD_STAND.d, rot: w240.rot });
        const c300 = cornerPose(s, 300);
        solids.push({ kind: "credenza", x: c300.x, z: c300.z, w: CREDENZA_SIZE.w, d: CREDENZA_SIZE.d, rot: c300.rot });
        const p0 = cornerPose(s, 0, 4.7);
        solids.push({ kind: "plant", x: p0.x, z: p0.z, r: potRadius(1.1) });
        const p120 = cornerPose(s, 120, 4.7);
        solids.push({ kind: "plant", x: p120.x, z: p120.z, r: potRadius(0.9) });
        const c60 = cornerPose(s, 60, 4.7);
        solids.push({ kind: "credenza", x: c60.x, z: c60.z, w: CREDENZA_SIZE.w, d: CREDENZA_SIZE.d, rot: c60.rot });
        break;
      }

      case "office": {
        const home = managerHome({ ...s, x: 0, z: 0 });
        const toCam = { x: Math.cos(45 * DEG), z: Math.sin(45 * DEG) };
        const deskAt = { x: home.x + toCam.x * 0.78, z: home.z + toCam.z * 0.78 };
        const rot = yawToward(deskAt, home);
        solids.push({ kind: "desk", x: s.x + deskAt.x, z: s.z + deskAt.z, w: EXEC_DESK_SIZE.w, d: EXEC_DESK_SIZE.d, rot });

        const front = { x: deskAt.x + toCam.x * 1.05, z: deskAt.z + toCam.z * 1.05 };
        for (const side of [-0.62, 0.62]) {
          const p = { x: front.x + side * toCam.z, z: front.z - side * toCam.x };
          solids.push({ kind: "chair", x: s.x + p.x, z: s.z + p.z, w: CHAIR_W, d: CHAIR_D, rot: yawToward(p, home) });
        }

        const b180 = cornerPose(s, 180, 4.5);
        solids.push({ kind: "shelf", x: b180.x, z: b180.z, w: SHELF_SIZE.w, d: SHELF_SIZE.d, rot: b180.rot });
        const w240 = cornerPose(s, 240, 4.4);
        solids.push({ kind: "whiteboard", x: w240.x, z: w240.z, w: WHITEBOARD_STAND.w, d: WHITEBOARD_STAND.d, rot: w240.rot });
        const c300 = cornerPose(s, 300);
        solids.push({ kind: "credenza", x: c300.x, z: c300.z, w: CREDENZA_SIZE.w, d: CREDENZA_SIZE.d, rot: c300.rot });
        const a0 = cornerPose(s, 0, 4.4);
        solids.push({ kind: "sofa", x: a0.x, z: a0.z, w: ARMCHAIR_W, d: SOFA_D, rot: a0.rot });
        const p60 = cornerPose(s, 60, 4.8);
        solids.push({ kind: "plant", x: p60.x, z: p60.z, r: potRadius(1.25) });
        const p120 = cornerPose(s, 120, 4.7);
        solids.push({ kind: "plant", x: p120.x, z: p120.z, r: potRadius(1.0) });
        break;
      }

      case "meeting": {
        // Walnut meeting table (radius 2.1) — scaled up for bigger rooms
        solids.push({ kind: "table", x: s.x, z: s.z, r: 2.1 });
        for (let seat = 0; seat < s.seats; seat++) {
          const l = seatLocal("meeting", seat);
          const back = Math.hypot(l.x, l.z) + 0.12;
          const a = Math.atan2(l.z, l.x);
          solids.push({ kind: "chair", x: s.x + back * Math.cos(a), z: s.z + back * Math.sin(a), w: CHAIR_W, d: CHAIR_D, rot: l.yaw });
        }

        const t240 = cornerPose(s, 240, 4.5);
        // TV stand as drawn: the thin screen plus its two feet. (It used to be one solid 1.9 x 0.6 block,
        // an invisible wall 0.27 deep in front of and behind the open stand.)
        solids.push({ kind: "tv", x: t240.x, z: t240.z, w: TV_STAND.w, d: TV_STAND.d, rot: t240.rot });
        for (const lx of [-TV_STAND.legX, TV_STAND.legX]) {
          const c = Math.cos(t240.rot);
          const sn = Math.sin(t240.rot);
          solids.push({ kind: "tv", x: t240.x + lx * c, z: t240.z - lx * sn, w: TV_STAND.footW, d: TV_STAND.footD, rot: t240.rot });
        }
        const w180 = cornerPose(s, 180, 4.4);
        solids.push({ kind: "whiteboard", x: w180.x, z: w180.z, w: WHITEBOARD_STAND.w, d: WHITEBOARD_STAND.d, rot: w180.rot });
        const c300 = cornerPose(s, 300);
        solids.push({ kind: "credenza", x: c300.x, z: c300.z, w: CREDENZA_SIZE.w, d: CREDENZA_SIZE.d, rot: c300.rot });
        const p0 = cornerPose(s, 0, 4.7);
        solids.push({ kind: "plant", x: p0.x, z: p0.z, r: potRadius(1.1) });
        const p60 = cornerPose(s, 60, 4.8);
        solids.push({ kind: "plant", x: p60.x, z: p60.z, r: potRadius(0.8) });
        const p120 = cornerPose(s, 120, 4.7);
        solids.push({ kind: "plant", x: p120.x, z: p120.z, r: potRadius(1.2) });
        break;
      }

      case "lounge": {
        // Coffee table at center — use tableR from layout to match rendering
        const { furniture: loungeFurniture, tableR } = loungeSpots();
        solids.push({ kind: "table", x: s.x, z: s.z, r: tableR });

        // Use loungeSpots furniture for collision obstacles (matches kit.ts rendering exactly).
        // fp.w and fp.d are the layout footprint dimensions at the current scale.
        for (const fp of loungeFurniture) {
          const wx = s.x + fp.x;
          const wz = s.z + fp.z;
          if (fp.kind === "sofa") {
            solids.push({ kind: "sofa", x: wx, z: wz, w: fp.w, d: SOFA_D, rot: fp.yaw });
          } else if (fp.kind === "armchair") {
            solids.push({ kind: "sofa", x: wx, z: wz, w: fp.w, d: SOFA_D, rot: fp.yaw });
          } else if (fp.kind === "counter") {
            solids.push({ kind: "credenza", x: wx, z: wz, w: fp.w, d: COUNTER_D, rot: fp.yaw });
          } else if (fp.kind === "beanbag") {
            solids.push({ kind: "beanbag", x: wx, z: wz, w: fp.w, d: fp.d, rot: fp.yaw });
          }
        }

        // Corner decor, as kit loungeRoom draws it: floor lamp (base 0.34) at 120, plants 1.2 at 0 and 0.8 at 60.
        const l120 = cornerPose(s, 120, 4.6);
        solids.push({ kind: "lamp", x: l120.x, z: l120.z, r: 0.17 });
        const p0 = cornerPose(s, 0, 4.7);
        solids.push({ kind: "plant", x: p0.x, z: p0.z, r: potRadius(1.2) });
        const p60 = cornerPose(s, 60, 4.8);
        solids.push({ kind: "plant", x: p60.x, z: p60.z, r: potRadius(0.8) });
        // Scoreboard stand beside the 180 corner (kit loungeRoom / LoungeScoreboard).
        const sb = scoreboardFrame();
        solids.push({ kind: "scoreboard", x: s.x + sb.x, z: s.z + sb.z, w: SCOREBOARD_STAND.w, d: SCOREBOARD_STAND.d, rot: sb.yaw });
        break;
      }

      case "myoffice": {
        solids.push({ kind: "desk", x: s.x + MY_DESK.x, z: s.z + MY_DESK.z, w: MY_DESK.w, d: MY_DESK.d, rot: MY_DESK.yaw });
        const ch = myOfficeChairFrame();
        solids.push({ kind: "chair", x: s.x + ch.x, z: s.z + ch.z, w: CHAIR_W, d: CHAIR_D, rot: ch.yaw });
        const sofa = cornerPose(s, MYOFFICE_PROPS.sofa.angleDeg, MYOFFICE_PROPS.sofa.at);
        solids.push({ kind: "sofa", x: sofa.x, z: sofa.z, w: MYOFFICE_PROPS.sofa.w, d: SOFA_D, rot: sofa.rot });
        // Side table in the sofa's frame (local +x = (cos rot, -sin rot)).
        const tx = MYOFFICE_PROPS.sideTableX;
        solids.push({ kind: "table", x: sofa.x + tx * Math.cos(sofa.rot), z: sofa.z - tx * Math.sin(sofa.rot), r: SIDE_TABLE_D / 2 });
        const arm = cornerPose(s, MYOFFICE_PROPS.armchair.angleDeg, MYOFFICE_PROPS.armchair.at);
        solids.push({ kind: "sofa", x: arm.x, z: arm.z, w: ARMCHAIR_W, d: SOFA_D, rot: arm.rot });
        const lx = MYOFFICE_PROPS.lampX;
        solids.push({ kind: "lamp", x: arm.x + lx * Math.cos(arm.rot), z: arm.z - lx * Math.sin(arm.rot), r: 0.17 });
        for (const p of MYOFFICE_PROPS.plants) {
          const c = cornerPose(s, p.angleDeg, p.at);
          solids.push({ kind: "plant", x: c.x, z: c.z, r: potRadius(p.size) });
        }
        const cr = cornerPose(s, MYOFFICE_PROPS.credenza.angleDeg, MYOFFICE_PROPS.credenza.at);
        solids.push({ kind: "credenza", x: cr.x, z: cr.z, w: CREDENZA_SIZE.w, d: CREDENZA_SIZE.d, rot: cr.rot });
        break;
      }

      case "production": {
        for (let seat = 0; seat < s.seats; seat++) {
          const l = seatLocal("production", seat);
          const d = { x: l.x, z: -0.6 };
          solids.push({ kind: "desk", x: s.x + d.x, z: s.z + d.z, w: EDIT_DESK.w, d: EDIT_DESK.d, rot: 0 });
          solids.push({ kind: "chair", x: s.x + l.x, z: s.z + l.z + 0.1, w: CHAIR_W, d: CHAIR_D, rot: l.yaw });
        }
        const bd = cornerFrame(PRODUCTION_PROPS.backdrop.angleDeg, PRODUCTION_PROPS.backdrop.at);
        solids.push({ kind: "backdrop", x: s.x + bd.x, z: s.z + bd.z, w: BACKDROP_STAND.w, d: BACKDROP_STAND.d, rot: bd.yaw });
        solids.push({ kind: "tripod", x: s.x + PRODUCTION_PROPS.tripod.x, z: s.z + PRODUCTION_PROPS.tripod.z, r: TRIPOD.r });
        const sb = cornerPose(s, PRODUCTION_PROPS.softbox.angleDeg, PRODUCTION_PROPS.softbox.at);
        solids.push({ kind: "lamp", x: sb.x, z: sb.z, r: SOFTBOX_BASE_D / 2 - 0.02 });
        const rack = cornerPose(s, PRODUCTION_PROPS.rack.angleDeg, PRODUCTION_PROPS.rack.at);
        solids.push({ kind: "credenza", x: rack.x, z: rack.z, w: CREDENZA_SIZE.w, d: CREDENZA_SIZE.d, rot: rack.rot });
        const wb = cornerPose(s, WHITEBOARD_SLOT.production.angleDeg, WHITEBOARD_SLOT.production.at);
        solids.push({ kind: "whiteboard", x: wb.x, z: wb.z, w: WHITEBOARD_STAND.w, d: WHITEBOARD_STAND.d, rot: wb.rot });
        for (const p of PRODUCTION_PROPS.plants) {
          const c = cornerPose(s, p.angleDeg, p.at);
          solids.push({ kind: "plant", x: c.x, z: c.z, r: potRadius(p.size) });
        }
        break;
      }

      case "research": {
        solids.push({ kind: "table", x: s.x + READING_TABLE.x, z: s.z + READING_TABLE.z, w: READING_TABLE.w, d: READING_TABLE.d, rot: 0 });
        for (let seat = 0; seat < s.seats; seat++) {
          const l = seatLocal("research", seat);
          const back = l.z < 0 ? -1 : 1;
          solids.push({ kind: "chair", x: s.x + l.x, z: s.z + l.z + back * 0.1, w: CHAIR_W, d: CHAIR_D, rot: l.yaw });
        }
        for (const f of researchShelfFrames()) solids.push({ kind: "shelf", x: s.x + f.x, z: s.z + f.z, w: SHELF_SIZE.w, d: SHELF_SIZE.d, rot: f.yaw });
        const pin = cornerPose(s, RESEARCH_PROPS.pinboard.angleDeg, RESEARCH_PROPS.pinboard.at);
        solids.push({ kind: "whiteboard", x: pin.x, z: pin.z, w: WHITEBOARD_STAND.w, d: WHITEBOARD_STAND.d, rot: pin.rot });
        const g = cornerPose(s, RESEARCH_PROPS.globe.angleDeg, RESEARCH_PROPS.globe.at);
        solids.push({ kind: "globe", x: g.x, z: g.z, r: GLOBE.base / 2 });
        const wb = cornerPose(s, WHITEBOARD_SLOT.research.angleDeg, WHITEBOARD_SLOT.research.at);
        solids.push({ kind: "whiteboard", x: wb.x, z: wb.z, w: WHITEBOARD_STAND.w, d: WHITEBOARD_STAND.d, rot: wb.rot });
        for (const p of RESEARCH_PROPS.plants) {
          const c = cornerPose(s, p.angleDeg, p.at);
          solids.push({ kind: "plant", x: c.x, z: c.z, r: potRadius(p.size) });
        }
        break;
      }
    }
  }

  return solids;
}
