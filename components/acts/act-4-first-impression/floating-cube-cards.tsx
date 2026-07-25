"use client";

// /zeroz flank geometry: floating cube-cards with resort detail textures,
// drifting on both sides of the arrival card, depth-fogged into the dark.
// Scroll adds slow group rotation; pointer adds parallax.

import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { arrivalImages } from "@/lib/arrival-image-manifest";

const CUBE_IMAGES = arrivalImages["act-4-room"]
  .filter((img) => img.role === "flank-cube")
  .map((img) => img.src.replace(/-\d+\.webp$/, "-640.webp"));

const prand = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function FloatingCubeCards({
  scrollRef,
  count = CUBE_IMAGES.length,
}: {
  /** 0..1 section scroll progress, mutated by the act orchestrator. */
  scrollRef: { current: number };
  count?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const textures = useTexture(CUBE_IMAGES.slice(0, count));

  const cubes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1; // alternate flanks
        return {
          basePos: new THREE.Vector3(
            side * (2.6 + prand(i, 1) * 2.2),
            -1 + prand(i, 2) * 3,
            -1.5 - prand(i, 3) * 3,
          ),
          size: 0.55 + prand(i, 4) * 0.5,
          floatPhase: prand(i, 5) * Math.PI * 2,
          floatSpeed: 0.25 + prand(i, 6) * 0.3,
          spin: (prand(i, 7) - 0.5) * 0.35,
        };
      }),
    [count],
  );

  useFrame(({ clock, pointer }) => {
    const group = groupRef.current;
    if (!group) return;
    const t = clock.elapsedTime;
    // scroll-linked slow yaw + pointer parallax
    group.rotation.y = scrollRef.current * 0.35 + pointer.x * 0.06;
    group.rotation.x = pointer.y * 0.04;
    group.children.forEach((child, i) => {
      const c = cubes[i];
      if (!c) return;
      child.position.y = c.basePos.y + Math.sin(t * c.floatSpeed + c.floatPhase) * 0.22;
      child.rotation.y = c.floatPhase + t * c.spin * 0.2;
      child.rotation.x = Math.sin(t * 0.15 + c.floatPhase) * 0.12;
    });
  });

  return (
    <group ref={groupRef}>
      {cubes.map((c, i) => (
        <mesh key={i} position={c.basePos} scale={c.size}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            map={Array.isArray(textures) ? textures[i % textures.length] : textures}
            roughness={0.85}
            metalness={0}
          />
        </mesh>
      ))}
    </group>
  );
}
