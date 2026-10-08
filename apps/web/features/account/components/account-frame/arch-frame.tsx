// A round-headed window: the house's arch, as a frame for a room.
//
// **Two settings, one shape.** On the ivory book it is a photograph in an
// arched frame, the way the landing cuts its pictures into soft architectural
// shapes. On the stone it is an *opening* — cut through the wall, with the
// wall's thickness showing as a shaded reveal around it — because the stone
// holds nothing laid on it, and a picture on stone can only be something seen
// through it.
//
// **It can hold several rooms and show one.** The stays page points it at
// whichever stay the guest is reading; every room it may be asked for is
// already in it, stacked, and the one showing is chosen by `active`, so moving
// down the list crossfades rather than waits on a download.

import type { CSSProperties } from "react";
import styles from "./arch-frame.module.css";

export interface ArchPicture {
  /** Identifies the picture for `active` — a room type code, say. */
  readonly key: string;
  readonly src: string;
  readonly srcSet: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  /** Where the photograph is held inside the frame, as `object-position`. */
  readonly position?: string;
}

export function ArchFrame({
  setting,
  pictures,
  active,
  sizes,
  decorative = false,
  muted = false,
  className,
}: {
  readonly setting: "paper" | "stone";
  readonly pictures: readonly ArchPicture[];
  readonly active: string | undefined;
  readonly sizes: string;
  /** True where the words beside the frame already say what it shows. */
  readonly decorative?: boolean;
  /** A stay that did not happen is shown in a drained light. */
  readonly muted?: boolean;
  readonly className?: string;
}) {
  return (
    <figure
      aria-hidden={decorative || undefined}
      className={className ? `${styles.arch} ${className}` : styles.arch}
      data-muted={muted ? "" : undefined}
      data-setting={setting}
    >
      <div className={styles.opening}>
        {pictures.map((picture) => {
          const showing = picture.key === active;
          const position: CSSProperties | undefined = picture.position
            ? { objectPosition: picture.position }
            : undefined;

          return (
            <img
              alt={showing && !decorative ? picture.alt : ""}
              aria-hidden={showing && !decorative ? undefined : true}
              className={styles.picture}
              data-showing={showing ? "" : undefined}
              decoding="async"
              height={picture.height}
              key={picture.key}
              loading="lazy"
              sizes={sizes}
              src={picture.src}
              srcSet={picture.srcSet}
              style={position}
              width={picture.width}
            />
          );
        })}
      </div>
    </figure>
  );
}
