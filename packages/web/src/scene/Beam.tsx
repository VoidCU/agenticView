import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { Line2 } from "three-stdlib";

interface Props {
  from: [number, number, number];
  to: [number, number, number];
  color?: string;
}

/** A dashed, animated arc from the manager to a worker; the store removes it after 1.5 s. */
export function Beam({ from, to, color = "#ffd166" }: Props) {
  const ref = useRef<Line2>(null);
  const points = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += 2.2;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    return curve.getPoints(20);
  }, [from, to]);

  useFrame((_, delta) => {
    const line = ref.current;
    if (!line) return;
    line.material.dashOffset -= delta * 4;
  });

  return <Line ref={ref} points={points} color={color} lineWidth={2.5} dashed dashSize={0.35} gapSize={0.2} transparent opacity={0.95} />;
}
