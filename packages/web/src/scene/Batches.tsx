import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Item, Mat, Prim } from "./kit";
import type { Palette } from "./theme";

let geoms: Record<Prim, THREE.BufferGeometry> | undefined;
function geometries(): Record<Prim, THREE.BufferGeometry> {
  geoms ??= {
    box: new THREE.BoxGeometry(1, 1, 1),
    rbox: new RoundedBoxGeometry(1, 1, 1, 3, 0.12),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 28),
    sphere: new THREE.SphereGeometry(0.5, 18, 12),
    ico: new THREE.IcosahedronGeometry(0.5, 1),
    cone: new THREE.CylinderGeometry(0.22, 0.5, 1, 20, 1, true),
  };
  return geoms;
}

/** One material per slot, rebuilt when the palette changes. */
export function useMaterials(p: Palette): Record<Mat, THREE.Material> {
  const mats = useMemo(() => {
    const std = (color: string, roughness = 0.75, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    const m: Record<Mat, THREE.Material> = {
      wallBase: std(p.wallBase, 0.85),
      glass: new THREE.MeshStandardMaterial({ color: p.glass, roughness: 0.08, metalness: 0.1, transparent: true, opacity: p.glassOpacity, depthWrite: false }),
      alu: std(p.alu, 0.35, 0.7),
      deskTop: std(p.deskTop, 0.55),
      deskLeg: std(p.deskLeg, 0.5, 0.4),
      felt: std(p.felt, 0.95),
      bezel: std(p.bezel, 0.4, 0.2),
      screen: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
      keyboard: std(p.keyboard, 0.6),
      chair: std(p.chair, 0.9),
      chairBase: std(p.chairBase, 0.45, 0.5),
      pot: std(p.pot, 0.7),
      potDark: std(p.potDark, 0.8),
      leaf: std(p.leaf, 0.8, 0, { flatShading: true }),
      leaf2: std(p.leaf2, 0.8, 0, { flatShading: true }),
      shelf: std(p.shelf, 0.7),
      walnut: std(p.walnut, 0.5),
      book: std("#ffffff", 0.8),
      sofa: std(p.sofa, 0.95),
      sofa2: std(p.sofa2, 0.95),
      cushion: std(p.cushion, 0.95),
      rugOffice: std(p.rugOffice, 1),
      rugLounge: std(p.rugLounge, 1),
      rugLounge2: std(p.rugLounge2, 1),
      whiteboard: std(p.whiteboard, 0.3),
      lampGlow: new THREE.MeshBasicMaterial({ color: p.lampGlow, side: THREE.DoubleSide, toneMapped: false }),
      accent: std(p.accent, 0.5, 0.1, { emissive: p.accent, emissiveIntensity: 0.25 }),
    };
    return m;
  }, [p]);
  return mats;
}

const NO_SHADOW: ReadonlySet<Mat> = new Set<Mat>(["glass", "screen", "lampGlow", "rugOffice", "rugLounge", "rugLounge2", "accent", "book"]);

function Batch({ items, geometry, material, shadows }: { items: Item[]; geometry: THREE.BufferGeometry; material: THREE.Material; shadows: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      e.set(it.rx, it.yaw, it.rz, "YXZ");
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(it.color ?? "#ffffff"));
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={shadows} receiveShadow={shadows} raycast={() => null} />;
}

/** Draw a kit: one instanced mesh per (primitive, material). */
export function Batches({ items, materials }: { items: Item[]; materials: Record<Mat, THREE.Material> }) {
  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const key = `${it.prim}|${it.mat}`;
      let list = map.get(key);
      if (!list) map.set(key, (list = []));
      list.push(it);
    }
    return [...map.entries()];
  }, [items]);
  const g = geometries();
  return (
    <group>
      {groups.map(([key, list]) => {
        const [prim, mat] = key.split("|") as [Prim, Mat];
        // Keyed by size too: an InstancedMesh cannot grow after creation.
        return <Batch key={`${key}:${list.length}`} items={list} geometry={g[prim]} material={materials[mat]} shadows={!NO_SHADOW.has(mat)} />;
      })}
    </group>
  );
}
