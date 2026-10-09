"use client";

// The frame both account screens stand in: the stone and the book.
//
// **Two materials side by side, not one laid over the other.** The guest's
// account holds two kinds of thing — what the house knows them by, which is
// set, and what they keep, which they edit and read. So the frame is a
// limestone pillar for the first and an ivory book for the second, meeting at
// a shadow gap: the name cut in stone beside the details written in a book.
// The pillar holds the window's height while the book scrolls past it, the
// way a wall stays put while you turn pages in front of it.
//
// The composition the profile used to borrow — a photograph-band with a plate
// ridden up over its foot — is the dates step's, and the dates step keeps it.
// Nothing in this frame overlaps anything else: the bar stands at the head of
// the book (above the stone, on a phone), and the stone holds only what is cut
// into it — the house's mark and one line of the guest's, and on the stays
// page the arch. Everything else is the book's to say.
//
// **The light is read once, here.** The pillar is lit by it and the book warms
// under lamplight, so the frame reads the house's clock for both and writes the
// light to `data-light`, which every stylesheet below keys on. It is read in an
// effect and never during render: these pages are prerendered, and an hour
// rendered at build time would be the build's.

import { type ReactNode, useEffect, useState } from "react";
import { type HouseLight, houseLight } from "@/features/account/lib/house-hour";
import { AccountBar, type AccountPlace } from "./account-bar";
import styles from "./account-frame.module.css";
import { StonePillar } from "./stone-pillar";

export function AccountFrame({
  here,
  stone,
  children,
}: {
  readonly here: AccountPlace;
  /** What is cut into the stone's field for this screen. */
  readonly stone: ReactNode;
  /** The book: everything the guest reads and works on. */
  readonly children: ReactNode;
}) {
  const light = useHouseLight();

  return (
    <div className={styles.frame} data-light={light}>
      <div className={styles.barSlot}>
        <AccountBar here={here} />
      </div>

      <main className={styles.main}>
        <StonePillar>{stone}</StonePillar>
        <div className={styles.book}>
          <div className={styles.page}>{children}</div>
        </div>
      </main>
    </div>
  );
}

/**
 * The light the house is in, kept current.
 *
 * Read again just past each minute boundary, so a page left open across 15:30
 * or 18:00 changes light within a minute of the property's clock doing so. The
 * stylesheets ease the change over a few seconds, the way the real light goes.
 */
function useHouseLight(): HouseLight | undefined {
  const [light, setLight] = useState<HouseLight>();

  useEffect(() => {
    let timer = 0;

    const read = () => {
      const now = new Date();

      setLight(houseLight(now));
      timer = window.setTimeout(read, 60_000 - (now.getTime() % 60_000) + 50);
    };

    read();

    return () => window.clearTimeout(timer);
  }, []);

  return light;
}
