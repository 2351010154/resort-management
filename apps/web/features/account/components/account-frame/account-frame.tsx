"use client";

// The frame both account screens stand in: a centred page, its head, and the
// panels under it.
//
// **Balanced, not leaning.** The frame this replaces stood the page on a
// full-height limestone pillar beside an ivory column, and the pillar took
// two-fifths of the window to hold one name while the column beside it ran
// long and loose. So the page is centred now, at a measure a wide window
// cannot stretch: the screen's heading and its few facts on the left of the
// head, the member card opposite them on the right, and every part of the
// screen below it in a panel of its own, on the warmer ground of the page.
//
// **The light is read once, here.** The card is lit by the house's hour, so
// the frame reads the property's clock and writes the light to `data-light`,
// which the card's stylesheet keys on. It is read in an effect and never
// during render: these pages are prerendered, and an hour rendered at build
// time would be the build's.

import { type ReactNode, useEffect, useState } from "react";
import { type HouseLight, houseLight } from "@/features/account/lib/house-hour";
import { AccountBar, type AccountPlace } from "./account-bar";
import styles from "./account-frame.module.css";
import { MemberCard, type MemberCardFacts } from "./member-card";

export function AccountFrame({
  here,
  heading,
  card,
  children,
}: {
  readonly here: AccountPlace;
  /** The screen's `AccountHeading`, on the left of the head. */
  readonly heading: ReactNode;
  /** What the member card carries; uncut until the account is read. */
  readonly card: MemberCardFacts | undefined;
  /** The screen's panels. */
  readonly children: ReactNode;
}) {
  const light = useHouseLight();

  return (
    <div className={styles.frame} data-light={light}>
      <div className={styles.page}>
        <AccountBar here={here} />

        <main className={styles.main}>
          <header className={styles.head}>
            <div className={styles.headText}>{heading}</div>
            <div className={styles.headCard}>
              <MemberCard facts={card} />
            </div>
          </header>

          <div className={styles.body}>{children}</div>
        </main>
      </div>
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
