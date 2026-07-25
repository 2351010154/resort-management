"use client";

// Act 1's foreground: the ivory sheet, with the monogram as a hole in it that
// magnifies toward the viewer as you scroll.
//
// It replaces the flat canvas cut-out because the cut-out can only ever be the
// size it was drawn at. Here the mark is a distance field, so the same one
// smoothstep serves it at rest and at twenty-five times rest — and the barrel
// pinch and the sheet's leak back over the opening are two more lines rather
// than two more passes. See monogram-lens-shader.ts for the coordinate path.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { buildMonogramField, type MonogramField } from "@/lib/monogram-sdf";
import { useInView } from "@/lib/use-in-view";
import {
  APERTURE_PASS,
  APERTURE_UNITS,
  apertureMagnify,
  clamp01,
  sceneUnitPx,
  sheetOpacity,
  type IntroCamera,
} from "./intro-camera-model";
import { lensFragment, lensVertex } from "./monogram-lens-shader";

/**
 * Peak pincushion. Read it as the fraction the sample is pulled in by at the
 * screen corner: at 1.15 the corners come in by a little over half, which is
 * where the silhouette starts to visibly bend.
 */
const BARREL = 1.15;

/**
 * Where in the push that peak lands. A hump rather than a ramp: the bend is
 * only legible while there is still enough outline on screen to bend, and
 * holding it at full strength through the dissolve just drags the last stroke
 * off frame early.
 *
 * Measured against the mark's own life rather than the act's, since the mark is
 * past the camera by APERTURE_PASS and the rest of the act belongs to the field.
 * Against the act it would peak long after there was any outline left to bend.
 */
const barrelRamp = (push: number) => Math.sin(Math.PI * Math.pow(push, 0.85));

function fieldTexture({ data, size }: MonogramField): THREE.DataTexture {
  // Half float: distances here run to ~0.5 with the interesting band three
  // orders of magnitude finer, which half float carries comfortably — and
  // unlike full float it filters linearly everywhere without an extension.
  const halves = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) halves[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const texture = new THREE.DataTexture(
    halves, size, size, THREE.RedFormat, THREE.HalfFloatType,
  );
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  // Off the edge the field reads "well outside", which is plain sheet — so the
  // wild coordinates the barrel throws at the corners resolve to ivory.
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function LensQuad({ field, camera }: { field: MonogramField; camera: IntroCamera }) {
  const size = useThree((state) => state.size);
  const texture = useMemo(() => fieldTexture(field), [field]);
  useEffect(() => () => texture.dispose(), [texture]);

  const uniforms = useMemo(
    () => ({
      uField: { value: texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFieldPx: { value: 1 },
      uMagnify: { value: 1 },
      uBarrel: { value: 0 },
      uReveal: { value: 0 },
      uOpacity: { value: 1 },
      uSheet: { value: new THREE.Color("#f4efe6") },
    }),
    [texture],
  );

  // The mark's height at rest matches what the static sheet draws, so the
  // reduced-motion fallback and the lens frame the same opening.
  useEffect(() => {
    uniforms.uResolution.value.set(size.width, size.height);
    uniforms.uFieldPx.value =
      (APERTURE_UNITS * sceneUnitPx(size.width, size.height)) / field.glyphFraction;
  }, [size, uniforms, field.glyphFraction]);

  useFrame(() => {
    uniforms.uMagnify.value = apertureMagnify(camera.z);
    uniforms.uBarrel.value = -BARREL * barrelRamp(clamp01(camera.progress / APERTURE_PASS));
    uniforms.uReveal.value = camera.reveal;
    uniforms.uOpacity.value = sheetOpacity(camera.z);
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={lensVertex}
        fragmentShader={lensFragment}
        uniforms={uniforms}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

export function MonogramLens({
  camera,
  onReady,
}: {
  camera: IntroCamera;
  onReady?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inView = useInView(wrapRef);
  const [field, setField] = useState<MonogramField | null>(null);

  useEffect(() => {
    let live = true;
    buildMonogramField().then((built) => {
      if (!live) return;
      setField(built);
      onReady?.();
    });
    return () => {
      live = false;
    };
    // onReady is a stable callback from the orchestrator; the field builds once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} aria-hidden style={{ position: "absolute", inset: 0 }}>
      {field ? (
        <Canvas
          frameloop={inView ? "always" : "never"}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: false }}
          style={{ position: "absolute", inset: 0 }}
        >
          <LensQuad field={field} camera={camera} />
        </Canvas>
      ) : null}
    </div>
  );
}
