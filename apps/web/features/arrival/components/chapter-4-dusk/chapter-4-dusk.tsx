// Chapter 4 — the dusk hinge. The one place the page changes its hour.
//
// The loop sits inside the aperture at its widest crop, and the ground under it
// runs from the ivory the last three chapters stood on to the ink the next four
// do. That flip is the chapter's entire content: everything above it is the house
// by day, everything below it is the house after dark.
//
// Static here by design. The frame holds the loop's first frame — the same poster
// the swell has always used — so the hinge reads with every scrub disabled.
// Phase 4 gives this section `video-swell`'s mechanic: the frame scales inside the
// aperture and the `--dusk` grade runs the light down as it goes. The markup it
// needs is already the markup below.

import { ApertureFrame } from "@/features/arrival/components/aperture/aperture-frame";
import styles from "./chapter-4-dusk.module.css";

export function Chapter4Dusk() {
  return (
    <section data-act={4} className={styles.section}>
      <div className={styles.stage}>
        <ApertureFrame ratio="16 / 9" tone="ink" className={styles.frame}>
          {/* No autoplay and no controls in this phase: the poster is the frame,
              and a loop that starts itself is motion this phase has switched off.
              Phase 4 plays it in view, muted, as `video-swell` already does. */}
          <video
            muted
            loop
            playsInline
            preload="none"
            poster="/video/arrival-loop-poster.webp"
          >
            <source src="/video/arrival-loop.webm" type="video/webm" />
            <source src="/video/arrival-loop.mp4" type="video/mp4" />
          </video>
        </ApertureFrame>

        {/* A caption on the film, and only that. The sentence that used to sit
            under it — "the house turns to its evening" — said nothing a reader
            could check or act on, and this chapter's content is the footage. */}
        <div className={styles.caption}>
          <span className={`caps-label ${styles.label}`}>
            The approach, at dusk
          </span>
        </div>
      </div>
    </section>
  );
}
