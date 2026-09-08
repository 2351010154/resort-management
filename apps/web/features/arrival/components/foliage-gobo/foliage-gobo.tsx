"use client";

// The arrival's light: a gobo — foliage shadow cast through an off-frame window
// at the top right, leaves fluttering on their stems. Act 2 mounts it over its
// ribbon and the photographs the ribbon is laid on, and it falls on both.
//
// Two passes, per the oryzo.ai gobo it is modelled on. A 512² offscreen pass
// draws and wiggles the mask; the screen pass blurs it into a penumbra and
// multiplies it onto the wall. Keeping the wiggle in the small pass is the whole
// trick: the sway costs a quarter-megapixel a frame no matter the display, and
// the expensive part (the blur) never sees a leaf, only a soft mask.
//
// The canvas sticks to the viewport rather than scrolling with the section — the
// light through the window doesn't move because the page did.

import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SecondOrderSpring2 } from "@/features/arrival/lib/second-order-spring";
import { useInView } from "@/lib/use-in-view";
import {
  isWebglAvailable,
  prefersReducedMotion,
} from "@/features/arrival/lib/webgl-support";
import {
  compositeFragment,
  maskFragment,
  quadVertex,
} from "./foliage-gobo-shader";
import styles from "./foliage-gobo.module.css";

/** Mask resolution. oryzo runs its gobo target at the same size. */
const MASK_SIZE = 512;

/**
 * Wall colour under full shadow, as a multiply — sampled off the comp: the
 * deepest core sits at #dcd3c9 over a #eee7de wall, so a hair under 10% down
 * and cooling as it darkens.
 */
const TINT = new THREE.Color(0.9, 0.886, 0.876);

/** Depth of the cast branch, and of the near mass hanging in bottom left. */
const BRANCH_OPACITY = 0.95;
// Held clearly under the branch: it reads as foliage further back in the room,
// so it must never draw the eye off the cast frond at the top right. The figure
// is low because a tighter blur than before leaves far more of the mask intact.
const NEAR_OPACITY = 0.42;

/**
 * Breeze rate in radians/second — a leaf's slow swing is ~7s end to end. Fixed,
 * not pointer-driven: a global rate would quicken every leaf on the wall at
 * once, and the response is meant to stay under the cursor.
 */
const BREEZE = 1.15;
/** How far the frame swings under the pointer, in frame units. */
const TILT = 0.007;
/** Pointer speed scaling (oryzo: mouseExtraSpeed), read locally in the shader. */
const GUST = 0.6;
/** How fast the pointer's influence fades in and out as it enters/leaves. */
const REACH_RATE = 3.5;

/**
 * Frame height the frond's proportions were cut against, in CSS pixels.
 *
 * The shader measures every leaf, stem and spray against the height of the
 * frame, so left alone the cast is a fixed share of the window and grows in
 * pixels exactly as the window does: a leaf runs ~90px on a short laptop and
 * ~210px on a large monitor. It was the only thing on this wall that did —
 * every rule and every line of type beside it is capped in rem — so the shadow
 * drifted against the type it stands behind, delicate on one screen and the
 * loudest graphic in the act on another. Dividing by the height it was drawn
 * for is what holds a leaf the same size on both.
 */
const REF_FRAME_HEIGHT = 700;

/** What share of that reference the shadow is drawn at. */
const CAST_SCALE = 0.75;

/**
 * Size of the whole cast, as the share of its drawn size both passes work in.
 *
 * Two corrections, and they are not the same correction. The aspect term holds
 * a spray inside a narrow frame: measured in frame heights, one overruns a
 * portrait screen sideways however few pixels it is. The height term is the
 * one above — it stops the cast growing with the window at all. A phone takes
 * both, which is why its shadow comes out the most reduced of any screen: it is
 * the frame that is both narrow and tall.
 */
function castScale(width: number, height: number): number {
  const aspect = height > 0 ? width / height : 1;
  const narrow = Math.min(Math.max(0.55 + 0.45 * aspect, 0.72), 1);
  // Bounded above so a short window does not inflate the cast past the size it
  // was drawn at, and below so a very tall one keeps a shadow at all.
  const zoom = Math.min(
    Math.max(REF_FRAME_HEIGHT / (height || REF_FRAME_HEIGHT), 0.45),
    1.15,
  );
  return narrow * zoom * CAST_SCALE;
}

// The shadow's foot is taken care of in the screen pass, which tapers it out
// above the wall's bottom edge at any scroll position — so nothing here needs to
// watch where the act sits on screen.

