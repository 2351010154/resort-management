"use client";

// Act 1's foreground: a warm ivory plaster wall, with the monogram as a hole in
// it that magnifies toward the viewer as you scroll.
//
// It replaces the flat canvas cut-out because the cut-out can only ever be the
// size it was drawn at. Here the mark is a distance field, so the same one
// smoothstep serves it at rest and at twenty-five times rest — and the barrel
// pinch and the wall's light leaking back over the opening are two more lines
// rather than two more passes. See monogram-lens-shader.ts for the coordinate
// path and plaster-ground.ts for the wall.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  buildMonogramField,
  type MonogramField,
} from "@/features/arrival/lib/monogram-sdf";
import { useInView } from "@/lib/use-in-view";
import {
  APERTURE_PASS,
  APERTURE_UNITS,
  apertureMagnify,
  clamp01,
  plateDrift,
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
const barrelRamp = (push: number) => Math.sin(Math.PI * push ** 0.85);

function fieldTexture({ data, size }: MonogramField): THREE.DataTexture {
  // Half float: distances here run to ~0.5 with the interesting band three
  // orders of magnitude finer, which half float carries comfortably — and
  // unlike full float it filters linearly everywhere without an extension.
  //
  // Uploaded bottom row first. The field was rasterised on a 2D canvas, whose
  // first row is the top of the mark, but a DataTexture's first row is v=0,
  // which the fullscreen quad puts at the bottom of the screen. Handing it over
  // in canvas order stands the letter on its head — which the old near-
  // symmetrical mark survived and this one would not.
  const halves = new Uint16Array(data.length);
  for (let y = 0; y < size; y++) {
    const from = (size - 1 - y) * size;
    const to = y * size;
    for (let x = 0; x < size; x++) {
      halves[to + x] = THREE.DataUtils.toHalfFloat(data[from + x]);
    }
  }
  const texture = new THREE.DataTexture(
    halves,
    size,
    size,
    THREE.RedFormat,
    THREE.HalfFloatType,
  );
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  // Off the edge the field reads "well outside", which is plain sheet — so the
  // wild coordinates the barrel throws at the corners resolve to wall.
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function LensQuad({
  field,
  camera,
}: {
  field: MonogramField;
  camera: IntroCamera;
}) {
  const size = useThree((state) => state.size);
  const texture = useMemo(() => fieldTexture(field), [field]);
  useEffect(() => () => texture.dispose(), [texture]);

  const uniforms = useMemo(
    () => ({
      uField: { value: texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uAspect: { value: 1 },
      uFieldPx: { value: 1 },
      uMagnify: { value: 1 },
      uBarrel: { value: 0 },
      uReveal: { value: 0 },
      uOpacity: { value: 1 },
      uGroundDrift: { value: 1 },
      uTime: { value: 0 },
    }),
    [texture],
  );

  // A ShaderMaterial's uniforms object is its own and keeps its identity; the
  // block passed as a prop is copied into it. So the block above seeds the
  // material and is not what the shader reads afterwards — every later write
  // has to go through the material, or it lands on a detached object and the
  // mark never opens.
  const material = useRef<THREE.ShaderMaterial>(null);

  // The mark's height at rest matches what the static sheet draws, so the
  // reduced-motion fallback and the lens frame the same opening.
  useEffect(() => {
    const u = material.current?.uniforms;
    if (!u) return;
    const markPx = APERTURE_UNITS * sceneUnitPx(size.width, size.height);
    u.uResolution.value.set(size.width, size.height);
    u.uAspect.value = size.width / Math.max(size.height, 1);
    u.uFieldPx.value = markPx / field.glyphFraction;
  }, [size, field.glyphFraction]);

  useFrame((state) => {
    const u = material.current?.uniforms;
    if (!u) return;
    const magnify = apertureMagnify(camera.z);
    u.uMagnify.value = magnify;
    u.uBarrel.value =
      -BARREL * barrelRamp(clamp01(camera.progress / APERTURE_PASS));
    u.uReveal.value = camera.reveal;
    u.uOpacity.value = sheetOpacity(camera.z);
    u.uGroundDrift.value = plateDrift(camera.z);
    // The clock keeps running while the act is off screen and the frameloop is
    // parked, so coming back jumps the raking light's phase. Nothing sees that
    // jump — the wall was not on screen for it — and the alternative is a
    // second clock that has to be paused and resumed in step with the loop.
    u.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={material}
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
    });
    return () => {
      live = false;
    };
  }, []);

  // The distance field is the only asset the act waits on now that the wall is
  // drawn rather than fetched — without it the mark would be cut out of nothing.
  //
  // Latched, because a second announcement would start a second set of mount
  // tweens on top of the first: two tweens driving the same reveal resolve into
  // the mark snapping open in a few hundred milliseconds instead of opening over
  // its two and a half seconds.
  const announced = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: onReady is a stable callback from the orchestrator, and the announcement is latched by the ref above so a new identity would not re-announce anyway.
  useEffect(() => {
    if (announced.current || !field) return;
    announced.current = true;
    onReady?.();
  }, [field]);

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
