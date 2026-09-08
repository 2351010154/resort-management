"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { HERO_PLATE } from "@/features/arrival/components/act-1-arrival/hero-plate";
import { ChooseDatesLink } from "@/features/arrival/components/booking/choose-dates-link";
import { FoliageGobo } from "@/features/arrival/components/foliage-gobo/foliage-gobo";
import { ACT2_OVERHANG } from "@/features/arrival/lib/act-seams";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import { tierSrcSet } from "@/features/arrival/lib/image-srcset";
import styles from "./act-2-ribbon.module.css";
import {
  type Aperture,
  BEATS,
  HORIZON,
  KNOTS,
  KNOTS_NARROW,
  MOBILE_LENGTH,
  RIBBON_LENGTH,
  type RibbonImage,
  SCENE_LENGTH,
} from "./ribbon-beats";
import {
  aperturePath,
  aspectOf,
  centre,
  introShorePath,
  ribbonPath,
} from "./ribbon-geometry";
import { cameraAt, exitOpacity, ramp, smooth } from "./ribbon-pacing";
import { RibbonSlider } from "./ribbon-slider";
import { dropProgress, PROPS } from "./ribbon-props";

const PLATE_BLEED = 2.25;
const css = (value: Record<string, string | number>) => value as CSSProperties;

function geometryFor(aperture: Aperture, narrow: boolean, aspect: number) {
  const r = narrow
    ? Math.min(19, 35 / aspect)
    : aperture.shape === "circle"
      ? aperture.widthVw / (2 * aspect)
      : aperture.r;
  return {
    ...aperture,
    dx: narrow ? 0 : aperture.dx,
    r,
    stretch: narrow ? 1 : aperture.widthVw / (2 * r * aspect),
  };
}

function Photo({
  image,
  className,
  sizes = "100vw",
}: {
  image: RibbonImage;
  className?: string;
  sizes?: string;
}) {
  return (
    <img
      className={className}
      src={image.src}
      srcSet={tierSrcSet(image)}
      sizes={sizes}
      width={image.width}
      height={image.height}
      alt={image.alt}
      loading="lazy"
      decoding="async"
    />
  );
}

