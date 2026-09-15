"use client";

import gsap from "gsap";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { tierSrcSet } from "@/features/arrival/lib/image-srcset";
import type { RibbonImage } from "./ribbon-beats";
import styles from "./act-2-ribbon.module.css";

const coastalImage = (name: string, alt: string): RibbonImage => ({
  src: `/images/act-2-ribbon/${name}-1536.webp`,
  width: 1536,
  height: 1024,
  tiers: [768, 1536],
  alt,
});
const ROOM_IMAGES = [
  coastalImage(
    "room-terrace",
    "A linen bed in a sunlit stone room opening onto the sea.",
  ),
  coastalImage(
    "room-courtyard",
    "A quiet stone bedroom beside an olive-tree courtyard.",
  ),
];
const TABLE_IMAGES = [
  coastalImage(
    "dish-fish",
    "Grilled sea bass with vegetables, lemon and salsa verde.",
  ),
  coastalImage(
    "dish-aubergine-v2",
    "Roasted aubergine with tomato sauce, basil and ricotta.",
  ),
];

export function RibbonSlider({
  image,
  clipPath,
  reduced,
  rooms,
  onSlideChange,
}: {
  image: RibbonImage;
  clipPath: string;
  reduced: boolean;
  rooms: boolean;
  onSlideChange?: (index: number) => void;
}) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    onSlideChange?.(active);
  }, [active, onSlideChange]);
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const progressRef = useRef<HTMLSpanElement>(null);
  const countdown = useRef<gsap.core.Tween | null>(null);
  const cropRef = useRef<HTMLDivElement>(null);
  const frames = useRef<(HTMLDivElement | null)[]>([]);
  const previous = useRef(0);
  const animating = useRef(false);
  const select = (index: number) => {
    if (!animating.current) setActive(index);
  };

  useEffect(() => {
    const crop = cropRef.current;
    if (!crop) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.45);
      },
      { threshold: [0, 0.45] },
    );
    observer.observe(crop);
    return () => observer.disconnect();
  }, []);

  // The visible fill IS the autoplay clock, so pausing and resuming cannot drift.
  useEffect(() => {
    const progress = progressRef.current;
    if (!progress) return;
    // Keep completed phases filled: 0 → half → full, then reset on image 1.
    gsap.set(progress, { scaleX: active / 2 });
    if (reduced) return;
    const tween = gsap.to(progress, {
      scaleX: Math.min((active + 1) / 2, 1),
      duration: 4.5,
      ease: "none",
      paused: true,
      onComplete: () => setActive((active + 1) % 3),
    });
    countdown.current = tween;
    return () => {
      tween.kill();
      countdown.current = null;
    };
  }, [active, reduced]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Each active slide creates a new paused tween that must be synchronized here.
  useEffect(() => {
    const sync = () => {
      countdown.current?.paused(
        !visible || paused || reduced || document.hidden,
      );
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [visible, paused, reduced, active]);

  useEffect(() => {
    const outgoing = frames.current[previous.current];
    const incoming = frames.current[active];
    if (!incoming || !outgoing || previous.current === active) return;
    previous.current = active;
    const incomingPhoto = incoming.querySelector("img");
    const outgoingPhoto = outgoing.querySelector("img");
    const direction = rooms ? 1 : -1;
    // A tilted mask crosses the stationary aperture; photographs travel
    // independently behind it, giving the reference its layered depth.
    const start = rooms
      ? "polygon(100% 0%, 118% 0%, 118% 100%, 118% 100%)"
      : "polygon(-18% 0%, 0% 0%, -18% 100%, -18% 100%)";
    const end = rooms
      ? "polygon(-18% 0%, 100% 0%, 100% 100%, 0% 100%)"
      : "polygon(0% 0%, 118% 0%, 100% 100%, 0% 100%)";
    animating.current = true;
    gsap.set(incoming, { visibility: "visible", zIndex: 2, clipPath: start });
    gsap.set(outgoing, { zIndex: 1 });
    const timeline = gsap.timeline({
      defaults: { duration: reduced ? 0 : 1.35, ease: "expo.out" },
      onComplete: () => {
        gsap.set(outgoing, { visibility: "hidden" });
        gsap.set(incoming, { clipPath: "none", zIndex: 1 });
        animating.current = false;
      },
    });
    timeline
      .to(incoming, { clipPath: end }, 0)
      .fromTo(
        incomingPhoto,
        { xPercent: direction * 30, scale: 1.08 },
        { xPercent: 0, scale: 1 },
        0,
      )
      .fromTo(outgoingPhoto, { xPercent: 0 }, { xPercent: direction * -18 }, 0);
    return () => {
      timeline.kill();
      gsap.set(outgoing, { visibility: "hidden" });
      gsap.set(incoming, {
        visibility: "visible",
        clipPath: "none",
        zIndex: 1,
      });
      gsap.set(incomingPhoto, { xPercent: 0, scale: 1 });
      animating.current = false;
    };
  }, [active, reduced, rooms]);
  const images = rooms ? [image, ...ROOM_IMAGES] : [image, ...TABLE_IMAGES];
  const label = rooms ? "Rooms" : "At the table";
  return (
    <>
      <div ref={cropRef} className={styles.photoCrop} style={{ clipPath }}>
        <div className={styles.photoDrift} data-photo-drift="">
          <div
            className={styles.sliderTrack}
            data-direction={rooms ? "left" : "right"}
            style={
              {
                "--slide": active,
                "--slide-duration": reduced ? "0ms" : "1350ms",
              } as CSSProperties
            }
          >
            {images.map((photo, index) => (
              <div
                key={photo.src}
                className={styles.sliderFrame}
                ref={(element) => {
                  frames.current[index] = element;
                }}
                style={{ visibility: index === 0 ? "visible" : "hidden" }}
                aria-hidden={index !== active}
              >
                <img
                  src={photo.src}
                  srcSet={tierSrcSet(photo)}
                  sizes="(max-width: 700px) 85vw, 75vw"
                  width={photo.width}
                  height={photo.height}
                  alt={photo.alt}
                  loading={visible ? "eager" : "lazy"}
                  decoding="async"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <fieldset
        className={styles.sliderNodes}
        aria-label={`${label} images`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(false);
        }}
        style={
          {
            "--slide": active,
            "--slide-duration": reduced ? "0ms" : "1350ms",
          } as CSSProperties
        }
      >
        <span
          ref={progressRef}
          className={styles.sliderProgress}
          aria-hidden="true"
        />
        {images.map((photo, index) => (
          <button
            key={photo.src}
            type="button"
            aria-label={`${label}: image ${index + 1} of 3`}
            aria-pressed={active === index}
            onClick={() => select(index)}
          />
        ))}
      </fieldset>
    </>
  );
}