function GoboPasses({ still }: { still: boolean }) {
  const size = useThree((state) => state.size);

  const target = useMemo(
    () =>
      new THREE.WebGLRenderTarget(MASK_SIZE, MASK_SIZE, {
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
      }),
    [],
  );
  useEffect(() => () => target.dispose(), [target]);

  const [maskScene] = useState(() => new THREE.Scene());
  const maskCamera = useMemo(
    () => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    [],
  );

  const maskUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uScale: { value: CAST_SCALE },
      uSway: { value: still ? 0 : 1 },
      // Parked well off-frame so nothing is boosted until the pointer arrives.
      uPointer: { value: new THREE.Vector2(-9, -9) },
      uPointerReach: { value: 0 },
      uGust: { value: 0 },
    }),
    [still],
  );

  const compositeUniforms = useMemo(
    () => ({
      uMask: { value: target.texture },
      uMaskTexel: { value: 1 / MASK_SIZE },
      uAspect: { value: 1 },
      uScale: { value: CAST_SCALE },
      uOpacity: { value: BRANCH_OPACITY },
      uNearOpacity: { value: NEAR_OPACITY },
      uTilt: { value: new THREE.Vector2() },
      uTint: { value: TINT },
    }),
    [target],
  );

  // Both blocks above seed their material and stop being what the shader reads:
  // a ShaderMaterial keeps its own uniforms object and copies the prop into it.
  // Later writes go through the material.
  const maskMaterial = useRef<THREE.ShaderMaterial>(null);
  const compositeMaterial = useRef<THREE.ShaderMaterial>(null);

  const aspect = size.height > 0 ? size.width / size.height : 1;
  // Both passes take both figures: the mask draws the frond at this size and
  // the screen pass has to blur it by the same amount. Re-read on resize, so a
  // window dragged taller does not take the shadow up with it.
  const scale = castScale(size.width, size.height);
  useEffect(() => {
    for (const material of [maskMaterial.current, compositeMaterial.current]) {
      if (!material) continue;
      material.uniforms.uAspect.value = aspect;
      material.uniforms.uScale.value = scale;
    }
  }, [aspect, scale]);

  // Pointer lives on the window: the canvas takes no events, and the wall should
  // answer the pointer wherever it is over the act. Measured against the canvas
  // rect rather than the viewport, so the leaf under the cursor is the leaf that
  // stirs even where the sticky wall is part-way through its travel.
  const pointer = useRef({ x: 0, y: 0, over: 0 });
  const spring = useMemo(() => new SecondOrderSpring2(1, 0.3, 2), []);
  const canvas = useThree((state) => state.gl.domElement);

  useFrame((state, delta) => {
    const mask = maskMaterial.current?.uniforms;
    const composite = compositeMaterial.current?.uniforms;
    if (!still && mask && composite) {
      const dt = Math.min(delta, 1 / 30);
      spring.setTarget(pointer.current.x, pointer.current.y);
      spring.update(dt);

      const speed = Math.abs(spring.velocity.x) + Math.abs(spring.velocity.y);
      mask.uGust.value = Math.min(speed * GUST, 2);
      mask.uTime.value += dt * BREEZE;
      // Gobo space: x runs 0..aspect, y 0..1 bottom to top.
      mask.uPointer.value.set(
        (spring.value.x * 0.5 + 0.5) * aspect,
        spring.value.y * 0.5 + 0.5,
      );

      const reach = mask.uPointerReach;
      reach.value +=
        (pointer.current.over - reach.value) * Math.min(dt * REACH_RATE, 1);
      composite.uTilt.value.set(spring.value.x * TILT, spring.value.y * TILT);
    }

    const { gl } = state;
    gl.setRenderTarget(target);
    gl.render(maskScene, maskCamera);
    gl.setRenderTarget(null);
  });

  useEffect(() => {
    if (still) return;
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      pointer.current.x = x * 2 - 1;
      pointer.current.y = 1 - y * 2;
      // A margin of one influence radius: the leaves at the edge should already
      // be answering by the time the cursor crosses onto the wall.
      pointer.current.over =
        x > -0.35 && x < 1.35 && y > -0.35 && y < 1.35 ? 1 : 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [still, canvas]);

  return (
    <>
      {createPortal(
        <mesh frustumCulled={false}>
          <planeGeometry args={[2, 2]} />
          <shaderMaterial
            ref={maskMaterial}
            vertexShader={quadVertex}
            fragmentShader={maskFragment}
            uniforms={maskUniforms}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>,
        maskScene,
      )}
      <mesh frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
        <shaderMaterial
          ref={compositeMaterial}
          vertexShader={quadVertex}
          fragmentShader={compositeFragment}
          uniforms={compositeUniforms}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

export function FoliageGobo({ className }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inView = useInView(wrapRef);
  // Decided after mount, never during render: the server has no idea which of
  // the three the visitor gets, and guessing costs a hydration mismatch.
  const [mode, setMode] = useState<"film" | "still" | "css" | null>(null);

  useEffect(() => {
    // Reduced motion still gets the shadow, just parked; without WebGL it falls
    // back to a plain corner wash, which is all a gradient can honestly do here.
    if (!isWebglAvailable()) setMode("css");
    else setMode(prefersReducedMotion() ? "still" : "film");
  }, []);

  return (
    <div
      ref={wrapRef}
      className={[styles.goboWrap, className].filter(Boolean).join(" ")}
      aria-hidden
    >
      {mode === null ? null : mode === "css" ? (
        <div className={styles.goboFallback} />
      ) : (
        <div className={styles.gobo}>
          <Canvas
            // Parked under reduced motion: one frame, then nothing.
            frameloop={mode === "still" || !inView ? "demand" : "always"}
            dpr={[1, 1.5]}
            // Opaque white clear: under the wrapper's multiply, white is "no
            // shadow here" and the wall comes through untouched.
            gl={{ alpha: false, antialias: false }}
            onCreated={({ gl }) => gl.setClearColor(0xffffff, 1)}
          >
            <GoboPasses still={mode === "still"} />
          </Canvas>
        </div>
      )}
    </div>
  );
}
