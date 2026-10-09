// The account's member card: a piece of the house's limestone, cut to the
// size of a card, with the house's name and the guest's carved into it.
//
// **The stone, as an object rather than a wall.** The account used to stand
// beside a full-height limestone pillar, and the pillar was the heaviest thing
// on the page while saying the least — one name on two-fifths of the screen.
// The owner kept the material and asked for the weight to go: so the stone is
// now the one thing a member is given, a card, and it sits in the head of the
// page opposite the guest's name, where the two balance rather than lean.
//
// **Nothing is laid on it.** Words are carved into the stone (`carving.tsx`) or
// engraved shallow, never printed on a plate over it. The card holds three
// things — the house's name, the standing and the guest's name — because a
// card that listed more would be a form.
//
// **It is lit by the house's hour, and it is not a control.** The light the
// frame reads (`house-hour.ts`, written to `data-light`) falls on the card: the
// foliage shadow from the east in the morning, short at midday, long and warm
// from the west before dusk, and a lamp after dark, swaying on a slow CSS loop.
// Nothing about it answers the pointer — no tilt, no lean, no hover — because
// a thing that moves under the cursor reads as something to press, and the
// card does nothing when pressed.
//
// One description for assistive technology, in the figure's caption: the
// carved copies are decoration, and the guest's name is already the page's
// heading.

import { type TierCode, tierName } from "@/features/account/lib/tiers";
import { Carved } from "./carving";
import styles from "./member-card.module.css";

/** The limestone, at its real pixel widths — portrait, 2:3. */
const STONE = {
  src: "/images/account/limestone-pillar-960.webp",
  srcSet: [640, 960, 1280, 1536]
    .map((width) => `/images/account/limestone-pillar-${width}.webp ${width}w`)
    .join(", "),
  width: 1536,
  height: 2304,
} as const;

/** The shadow as it falls from the west, and its mirror for the morning sun —
 *  a file of its own, so it sways about its own entry corner. */
const LEAVES = {
  west: leafCuts("leaf-shadow"),
  east: leafCuts("leaf-shadow-east"),
  width: 1536,
  height: 1024,
} as const;

function leafCuts(name: string): {
  readonly src: string;
  readonly srcSet: string;
} {
  return {
    src: `/images/account/${name}-768.webp`,
    srcSet: [768, 1536]
      .map((width) => `/images/account/${name}-${width}.webp ${width}w`)
      .join(", "),
  };
}

/** The light washes, one per light, crossfaded rather than re-drawn. */
const WASHES = ["morning", "daylight", "golden", "lamplight"] as const;

/** Names longer than these are cut a size down, so a four-word Vietnamese
 *  name still fits the card's foot in one or two lines. */
const MEDIUM_NAME = 15;
const LONG_NAME = 24;

export interface MemberCardFacts {
  readonly name: string;
  readonly tier: TierCode;
}

/**
 * The card, uncut until the account has been read: the stone is there from the
 * first paint, and the names are carved into it once, when they are known.
 */
export function MemberCard({
  facts,
}: {
  readonly facts: MemberCardFacts | undefined;
}) {
  return (
    <figure
      aria-hidden={facts ? undefined : true}
      className={styles.card}
      data-tier={facts?.tier}
    >
      <div aria-hidden="true" className={styles.body}>
        {/* A small paint in the first viewport, so it is fetched with the
            page rather than lazily. The image is set wider than the card so
            only the honed field shows, never the pillar's flutes. */}
        <img
          alt=""
          className={styles.stone}
          decoding="async"
          height={STONE.height}
          sizes="(width >= 40rem) 40rem, 175vw"
          src={STONE.src}
          srcSet={STONE.srcSet}
          width={STONE.width}
        />

        {WASHES.map((light) => (
          <span className={styles.wash} data-for={light} key={light} />
        ))}

        <div className={styles.face}>
          <span className={styles.mark}>
            <span className={styles.markLip} />
            <span className={styles.markCut} />
          </span>

          {facts ? (
            <>
              <span className={styles.tier}>{tierName(facts.tier)}</span>
              <Carved className={nameClass(facts.name)} text={facts.name} />
            </>
          ) : null}
        </div>

        {/* Two rigs for one shadow — the branch entering from the west, and
            its mirror for the morning sun from the east — because a shadow
            cannot be eased from one side of a card to the other. Multiplied
            over the stone and its carvings. */}
        {(["west", "east"] as const).map((from) => (
          <div className={styles.rig} data-from={from} key={from}>
            <img
              alt=""
              className={styles.leaves}
              decoding="async"
              height={LEAVES.height}
              sizes="(width >= 40rem) 23rem, 100vw"
              src={LEAVES[from].src}
              srcSet={LEAVES[from].srcSet}
              width={LEAVES.width}
            />
          </div>
        ))}

        <span className={styles.edge} />
      </div>

      {facts ? (
        <figcaption className={styles.caption}>
          {`${tierName(facts.tier)} member card for ${facts.name}`}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** The name's size, by its length in characters rather than code units. */
function nameClass(name: string): string {
  const length = [...name].length;

  if (length > LONG_NAME) {
    return `${styles.name} ${styles.long}`;
  }

  if (length > MEDIUM_NAME) {
    return `${styles.name} ${styles.medium}`;
  }

  return styles.name;
}
