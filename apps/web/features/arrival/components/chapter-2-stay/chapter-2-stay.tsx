// Chapter 2 — "Stay". The five types, indexed, in an aperture crop each.
//
// A bookable room in the second chapter is the point of the whole reordering, so
// this is the plainest section on the page: name, five facts, the two sentences
// the property says about the type, and the two things a reader can do about it.
// Every one of those facts is readable sitting still — the deck is a document,
// and the horizontal track is how it is arranged, not how it is revealed.
//
// The facts come from `features/booking/lib/room-types.ts`, which is the one place
// the code reads `property-and-tariff.md` §1's type mix from. The funnel's room
// list and this deck therefore cannot disagree about a size or a bed, which is
// exactly the failure a second copy typed into a marketing component would be.
// The one row that file does not carry is how many rooms of a type the house
// holds — the funnel never needed it — so §1's counts sit in
// `arrival/content/house-facts.ts` beside the total, and nothing here is typed.

import { ROOM_TYPES } from "@/features/booking/lib/room-types";
import {
  ROOM_COUNT,
  ROOM_COUNT_IN_WORDS,
  roomsOfType,
} from "@/features/arrival/content/house-facts";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { ApertureFrame } from "@/features/arrival/components/aperture/aperture-frame";
import { RoomActions } from "./room-actions";
import styles from "./chapter-2-stay.module.css";

/**
 * The photograph each type stands on today.
 *
 * The house has no room library of its own yet; these are the nearest frames
 * already cut for the arrival, matched to the aspect each type is sold on —
 * courtyard quiet, garden, city, corner light, the largest room in the house.
 * The manifest is generated from a library outside the repo, so replacing one is
 * a change to this map and to nothing else.
 */
const PLATE_BY_CODE: Record<string, string> = {
  SUPERIOR: "room-cedar",
  DELUXE: "room-mori",
  PREMIER: "room-park",
  JUNIOR_SUITE: "room-washigamine",
  PANORAMA_SUITE: "room-sky-lounge",
};

/** Throws at module scope if a type names a frame the manifest does not carry —
 *  the only useful moment to find out that a card would draw nothing. */
const plateFor = (code: string) => {
  const match = PLATE_BY_CODE[code];
  const image = arrivalImages["act-4-rooms"].find((img) =>
    img.src.includes(match),
  );
  if (!image) throw new Error(`No act-4-rooms image matching "${match}"`);
  return image;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function Chapter2Stay() {
  const total = pad(ROOM_TYPES.length);

  return (
    <section data-act={2} className={styles.section}>
      <header className={styles.head}>
        <span className={`caps-label ${styles.eyebrow}`}>Stay</span>
        <h2 className={`font-display ${styles.headline}`}>
          {ROOM_COUNT_IN_WORDS} rooms, five ways to take one.
        </h2>
      </header>

      <ol className={styles.track}>
        {ROOM_TYPES.map((type, index) => {
          const plate = plateFor(type.code);
          return (
            <li key={type.code} className={styles.card}>
              <div className={styles.facts}>
                <span className={`caps-label ${styles.index}`}>
                  {pad(index + 1)} / {total}
                </span>
                <h3 className={`font-display ${styles.name}`}>{type.name}</h3>
                <dl className={styles.table}>
                  <div className={styles.row}>
                    <dt className="caps-label">Rooms</dt>
                    {/* §1's type mix. The one fact a reader cannot get from the
                        photograph or from the four rows under it: how much of
                        the house is this room. */}
                    <dd className={styles.value}>
                      {roomsOfType(type.code)} of {ROOM_COUNT}
                    </dd>
                  </div>
                  <div className={styles.row}>
                    <dt className="caps-label">Size</dt>
                    <dd className={styles.value}>{type.squareMetres} m²</dd>
                  </div>
                  <div className={styles.row}>
                    <dt className="caps-label">Sleeps</dt>
                    <dd className={styles.value}>up to {type.maxOccupancy}</dd>
                  </div>
                  <div className={styles.row}>
                    <dt className="caps-label">Bedding</dt>
                    <dd className={styles.value}>{type.bedding}</dd>
                  </div>
                  <div className={styles.row}>
                    <dt className="caps-label">Aspect</dt>
                    <dd className={styles.value}>{type.aspect}</dd>
                  </div>
                </dl>
                <p className={styles.says}>{type.description}</p>
                {/* The one client island in the deck: both actions read the
                    page's booking draft, and the cards around them stay server
                    components that ship no JavaScript. */}
                <RoomActions name={type.name} />
              </div>

              <ApertureFrame ratio="4 / 5" className={styles.plate}>
                <img
                  src={tierSrc(plate.src, 1280)}
                  srcSet={tierSrcSet(plate)}
                  sizes="(max-width: 767px) 90vw, 34vw"
                  width={plate.width}
                  height={plate.height}
                  alt={plate.alt}
                  loading="lazy"
                  decoding="async"
                />
              </ApertureFrame>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
