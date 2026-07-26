"use client";

// Act 1's foreground: the sea, with the monogram as a hole in it that magnifies
// toward the viewer as you scroll.
//
// It replaces the flat canvas cut-out because the cut-out can only ever be the
// size it was drawn at. Here the mark is a distance field, so the same one
// smoothstep serves it at rest and at twenty-five times rest — and the barrel
// pinch, the sky's leak back over the opening and the water's reflection of the
// mark are three more lines rather than three more passes. See
// monogram-lens-shader.ts for the coordinate path.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { buildMonogramField, GLYPH_BASE_V, type MonogramField } from "@/features/arrival/lib/monogram-sdf";
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
import {
  HORIZON_POSTER,
  horizonPlacement,
  horizonScreenY,
  horizonSources,
} from "./horizon-plate";
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

/**
 * Magnification the reflection is gone by.
 *
 * Early, and not a matter of taste: a reflection is the whole letter given back
 * at once, and once the frame holds only part of a stroke there is no longer a
 * letter to give back — carried further it degenerates into a bright band
 * sliding up the screen. By 1.5 the mark has grown half again and the waterline
 * is already leaving the frame.
 */
const REFLECT_OUT = 1.5;

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
    halves, size, size, THREE.RedFormat, THREE.HalfFloatType,
  );
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  // Off the edge the field reads "well outside", which is plain sheet — so the
  // wild coordinates the barrel throws at the corners resolve to backdrop.
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function LensQuad({
  field,
  camera,
  backdrop,
}: {
  field: MonogramField;
  camera: IntroCamera;
  backdrop: THREE.Texture;
}) {
  const size = useThree((state) => state.size);
  const texture = useMemo(() => fieldTexture(field), [field]);
  useEffect(() => () => texture.dispose(), [texture]);

  const uniforms = useMemo(
    () => ({
      uField: { value: texture },
      uBackdrop: { value: backdrop },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFieldPx: { value: 1 },
      uMagnify: { value: 1 },
      uBarrel: { value: 0 },
      uReveal: { value: 0 },
      uOpacity: { value: 1 },
      uBackdropScale: { value: new THREE.Vector2(1, 1) },
      uBackdropOffset: { value: new THREE.Vector2(0, 0) },
      uBackdropDrift: { value: 1 },
      uBaseV: { value: GLYPH_BASE_V },
      uReflect: { value: 0 },
    }),
    // the backdrop is swapped in place below; rebuilding the block on every
    // swap would hand the material a new uniform set mid-scrub
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texture],
  );

  useEffect(() => {
    uniforms.uBackdrop.value = backdrop;
  }, [uniforms, backdrop]);

  // The mark's height at rest matches what the static sheet draws, so the
  // reduced-motion fallback and the lens frame the same opening.
  useEffect(() => {
    const markPx = APERTURE_UNITS * sceneUnitPx(size.width, size.height);
    uniforms.uResolution.value.set(size.width, size.height);
    uniforms.uFieldPx.value = markPx / field.glyphFraction;

    const image = backdrop.image as { videoWidth?: number; width?: number; videoHeight?: number; height?: number };
    const texW = image?.videoWidth || image?.width || 1;
    const texH = image?.videoHeight || image?.height || 1;
    const box = horizonPlacement(
      size.width, size.height, texW, texH,
      horizonScreenY(size.height, markPx),
    );
    // Screen uv (v up from the bottom) to backdrop uv, as one scale and one
    // offset so the fragment stage stays two multiplies.
    uniforms.uBackdropScale.value.set(size.width / box.width, size.height / box.height);
    uniforms.uBackdropOffset.value.set(
      -box.left / box.width,
      1 + box.top / box.height - size.height / box.height,
    );
  }, [size, uniforms, field.glyphFraction, backdrop]);

  useFrame(() => {
    const magnify = apertureMagnify(camera.z);
    uniforms.uMagnify.value = magnify;
    uniforms.uBarrel.value = -BARREL * barrelRamp(clamp01(camera.progress / APERTURE_PASS));
    uniforms.uReveal.value = camera.reveal;
    uniforms.uOpacity.value = sheetOpacity(camera.z);
    uniforms.uBackdropDrift.value = plateDrift(camera.z);
    uniforms.uReflect.value =
      camera.entry * (1 - clamp01((magnify - 1) / (REFLECT_OUT - 1)));
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

/**
 * The backdrop, poster first and loop second.
 *
 * The act cannot start until something opaque is behind the mark, and a video
 * that has to be fetched, decoded and given a first frame is not that. So the
 * poster — the same grade, the same waterline — is what the lens opens on, and
 * the loop replaces it in place once it can actually play. Nothing downstream
 * notices the swap beyond re-reading the frame size.
 */
function useBackdrop(inView: boolean): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let live = true;
    // held until unmount rather than freed at the swap: the material still
    // points at it for the frame between setTexture and the uniform effect
    let loop: THREE.VideoTexture | null = null;

    const flat = new THREE.TextureLoader().load(HORIZON_POSTER, () => {
      if (live) setTexture(flat);
    });
    flat.minFilter = flat.magFilter = THREE.LinearFilter;
    flat.wrapS = flat.wrapT = THREE.ClampToEdgeWrapping;

    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    const { webm, mp4 } = horizonSources(window.innerWidth);
    for (const [src, type] of [[webm, "video/webm"], [mp4, "video/mp4"]]) {
      const source = document.createElement("source");
      source.src = src;
      source.type = type;
      video.appendChild(source);
    }
    videoRef.current = video;

    const swap = () => {
      if (!live) return;
      loop = new THREE.VideoTexture(video);
      loop.minFilter = loop.magFilter = THREE.LinearFilter;
      loop.wrapS = loop.wrapT = THREE.ClampToEdgeWrapping;
      setTexture(loop);
    };
    video.addEventListener("canplay", swap, { once: true });
    video.load();

    return () => {
      live = false;
      video.removeEventListener("canplay", swap);
      video.pause();
      video.removeAttribute("src");
      video.load();
      videoRef.current = null;
      flat.dispose();
      loop?.dispose();
    };
  }, []);

  // Decoding a fullscreen loop behind a page the reader has scrolled past is
  // pure heat, and the canvas is not drawing then either.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (inView) video.play().catch(() => {});
    else video.pause();
  }, [inView]);

  return texture;
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
  const backdrop = useBackdrop(inView);

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

  // Both halves of the sheet have to be in hand before the curtain lifts: the
  // field alone would leave the mark cut out of nothing.
  //
  // Once, and latched. The backdrop changes identity again when the loop
  // replaces the poster, and announcing that as a second arrival starts a
  // second set of mount tweens on top of the first — two tweens driving the
  // same reveal, which resolves into the mark snapping open in a few hundred
  // milliseconds instead of opening over its two and a half seconds.
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current || !field || !backdrop) return;
    announced.current = true;
    onReady?.();
    // onReady is a stable callback from the orchestrator
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, backdrop]);

  return (
    <div ref={wrapRef} aria-hidden style={{ position: "absolute", inset: 0 }}>
      {field && backdrop ? (
        <Canvas
          frameloop={inView ? "always" : "never"}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: false }}
          style={{ position: "absolute", inset: 0 }}
        >
          <LensQuad field={field} camera={camera} backdrop={backdrop} />
        </Canvas>
      ) : null}
    </div>
  );
}
