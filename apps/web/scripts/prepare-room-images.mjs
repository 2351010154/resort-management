// Cut the five room galleries out of the design-materials library.
//
// Usage:
//   node apps/web/scripts/prepare-room-images.mjs
//
// **A second, deliberately separate pipeline from `prepare-arrival-images.mjs`,
// and the separation is the same one `room-images.ts` argues.** That script
// curates the *arrival's* library and writes the *arrival's* manifest; sweeping a
// booking frame into it would put a `features/arrival/` import in the funnel's
// path, which the bundle budget forbids outright. It also dedups a whole library
// by average hash, which is the right tool for a scrape of unknown provenance and
// the wrong one here: these picks are named by hand, one at a time, and two
// frames of the same room from the same tripod position are *supposed* to survive
// as two.
//
// **Every frame is cut to 3:2 before it is scaled**, centred on the master. The
// list thumbnail, the stage and the browser's tier choice all assume one shape;
// a 1.48:1 master and a 1.62:1 master left alone would give two rooms different
// thumbnails in the same column. The crop is centred rather than chosen per file
// because these are interiors shot square-on — the subject is the room, and the
// room is in the middle of the frame.
//
// The map beside this file names the picks and their slugs. What it does *not*
// hold is `alt`: a photograph of a room is content, its description is writing,
// and writing belongs in `room-images.ts` beside the rest of the funnel's words
// rather than in a build artefact.

import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const SRC = "C:/Users/tamla/Downloads/design-materials/images";
const PROJECT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(PROJECT, "public", "images", "booking", "rooms");
const CURATION_MAP = path.join(import.meta.dirname, "room-curation-map.json");

/** Same three tiers the arrival ships, and the same reason: 640 covers a phone,
 *  1280 a laptop, 1920 the stage at two device pixels. */
const WIDTH_TIERS = [1920, 1280, 640];

/** A tier's real pixel width, read back so the `srcSet` descriptor cannot lie. */
async function probe(file) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    file,
  ]);
  const [width, height] = stdout.trim().split(",").map(Number);
  return { width, height };
}

async function cutInto(srcFile, slug, srcWidth) {
  const made = [];
  for (const tier of WIDTH_TIERS) {
    // Never upscale. The 3:2 crop is taken first, so the ceiling is the crop's
    // width rather than the master's — a 3840×2595 file crops to 3892 wide only
    // in arithmetic, and to 3840 in fact.
    const width = Math.min(tier, srcWidth);
    const dest = path.join(OUT_DIR, `${slug}-${tier}.webp`);
    await run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      srcFile,
      "-vf",
      // Centred 3:2 out of whatever the master is, then down to the tier. One
      // filter chain so the scale reads the cropped box rather than the master.
      `crop='min(iw,ih*3/2)':'min(ih,iw*2/3)',scale=${width}:-2:flags=lanczos`,
      "-quality",
      "80",
      dest,
    ]);
    made.push(dest);
  }
  return made;
}

const map = JSON.parse(await readFile(CURATION_MAP, "utf8"));
await mkdir(OUT_DIR, { recursive: true });

// Everything already there goes first. The set is named by the map now, and a
// left-over `superior-1160.webp` from a previous cut is a file the manifest does
// not know about, that nothing serves, and that the next reader would take for
// evidence of a tier that exists.
for (const name of await readdir(OUT_DIR)) {
  if (name.endsWith(".webp")) await unlink(path.join(OUT_DIR, name));
}

let frames = 0;
for (const [code, picks] of Object.entries(map)) {
  const sizes = [];
  for (const pick of picks) {
    const source = path.join(SRC, pick.file);
    const { width, height } = await probe(source);
    const cropWidth = Math.min(width, Math.round((height * 3) / 2));
    await cutInto(source, pick.slug, cropWidth);
    sizes.push(`${pick.slug} ${cropWidth}w`);
    frames += 1;
  }
  console.log(`${code}: ${sizes.join(", ")}`);
}

console.log(
  `\n${frames} frames × ${WIDTH_TIERS.length} tiers -> ${path.relative(PROJECT, OUT_DIR)}`,
);
