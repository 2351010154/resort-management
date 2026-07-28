import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROOM_IMAGES, tierSrc, tierSrcSet } from "./room-images";
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

describe("the room leads", () => {
  it("has one for every type", () => {
    for (const type of ROOM_TYPES) {
      expect(ROOM_IMAGES[type.code]).toBeDefined();
    }
    expect(Object.keys(ROOM_IMAGES)).toHaveLength(ROOM_TYPES.length);
  });

  it("names only tiers that exist on disk", () => {
    for (const type of ROOM_TYPES) {
      const image = ROOM_IMAGES[type.code];
      for (const tier of image.tiers) {
        const file = path.join(PUBLIC, tierSrc(image.src, tier));
        expect(existsSync(file), `missing ${file}`).toBe(true);
      }
    }
  });

  it("describes each tier at the width the file really is", () => {
    // The `w` descriptor is a promise about the file. A 1520px file offered as
    // 1920w is a browser told it can have detail that is not there.
    for (const type of ROOM_TYPES) {
      const image = ROOM_IMAGES[type.code];
      for (const tier of image.tiers) {
        const size = webpSize(path.join(PUBLIC, tierSrc(image.src, tier)));
        expect(size.width, `${image.src} @ ${tier}`).toBe(tier);
      }
    }
  });

  it("carries the intrinsic size of its largest tier", () => {
    for (const type of ROOM_TYPES) {
      const image = ROOM_IMAGES[type.code];
      const size = webpSize(path.join(PUBLIC, image.src));

      expect({ width: image.width, height: image.height }).toEqual(size);
      expect(Math.max(...image.tiers)).toBe(image.width);
    }
  });

  it("has meaningful alt text that does not repeat the room's name", () => {
    // §7's rule: these are content, so never `alt=""`. And the name is rendered
    // beside the frame inside the same button — an alt that says it again makes
    // a screen reader say it twice.
    for (const type of ROOM_TYPES) {
      const { alt } = ROOM_IMAGES[type.code];

      expect(alt.length).toBeGreaterThan(20);
      expect(alt.endsWith(".")).toBe(true);
      expect(alt.toLowerCase()).not.toContain(type.name.toLowerCase());
    }
  });

  it("builds a srcSet in ascending width order", () => {
    const set = tierSrcSet(ROOM_IMAGES.SUPERIOR);

    expect(set).toBe(
      "/images/booking/rooms/superior-640.webp 640w, " +
        "/images/booking/rooms/superior-1280.webp 1280w, " +
        "/images/booking/rooms/superior-1520.webp 1520w",
    );
  });

  it("keeps the funnel out of the arrival's library", () => {
    // §5's budget: everything under `features/arrival/` reaches `three`
    // eventually, so these files are referenced by hand and live under their own
    // folder rather than being swept into the generated manifest.
    for (const type of ROOM_TYPES) {
      expect(ROOM_IMAGES[type.code].src).toMatch(/^\/images\/booking\/rooms\//);
    }
  });
});
