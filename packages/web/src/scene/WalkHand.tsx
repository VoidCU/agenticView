/**
 * The walker's first-person hand (a cartoon glove): built once from a few boxes sharing one geometry
 * and one material, hidden while idle, and posed from handGesture.ts during a slap or a wave.
 *
 * The walk controller calls updateWalkHand() at the end of its own frame (after it moved the camera),
 * so the hand never lags a frame behind the view. Nothing here allocates per frame.
 */
import { forwardRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { handPose, handState, type HandPose } from "./handGesture";

/** Palm, four fingers, thumb and cuff: [x, y, z, sx, sy, sz, rz] in the hand's local frame (fingers +y). */
const PARTS: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [0, 0, 0, 0.085, 0.095, 0.032, 0],
  [-0.031, 0.078, 0, 0.019, 0.062, 0.026, 0.05],
  [-0.01, 0.084, 0, 0.019, 0.072, 0.026, 0],
  [0.011, 0.082, 0, 0.019, 0.07, 0.026, 0],
  [0.031, 0.072, 0, 0.018, 0.054, 0.026, -0.06],
  [-0.052, 0.012, 0.006, 0.021, 0.052, 0.026, 0.65],
  [0, -0.066, 0, 0.096, 0.036, 0.046, 0],
];

/** The hand must never catch the crosshair raycast. */
const noRaycast = () => null;

const POSE: HandPose = { visible: false, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 };

/**
 * Pose the hand for this frame. `root` follows the camera; its first child is the hand itself.
 */
export function updateWalkHand(root: THREE.Group | null, camera: THREE.Camera, now: number): void {
  if (!root) return;
  const p = handPose(handState.gesture, handState.pin ?? now - handState.start, POSE);
  if (!p.visible) {
    if (root.visible) root.visible = false;
    if (handState.gesture) handState.gesture = null;
    return;
  }
  root.visible = true;
  root.position.copy(camera.position);
  root.quaternion.copy(camera.quaternion);
  const hand = root.children[0];
  if (!hand) return;
  hand.position.set(p.x, p.y, p.z);
  hand.rotation.set(p.rx, p.ry, p.rz);
  hand.scale.setScalar(p.scale);
}

export const WalkHand = forwardRef<THREE.Group>(function WalkHand(_props, ref) {
  const { geometry, material } = useMemo(() => ({
    geometry: new THREE.BoxGeometry(1, 1, 1),
    // Drawn on top of everything (the hand never sinks into a wall you stand against).
    material: new THREE.MeshStandardMaterial({ color: "#f6f1e7", roughness: 0.55, metalness: 0, depthTest: false, fog: false }),
  }), []);
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);
  return (
    <group ref={ref} visible={false} name="walk-hand">
      <group>
        {PARTS.map(([x, y, z, sx, sy, sz, rz], i) => (
          <mesh key={i} geometry={geometry} material={material} position={[x, y, z]} scale={[sx, sy, sz]} rotation={[0, 0, rz]} renderOrder={999} frustumCulled={false} raycast={noRaycast} />
        ))}
      </group>
    </group>
  );
});
