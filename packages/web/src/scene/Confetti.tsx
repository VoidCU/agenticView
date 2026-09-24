import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELEBRATION_MS } from "../state/store";

const COUNT = 60;
const COLORS = ["#ffd166", "#5b8cff", "#3ddc97", "#ff7a59", "#b084f5", "#ff5fa2", "#4fd1ff"];

interface Props {
  origin: [number, number, number];
  until: number;
}

/** 60 small boxes bursting from the origin for 2 s. Positions are integrated on the CPU each frame. */
export function Confetti({ origin, until }: Props) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const start = until - CELEBRATION_MS;
  const particles = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.5 + Math.random() * 3;
        return {
          vx: Math.cos(angle) * speed * (0.4 + Math.random() * 0.6),
          vy: 4 + Math.random() * 4,
          vz: Math.sin(angle) * speed * (0.4 + Math.random() * 0.6),
          spin: Math.random() * 6,
          color: new THREE.Color(COLORS[i % COLORS.length]),
        };
      }),
    [],
  );

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    particles.forEach((p, i) => m.setColorAt(i, p.color));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [particles]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const age = Math.max(0, (Date.now() - start) / 1000);
    particles.forEach((p, i) => {
      const x = origin[0] + p.vx * age;
      const y = Math.max(0.05, origin[1] + 1.4 + p.vy * age - 4.9 * age * age);
      const z = origin[2] + p.vz * age;
      dummy.position.set(x, y, z);
      dummy.rotation.set(age * p.spin, age * p.spin * 0.7, 0);
      const s = age > 1.5 ? Math.max(0, 1 - (age - 1.5) * 2) : 1;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <boxGeometry args={[0.14, 0.14, 0.04]} />
      <meshStandardMaterial roughness={0.5} emissiveIntensity={0.4} emissive="#ffffff" />
    </instancedMesh>
  );
}
