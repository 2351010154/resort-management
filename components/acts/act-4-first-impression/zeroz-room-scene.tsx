"use client";

// The dark room: perspective camera, fog, ceiling spotlight with a cheated
// volumetric cone (additive-blend mesh, radial/axial alpha falloff — real
// volumetrics are overkill), floating cube-cards on both flanks.

import { Canvas } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useInView } from "@/lib/use-in-view";
import { FloatingCubeCards } from "./floating-cube-cards";

const coneVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// uv.y: 1 at cone tip (ceiling), 0 at base — brightest near the tip,
// fading down and toward the rim.
const coneFragment = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  void main() {
    float axial = pow(vUv.y, 1.6);
    float glow = axial * 0.34;
    gl_FragColor = vec4(vec3(0.96, 0.93, 0.86) * glow, glow);
  }
`;

function VolumetricCone() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: coneVertex,
        fragmentShader: coneFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  return (
    <mesh position={[0, 1.4, -0.5]} material={material}>
      <coneGeometry args={[2.6, 5.2, 48, 1, true]} />
    </mesh>
  );
}

export function ZerozRoomScene({
  scrollRef,
  cubeCount,
}: {
  scrollRef: { current: number };
  cubeCount?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inView = useInView(wrapRef);
  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 7], fov: 46 }}
      frameloop={inView ? "always" : "never"}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0 }}
    >
      <color attach="background" args={["#100e0c"]} />
      <fog attach="fog" args={["#100e0c", 6, 13]} />
      <ambientLight intensity={0.35} />
      <spotLight
        position={[0, 4, -0.5]}
        angle={0.55}
        penumbra={0.9}
        intensity={26}
        color="#f2e9d8"
        distance={14}
      />
      <VolumetricCone />
      <FloatingCubeCards scrollRef={scrollRef} count={cubeCount} />
    </Canvas>
    </div>
  );
}
