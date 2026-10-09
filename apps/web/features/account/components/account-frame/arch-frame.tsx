// A round-headed window: the house's arch, as a frame for a room.
//
// The landing cuts its pictures into soft architectural shapes, and the
// account frames a room the same way — a photograph in an arched frame with an
// ivory keyline inside its edge, standing on its sill. It is the one round
// shape a panel holds, so a guest's eye finds the room before the words about
// it.

import type { CSSProperties } from "react";
import styles from "./arch-frame.module.css";

export interface ArchPicture {
  readonly src: string;
  readonly srcSet: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  /** Where the photograph is held inside the frame, as `object-position`. */
  readonly position?: string;
}

export function ArchFrame({
  picture,
  sizes,
  className,
}: {
  readonly picture: ArchPicture;
  readonly sizes: string;
  readonly className?: string;
}) {
  const position: CSSProperties | undefined = picture.position
    ? { objectPosition: picture.position }
    : undefined;

  return (
    <figure className={className ? `${styles.arch} ${className}` : styles.arch}>
      <div className={styles.opening}>
        <img
          alt={picture.alt}
          className={styles.picture}
          decoding="async"
          height={picture.height}
          sizes={sizes}
          src={picture.src}
          srcSet={picture.srcSet}
          style={position}
          width={picture.width}
        />
      </div>
    </figure>
  );
}
