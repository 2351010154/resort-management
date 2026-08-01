import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ROOM_GALLERIES,
  ROOM_TIERS,
  roomGallery,
  roomLead,
  tierSrc,
  tierSrcSet,
} from "./room-images";
import { ROOM_TYPES } from "./room-types";

// `room-images.ts` is written by hand, which is the whole reason it needs a
// test: a `srcSet` naming a file that is not there is a 404 the browser recovers
// from silently, and a `width` that does not match the file is a layout shift
// nobody sees on a fast machine.

const PUBLIC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "public",
);

/** Intrinsic size of a lossy WebP, from its VP8 keyframe header. */
function webpSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.toString("ascii", 12, 16)).toBe("VP8 ");
  return {
    width: bytes.readUInt16LE(26) & 0x3fff,
    height: bytes.readUInt16LE(28) & 0x3fff,
  };
}

const everyFrame = ROOM_TYPES.flatMap((type) =>
  roomGallery(type.code).map((frame) => ({ type, frame })),
);

describe("the room galleries", () => {
  it("has one for every type, and more than one frame in each", () => {
    for (const type of ROOM_TYPES) {
      // A single-frame gallery is the case the stage cannot draw honestly: its
      // counter would read "1 / 1" and its arrows would go nowhere.
      expect(roomGallery(type.code).length).toBeGreaterThan(1);
    }
    expect(Object.keys(ROOM_GALLERIES)).toHaveLength(ROOM_TYPES.length);
  });

  it("leads with the first frame", () => {
    for (const type of ROOM_TYPES) {
      expect(roomLead(type.code)).toBe(roomGallery(type.code)[0]);
    }
  });

  it("names no frame twice, within a room or across them", () => {
    // Two rooms sharing a photograph is the failure the whole set is picked
    // against: a guest who sees the same bed on two rows learns nothing from
    // either.
    const sources = everyFrame.map(({ frame }) => frame.src);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("names only tiers that exist on disk", () => {
    for (const { frame } of everyFrame) {
      for (const tier of ROOM_TIERS) {
        const file = path.join(PUBLIC, tierSrc(frame.src, tier));
        expect(existsSync(file), `missing ${file}`).toBe(true);
      }
    }
  });

  it("describes each tier at the width the file really is", () => {
    // The `w` descriptor is a promise about the file. A 1520px file offered as
    // 1920w is a browser told it can have detail that is not there.
    for (const { frame } of everyFrame) {
      for (const tier of ROOM_TIERS) {
        const size = webpSize(path.join(PUBLIC, tierSrc(frame.src, tier)));
        expect(size.width, `${frame.src} @ ${tier}`).toBe(tier);
      }
    }
  });

  it("carries the intrinsic size of its largest tier", () => {
    for (const { frame } of everyFrame) {
      const size = webpSize(path.join(PUBLIC, frame.src));

      expect({ width: frame.width, height: frame.height }).toEqual(size);
      expect(Math.max(...ROOM_TIERS)).toBe(frame.width);
    }
  });

  it("has meaningful alt text that does not repeat the room's name", () => {
    // §7's rule: these are content, so never `alt=""`. And the name is rendered
    // beside the frame in the list and again on the stage — an alt that says it
    // again makes a screen reader say it twice.
    for (const { type, frame } of everyFrame) {
      expect(frame.alt.length).toBeGreaterThan(20);
      expect(frame.alt.endsWith(".")).toBe(true);
      expect(frame.alt.toLowerCase()).not.toContain(type.name.toLowerCase());
    }
  });

  it("builds a srcSet in ascending width order", () => {
    const set = tierSrcSet(roomLead("SUPERIOR"));

    expect(set).toBe(
      "/images/booking/rooms/superior-1-640.webp 640w, " +
        "/images/booking/rooms/superior-1-1280.webp 1280w, " +
        "/images/booking/rooms/superior-1-1920.webp 1920w",
    );
  });

  it("keeps the funnel out of the arrival's library", () => {
    // §5's budget: everything under `features/arrival/` reaches `three`
    // eventually, so these files are referenced by hand and live under their own
    // folder rather than being swept into the generated manifest.
    for (const { frame } of everyFrame) {
      expect(frame.src).toMatch(/^\/images\/booking\/rooms\//);
    }
  });
});
