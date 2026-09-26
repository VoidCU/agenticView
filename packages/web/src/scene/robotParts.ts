import * as THREE from "three";

/** Robots are scaled to office furniture: about desk-and-a-half tall. */
export const ROBOT_SCALE = 0.72;

/**
 * Geometry shared by every robot. Each robot used to build ~17 geometries of its own (225 unique
 * geometries in a 13-agent office); they are identical, so one set serves all robots. Never disposed:
 * they live for the page, like the furniture kit.
 */
let geoms: ReturnType<typeof buildGeoms> | undefined;
function buildGeoms() {
  const S = ROBOT_SCALE;
  return {
    body: new THREE.SphereGeometry(0.6, 28, 22),
    visorBox: new THREE.BoxGeometry(0.62, 0.18, 0.14),
    visorStrip: new THREE.BoxGeometry(0.5, 0.06, 0.01),
    dotEye: new THREE.SphereGeometry(0.07, 12, 12),
    eyeWhite: new THREE.SphereGeometry(0.13, 16, 16),
    pupil: new THREE.SphereGeometry(0.06, 12, 12),
    stem: new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8),
    tip: new THREE.SphereGeometry(0.09, 12, 12),
    stem2: new THREE.CylinderGeometry(0.022, 0.022, 0.28, 8),
    tip2: new THREE.SphereGeometry(0.06, 10, 10),
    crown: new THREE.TorusGeometry(0.36, 0.045, 8, 24),
    arm: new THREE.CapsuleGeometry(0.065, 0.24, 4, 10),
    hand: new THREE.SphereGeometry(0.08, 12, 10),
    base: new THREE.CylinderGeometry(0.34, 0.42, 0.16, 20),
    foot: new THREE.BoxGeometry(0.2, 0.1, 0.3),
    ring: new THREE.TorusGeometry(0.78 * S, 0.038, 8, 40),
    ringSelected: new THREE.TorusGeometry(0.86 * S, 0.038, 8, 40),
    glow: new THREE.RingGeometry(0.3 * S, 0.95 * S, 32),
    glowAccent: new THREE.RingGeometry(0.95 * S, 1.25 * S, 48),
  };
}
export function robotGeoms() {
  return (geoms ??= buildGeoms());
}

/**
 * Static (never animated) robot materials, cached by their parameters so robots with the same colours
 * share one material. With the material-type opaque sort this lets three skip the material uniform
 * refresh between consecutive robots. Animated materials (body pulse, antenna tip, glow ring) stay
 * per robot. The cache is bounded by the palette x status colours in use.
 */
const materials = new Map<string, THREE.Material>();

type StdParams = { color: string; roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number; toneMapped?: boolean };
export function stdMat(p: StdParams): THREE.MeshStandardMaterial {
  const key = `std|${p.color}|${p.roughness ?? 1}|${p.metalness ?? 0}|${p.emissive ?? ""}|${p.emissiveIntensity ?? 1}|${p.toneMapped ?? true}`;
  let m = materials.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: p.color, roughness: p.roughness ?? 1, metalness: p.metalness ?? 0 });
    if (p.emissive) {
      m.emissive.set(p.emissive);
      m.emissiveIntensity = p.emissiveIntensity ?? 1;
    }
    if (p.toneMapped === false) m.toneMapped = false;
    materials.set(key, m);
  }
  return m;
}

type PhysParams = { color: string; roughness: number; metalness: number; clearcoat: number; clearcoatRoughness: number };
export function physMat(p: PhysParams): THREE.MeshPhysicalMaterial {
  const key = `phys|${p.color}|${p.roughness}|${p.metalness}|${p.clearcoat}|${p.clearcoatRoughness}`;
  let m = materials.get(key) as THREE.MeshPhysicalMaterial | undefined;
  if (!m) {
    m = new THREE.MeshPhysicalMaterial(p);
    materials.set(key, m);
  }
  return m;
}

type BasicParams = { color: string; opacity: number };
export function basicMat(p: BasicParams): THREE.MeshBasicMaterial {
  const key = `basic|${p.color}|${p.opacity}`;
  let m = materials.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: p.color, transparent: p.opacity < 1, opacity: p.opacity, toneMapped: false });
    materials.set(key, m);
  }
  return m;
}

/** For tests: how many distinct cached materials exist. */
export function cachedMaterialCount(): number {
  return materials.size;
}