export function Act2Ribbon() {
  const sectionRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sheetRef = useRef<SVGPathElement>(null);
  const outlineRef = useRef<SVGPathElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const waterRef = useRef<HTMLDivElement>(null);
  const copyWorldRef = useRef<HTMLDivElement>(null);
  const clipId = useId();
  const [tableSlide, setTableSlide] = useState(0);
  const setNavDark = useArrivalActStore((state) => state.setNavDark);
  const [view, setView] = useState({
    narrow: false,
    reduced: true,
    aspect: 0.625,
  });

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () =>
      setView({
        narrow: window.innerWidth <= 700,
        reduced: motion.matches,
        aspect: aspectOf(window.innerWidth, window.innerHeight),
      });
    sync();
    window.addEventListener("resize", sync);
    motion.addEventListener("change", sync);
    return () => {
      window.removeEventListener("resize", sync);
      motion.removeEventListener("change", sync);
    };
  }, []);

  const { narrow, reduced, aspect } = view;
  const length = reduced
    ? SCENE_LENGTH + ACT2_OVERHANG
    : narrow
      ? MOBILE_LENGTH
      : RIBBON_LENGTH;
  const knots = narrow ? KNOTS_NARROW : KNOTS;
  const openings = BEATS.flatMap((beat) =>
    beat.aperture ? [geometryFor(beat.aperture, narrow, aspect)] : [],
  );
  const staticOptions = {
    knots,
    narrow,
    from: -ACT2_OVERHANG,
    to: SCENE_LENGTH,
    s: 0,
    swaying: false,
    aspect,
    apertures: openings.map((aperture) => ({ aperture, open: 1 })),
  };

  useEffect(() => {
    const section = sectionRef.current;
    const scene = sceneRef.current;
    const svg = svgRef.current;
    const world = worldRef.current;
    const copyWorld = copyWorldRef.current;
    if (!section || !scene || !svg || !world || !copyWorld) return;
    if (reduced) {
      backdropRef.current?.style.removeProperty("transform");
      scene.style.opacity = "1";
      section.style.setProperty("--scene-opacity", "1");
      world.style.transform = "none";
      copyWorld.style.transform = "none";
      for (const element of section.querySelectorAll<HTMLElement>(
        "[data-copy], [data-plate], [data-prop]",
      )) {
        element.style.removeProperty("transform");
        element.style.removeProperty("opacity");
      }
      const frozen = BEATS.flatMap((beat) =>
        beat.aperture
          ? [{ aperture: geometryFor(beat.aperture, narrow, aspect), open: 1 }]
          : [],
      );
      const options = {
        knots,
        narrow,
        from: -ACT2_OVERHANG,
        to: SCENE_LENGTH,
        s: 0,
        swaying: false,
        aspect,
        apertures: frozen,
      };
      sheetRef.current?.setAttribute("d", ribbonPath(options));
      outlineRef.current?.setAttribute(
        "d",
        ribbonPath({ ...options, apertures: [] }),
      );
      for (const element of section.querySelectorAll<HTMLElement>(
        "[data-photo-drift], [data-next-image]",
      )) {
        element.style.removeProperty("transform");
        element.style.removeProperty("clip-path");
      }
      const frozenClips = section.querySelectorAll<SVGPathElement>(
        "[data-aperture-clip]",
      );
      frozen.forEach(({ aperture }, index) => {
        frozenClips[index].setAttribute(
          "d",
          aperturePath(
            { ...aperture, y: 0.5, r: 1 / PLATE_BLEED, stretch: 1 },
            0.5,
            1,
            1,
          ),
        );
      });
      setNavDark(2, false);
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    const geometries = BEATS.flatMap((beat) =>
      beat.aperture ? [geometryFor(beat.aperture, narrow, aspect)] : [],
    );
    const plates = Array.from(
      section.querySelectorAll<HTMLElement>("[data-plate]"),
    );
    const copies = Array.from(
      section.querySelectorAll<HTMLElement>("[data-copy]"),
    );
    const clipPaths = Array.from(
      section.querySelectorAll<SVGPathElement>("[data-aperture-clip]"),
    );
    const images = plates.map((plate) =>
      plate.querySelector<HTMLElement>("[data-photo-drift]"),
    );
    const nextImages = plates.map((plate) =>
      plate.querySelector<HTMLElement>("[data-next-image]"),
    );
    const copyY = copies.map((copy) => Number(copy.dataset.copyY));
    const props = PROPS.map((prop) => ({
      prop,
      element: section.querySelector<HTMLElement>(`[data-prop="${prop.id}"]`),
    }));
    const baseX = geometries.map(
      (geometry) => centre(knots, geometry.y, 0, false) + geometry.dx,
    );
    let top = 0;
    let vh = window.innerHeight / 100;
    let vw = window.innerWidth / 100;
    let scroll = window.scrollY;
    let copyHeights: number[] = [];
    let navDark = false;
    let alive = true;
    let lastScroll = Number.NaN;
    let lastPaint = -1;
    const measure = () => {
      top = section.getBoundingClientRect().top + window.scrollY;
      vh = window.innerHeight / 100;
      vw = window.innerWidth / 100;
      copyHeights = copies.map((copy) => copy.offsetHeight / vh);
    };
    const paint = (time: number) => {
      const travel = (scroll - top) / vh;
      if (!alive || travel < -200 || travel > length) return;
      const approach = smooth(ramp(travel, -70, 0));
      const camera = cameraAt(travel, narrow) * approach + (narrow ? 18 : 0);
      // Keep the shared hero registered to the viewport while this stage
      // approaches its sticky position, avoiding a second photo scrolling in.
      if (backdropRef.current)
        backdropRef.current.style.transform = `translate3d(0,${Math.min(0, travel) * vh}px,0)`;
      // The small centre drift carries the photographs. The stronger edge
      // wave is independent, so the paper moves without shaking the reading.
      const phase = travel * 0.38 + time * 8;
      world.style.transform = `translate3d(0,${-camera * vh}px,0)`;
      copyWorld.style.transform = world.style.transform;
      // Props ride the paper and sink against it by their own bounded drop,
      // turning as they go, so the same path runs backwards on reverse
      // scroll. The bob is ambient, a breath apiece, and no two share a period.
      props.forEach(({ prop, element }, index) => {
        if (!element) return;
        const progress = dropProgress(prop, camera);
        const bob = Math.sin(time * (0.5 + index * 0.13) + index * 1.7) * 0.5;
        element.style.transform = `translate3d(0,${(prop.drop * progress + bob) * vh}px,0) rotate(${prop.spin * progress}deg)`;
        element.style.opacity = prop.fade
          ? String(1 - smooth(ramp(camera, prop.fade[0], prop.fade[1])))
          : "1";
      });
      svg.setAttribute(
        "viewBox",
        `0 ${camera - ACT2_OVERHANG} 100 ${100 + ACT2_OVERHANG}`,
      );
      scene.style.opacity = String(exitOpacity(travel, length));
      section.style.setProperty("--scene-opacity", scene.style.opacity);
      if (heroRef.current)
        heroRef.current.style.opacity = String(
          1 - smooth(ramp(camera, 55, 170)),
        );
      if (waterRef.current)
        waterRef.current.style.opacity = String(
          1 - smooth(ramp(camera, 425, 500)),
        );

      const drawn = geometries.map((geometry, index) => {
        const screenY = geometry.y - camera;
        const entryY = screenY + Math.max(0, -travel);
        const entrance = smooth(
          ramp(100 - entryY, index === 0 ? 20 : 0, index === 0 ? 72 : 58),
        );
        const opening = 0.22 + 0.78 * entrance;
        const plate = plates[index];
        const visible =
          screenY + geometry.r * 1.4 >= -ACT2_OVERHANG &&
          screenY - geometry.r * 1.4 <= 124;
        plate.style.visibility = visible ? "visible" : "hidden";
        if (!visible) return { aperture: geometry, open: opening };
        const x = centre(knots, geometry.y, phase, !narrow) + geometry.dx;
        plate.style.transform = `translateX(${(x - baseX[index]) * vw}px)`;
        // The DOM crop and SVG hole use the exact same animated outline.
        clipPaths[index].setAttribute(
          "d",
          aperturePath(
            { ...geometry, y: 0.5, r: 1 / PLATE_BLEED, stretch: 1 },
            0.5,
            opening,
            1,
          ),
        );
        const image = images[index];
        if (image)
          image.style.transform = `translateY(${(screenY - 50) * 0.065}%) scale(${1.025 + 0.38 * (1 - entrance)})`;
        const next = nextImages[index];
        if (next)
          next.style.clipPath = `inset(${(1 - smooth(ramp(camera, geometry.y - 62, geometry.y - 24))) * 100}% 0 0)`;
        return { aperture: geometry, open: opening };
      });
      const options = {
        knots,
        narrow,
        from: Math.max(-ACT2_OVERHANG, camera - ACT2_OVERHANG),
        to: camera + 124,
        s: phase,
        time,
        swaying: !narrow,
        edgeMotion: true,
        edgeScale: narrow ? 0.35 : 1,
        aspect,
        apertures: drawn,
      };
      // Share the edge calculation between the filled sheet and its clip.
      const outline = ribbonPath({ ...options, apertures: [] });
      const holes = drawn
        .filter(
          ({ aperture }) =>
            aperture.y + aperture.r * 1.4 >= options.from &&
            aperture.y - aperture.r * 1.4 <= options.to,
        )
        .map(({ aperture, open }) =>
          aperturePath(
            aperture,
            centre(knots, aperture.y, phase, !narrow) + aperture.dx,
            open,
            aspect,
          ),
        )
        .join("");
      sheetRef.current?.setAttribute("d", outline + holes);
      outlineRef.current?.setAttribute("d", outline);

      for (let index = 0; index < copies.length; index++) {
        const beat = BEATS[index];
        const authoredY = copyY[index];
        const anchor =
          beat.id === "horizon"
            ? Math.max(0, camera + (narrow ? 64 : 76) - authoredY)
            : 0;
        const screenY = authoredY + anchor - camera;
        const entering =
          beat.id === "horizon"
            ? smooth(ramp(camera, 465, 490))
            : smooth(ramp(100 - screenY, 6, 28));
        copies[index].style.opacity = String(entering);
        const drift =
          narrow || beat.onPhoto || beat.id === "horizon"
            ? 0
            : centre(knots, beat.y, phase) - centre(knots, beat.y, 0, false);
        copies[index].style.transform =
          `translate(${drift * vw}px,${(1 - entering) * 24 + anchor * vh}px)`;
        const hidden =
          screenY > 110 ||
          screenY + copyHeights[index] < 0 ||
          exitOpacity(travel, length) < 0.05;
        copies[index].inert = hidden;
      }
      const dark = camera > 175 && camera < 275;
      if (dark !== navDark) {
        navDark = dark;
        setNavDark(2, dark);
      }
      section.dataset.camera = camera.toFixed(2);
    };
    measure();
    const trigger = ScrollTrigger.create({
      trigger: section,
      start: "top 200%",
      end: "bottom top",
      onRefresh: (self) => {
        measure();
        scroll = self.scroll();
        paint(gsap.ticker.time);
      },
      onUpdate: (self) => {
        scroll = self.scroll();
        // Scroll-linked layers must stay registered with the native sticky
        // stage on every frame, including the overlapping hero handoff.
        lastScroll = scroll;
        lastPaint = gsap.ticker.time;
        paint(lastPaint);
      },
    });
    const tick = (time: number) => {
      if (document.hidden) return;
      // Only the ambient breeze is rate-limited; scrolling runs at display rate.
      if (scroll === lastScroll && time - lastPaint < 1 / 30) return;
      lastScroll = scroll;
      lastPaint = time;
      paint(time);
    };
    gsap.ticker.add(tick);
    paint(gsap.ticker.time);
    return () => {
      alive = false;
      trigger.kill();
      gsap.ticker.remove(tick);
      setNavDark(2, false);
      for (const element of copies) element.inert = false;
      for (const plate of plates) plate.style.removeProperty("visibility");
    };
  }, [narrow, reduced, aspect, length, knots, setNavDark]);

  return (
    <section
      ref={sectionRef}
      className={styles.section}
      data-act={2}
      data-still={reduced ? "true" : undefined}
      aria-label="A slower day at Mariva"
      style={css({ "--length": length, "--overhang": ACT2_OVERHANG })}
    >
      <div className={styles.stage}>
        <div ref={sceneRef} className={styles.viewport}>
          <div ref={backdropRef} className={styles.backdrop}>
            <Photo image={HORIZON} />
            <div ref={waterRef} className={styles.waterBackdrop}>
              <Photo image={HORIZON} />
            </div>
            <div ref={heroRef} className={styles.heroBackdrop}>
              <Photo image={HERO_PLATE} />
            </div>
          </div>
          <div ref={worldRef} className={styles.world}>
            {openings.map((aperture, index) => {
              const id = `${clipId}-photo-${index}`;
              return (
                <div
                  key={aperture.image.src}
                  className={styles.plate}
                  data-plate={index}
                  style={css({
                    "--x": centre(knots, aperture.y, 0, false) + aperture.dx,
                    "--y": aperture.y,
                    "--r": aperture.r,
                    "--stretch": aperture.stretch ?? 1,
                  })}
                >
                  <svg className={styles.clipDefinitions} aria-hidden="true">
                    <defs>
                      <clipPath id={id} clipPathUnits="objectBoundingBox">
                        <path
                          data-aperture-clip={index}
                          d={aperturePath(
                            {
                              ...aperture,
                              y: 0.5,
                              r: 1 / PLATE_BLEED,
                              stretch: 1,
                            },
                            0.5,
                            1,
                            1,
                          )}
                        />
                      </clipPath>
                    </defs>
                  </svg>
                  {index === 1 || index === 2 ? (
                    <RibbonSlider
                      image={aperture.image}
                      clipPath={`url(#${id})`}
                      reduced={reduced}
                      rooms={index === 1}
                      onSlideChange={index === 2 ? setTableSlide : undefined}
                    />
                  ) : (
                    <div
                      className={styles.photoCrop}
                      style={{ clipPath: `url(#${id})` }}
                    >
                      <div className={styles.photoDrift} data-photo-drift="">
                        <Photo
                          image={aperture.image}
                          sizes="(max-width: 700px) 85vw, 75vw"
                        />
                        {aperture.nextImage && (
                          <div className={styles.nextImage} data-next-image="">
                            <Photo
                              image={aperture.nextImage}
                              sizes="(max-width: 700px) 85vw, 75vw"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <svg
            ref={svgRef}
            className={styles.ribbon}
            viewBox={`0 ${-ACT2_OVERHANG} 100 ${reduced ? SCENE_LENGTH + ACT2_OVERHANG : 200}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <clipPath id={`${clipId}-shore`}>
                <path d={introShorePath()} />
              </clipPath>
              <clipPath id={`${clipId}-sheet`}>
                <path
                  ref={outlineRef}
                  d={ribbonPath({ ...staticOptions, apertures: [] })}
                />
              </clipPath>
            </defs>
            {!narrow && (
              <image
                href={HORIZON.src}
                x="-1"
                y="-8"
                width="70"
                height="110"
                preserveAspectRatio="xMidYMin slice"
                clipPath={`url(#${clipId}-shore)`}
              />
            )}
            <path
              ref={sheetRef}
              className={styles.sheet}
              fillRule="evenodd"
              clipPath={`url(#${clipId}-sheet)`}
              d={ribbonPath(staticOptions)}
            />
            {!narrow && (
              <g
                className={styles.chapterTrail}
                clipPath={`url(#${clipId}-sheet)`}
              >
                <path
                  d="M80 58C83 82 34 78 20 108"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <ellipse
                  cx="20"
                  cy="108"
                  rx="0.16"
                  ry={0.16 / aspect}
                  fill="currentColor"
                />
              </g>
            )}
          </svg>
          <div ref={copyWorldRef} className={styles.copyWorld}>
            {!narrow &&
              PROPS.map((prop) => (
                <div
                  key={prop.id}
                  className={styles.prop}
                  data-prop={prop.id}
                  aria-hidden="true"
                  style={css({
                    "--x": prop.x,
                    "--y": prop.y,
                    "--size": prop.size,
                    "--tilt": `${prop.tilt}deg`,
                  })}
                >
                  {prop.id === "olive-oil" ? (
                    <div className={styles.sauceStack} data-sauce={tableSlide}>
                      {[
                        prop.src,
                        "/images/act-2-ribbon/sauce-verde.webp",
                        "/images/act-2-ribbon/sauce-tomato.webp",
                      ].map((src, index) => (
                        <img
                          key={src}
                          src={src}
                          width={640}
                          height={584}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          style={{ opacity: tableSlide === index ? 1 : 0 }}
                        />
                      ))}
                    </div>
                  ) : (
                    <img
                      src={prop.src}
                      width={prop.width}
                      height={prop.height}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </div>
              ))}
            {BEATS.map((beat) => {
              const geometry =
                beat.aperture && geometryFor(beat.aperture, narrow, aspect);
              const y = narrow
                ? beat.y + (geometry ? geometry.r + 7 : -10)
                : beat.y - (beat.onPhoto ? 27 : beat.id === "light" ? 9 : 18);
              return (
                <div
                  key={beat.id}
                  className={styles.beat}
                  data-copy={beat.id}
                  data-beat={beat.id}
                  data-copy-y={y}
                  data-on-photo={beat.onPhoto || undefined}
                  style={css({ "--x": narrow ? 12 : beat.x, "--y": y })}
                >
                  {beat.id !== "horizon" && (
                    <p className={styles.marker}>
                      {beat.index && (
                        <span className={styles.index}>{beat.index}</span>
                      )}
                      {beat.id !== "light" && <span>{beat.label}</span>}
                    </p>
                  )}
                  <h2 className={styles.display}>
                    {beat.lines.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </h2>
                  {beat.note && <p className={styles.note}>{beat.note}</p>}
                  {beat.id === "light" && (
                    <a className={styles.actionLink} href="/booking">
                      Explore
                    </a>
                  )}
                  {beat.facts && (
                    <ul className={styles.facts}>
                      {beat.facts.map((fact) => (
                        <li key={fact}>{fact}</li>
                      ))}
                    </ul>
                  )}
                  {beat.action && (
                    <ChooseDatesLink
                      className={styles.actionLink}
                      context={beat.label}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <FoliageGobo className={styles.gobo} resolution={0.65} maskSize={256} />
    </section>
  );
}
