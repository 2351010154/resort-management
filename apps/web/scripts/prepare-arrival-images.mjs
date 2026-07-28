// Dedup + curate + resize the design-materials image library into public/images/.
//
// Usage:
//   node apps/web/scripts/prepare-arrival-images.mjs dry-run   -> cluster report only, no writes outside scratch
//   node apps/web/scripts/prepare-arrival-images.mjs run       -> resize curated picks into public/images/<act>/
//
// Dedup is content-based (8x8 average-hash via ffmpeg), NOT name-based:
// scrape dupes carry `_N` suffixes, but some originals also end in `_NN`
// (e.g. Amanemu_Gallery_10 is a distinct shot) so name-stripping alone would
// wrongly merge distinct shots. Within a cluster we keep the largest-area file.
//
// The library also grows by dated drop folders. Those are walked as part of the
// same pool rather than as pools of their own: a drop routinely re-supplies a
// shot the root already has, at a different size, and clustering per folder
// would let both through as if they were two photographs.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, stat, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);

const SRC = "C:/Users/tamla/Downloads/design-materials/images";
const PROJECT = path.resolve(import.meta.dirname, "..");
const OUT_ROOT = path.join(PROJECT, "public", "images");
const CURATION_MAP = path.join(
  import.meta.dirname,
  "arrival-curation-map.json",
);
const REPORT = path.join(import.meta.dirname, "dedup-report.json");

const MIN_BYTES = 15 * 1024; // below this: favicons, throbbers, ui sprites
const PHOTO_EXT = new Set([".webp", ".jpg", ".jpeg"]);
const HAMMING_SAME = 6; // aHash distance at/below which two files are the same shot
/**
 * Aspect ratios must also agree to within this before two files are called the
 * same shot. A 64-bit average hash is a coarse thing — it sees an aerial coast
 * at dusk and a golf green under mountains as one broad light-over-dark
 * gradient, and merged them at distance 5 — and the cost of that is silent: the
 * bigger file wins the cluster and a curated pick vanishes from the manifest.
 * Proportion is the cheap second opinion. Re-crops of one shot do differ here,
 * but they land in clusters of their own rather than in each other's, and the
 * curation map names the crop it wants either way.
 */
const RATIO_SAME = 0.08;
const WIDTH_TIERS = [1920, 1280, 640];

// Every photo under SRC, keyed by its path relative to SRC — which is also the
// `file` a curation pick is written with, so a pick from a drop folder reads
// `27-7-2026/name.jpg`.
async function listPhotos(dir = SRC, prefix = "") {
  const photos = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) {
      photos.push(
        ...(await listPhotos(path.join(dir, entry.name), `${name}/`)),
      );
      continue;
    }
    if (!PHOTO_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    const s = await stat(path.join(dir, entry.name));
    if (s.size < MIN_BYTES) continue;
    photos.push({ name, bytes: s.size });
  }
  return photos;
}

async function probeDims(file) {
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
  const [w, h] = stdout.trim().split(",").map(Number);
  return { w, h };
}

// 64-bit average hash: scale to 8x8 grayscale, threshold each pixel vs mean.
async function aHash(file) {
  const { stdout } = await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-vf",
      "scale=8:8:flags=area,format=gray",
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 1024 * 1024 },
  );
  const px = stdout.subarray(0, 64);
  const mean = px.reduce((a, b) => a + b, 0) / px.length;
  let bits = 0n;
  for (let i = 0; i < 64; i++) if (px[i] > mean) bits |= 1n << BigInt(i);
  return bits;
}

function hamming(a, b) {
  let x = a ^ b,
    n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

// Two files are the same shot when they look alike AND are the same shape.
const sameShot = (a, b) =>
  hamming(a.hash, b.hash) <= HAMMING_SAME &&
  Math.abs(Math.log(a.w / a.h / (b.w / b.h))) <= RATIO_SAME;

// Union-find clustering over pairs the test above accepts.
function cluster(entries) {
  const parent = entries.map((_, i) => i);
  const find = (i) => {
    if (parent[i] === i) return i;
    parent[i] = find(parent[i]);
    return parent[i];
  };
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++)
      if (sameShot(entries[i], entries[j])) parent[find(i)] = find(j);
  const groups = new Map();
  entries.forEach((e, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(e);
  });
  return [...groups.values()];
}

function best(group) {
  return group
    .slice()
    .sort((a, b) => b.w * b.h - a.w * a.h || b.bytes - a.bytes)[0];
}

async function analyze() {
  const photos = await listPhotos();
  console.log(`photos after junk filter: ${photos.length}`);
  const entries = await mapLimit(photos, 8, async (p) => {
    const file = path.join(SRC, p.name);
    const [dims, hash] = await Promise.all([probeDims(file), aHash(file)]);
    return { ...p, ...dims, hash };
  });
  const groups = cluster(entries).sort((a, b) => b.length - a.length);
  console.log(`unique shots (clusters): ${groups.length}`);
  return groups;
}

async function dryRun() {
  const groups = await analyze();
  const report = groups.map((g) => {
    const keep = best(g);
    return {
      keep: keep.name,
      w: keep.w,
      h: keep.h,
      copies: g.length,
      dropped: g
        .filter((e) => e !== keep)
        .map((e) => `${e.name} (${e.w}x${e.h})`),
    };
  });
  await writeFile(REPORT, JSON.stringify(report, null, 2));
  for (const r of report)
    console.log(`${String(r.copies).padStart(3)}x  ${r.w}x${r.h}  ${r.keep}`);
  console.log(`\nreport -> ${REPORT}`);
}

async function resizeInto(srcFile, destDir, baseName, srcW) {
  await mkdir(destDir, { recursive: true });
  const made = [];
  for (const tier of WIDTH_TIERS) {
    if (tier > srcW && made.length > 0) continue; // never upscale; always emit at least one tier
    const w = Math.min(tier, srcW);
    const dest = path.join(destDir, `${baseName}-${tier}.webp`);
    await run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      srcFile,
      "-vf",
      `scale=${w}:-2:flags=lanczos`,
      "-quality",
      "80",
      dest,
    ]);
    made.push(dest);
  }
  return made;
}

async function executeRun() {
  const map = JSON.parse(await readFile(CURATION_MAP, "utf8"));
  const groups = await analyze();
  const keepers = new Map(
    groups.map((g) => {
      const k = best(g);
      return [k.name, k];
    }),
  );
  let missing = 0;
  const manifest = {};
  for (const [act, picks] of Object.entries(map)) {
    const destDir = path.join(OUT_ROOT, act);
    let actBytes = 0;
    manifest[act] = [];
    for (const pick of picks) {
      const entry = keepers.get(pick.file);
      if (!entry) {
        console.error(`MISSING (not a cluster keeper): ${pick.file}`);
        missing++;
        continue;
      }
      const made = await resizeInto(
        path.join(SRC, pick.file),
        destDir,
        pick.slug,
        entry.w,
      );
      for (const f of made) actBytes += (await stat(f)).size;
      const largest = made[0];
      const dims = await probeDims(largest);
      manifest[act].push({
        src: `/images/${act}/${path.basename(largest)}`,
        width: dims.w,
        height: dims.h,
        tiers: made.map((f) => Number(f.match(/-(\d+)\.webp$/)[1])),
        alt: pick.alt,
        role: pick.role,
      });
    }
    console.log(
      `${act}: ${picks.length} picks, ${(actBytes / 1024 / 1024).toFixed(2)} MB`,
    );
  }
  await writeManifest(manifest);
  if (missing) process.exitCode = 1;
}

// Emit the typed manifest consumed by section components.
async function writeManifest(manifest) {
  const dest = path.join(
    PROJECT,
    "features",
    "arrival",
    "lib",
    "image-manifest.ts",
  );
  const body = `// GENERATED by apps/web/scripts/prepare-arrival-images.mjs — do not edit by hand.

export type ImageRole =
  | "converge-field" | "orbit" | "corridor-panel" | "room-card"
  | "chapter-plate" | "breather" | "invitation-bg" | "island-card";

export interface ArrivalImage {
  /** Path of the largest generated tier under public/. */
  src: string;
  width: number;
  height: number;
  /** Available width tiers; swap the trailing -<w>.webp to pick one. */
  tiers: number[];
  alt: string;
  role: ImageRole;
}

export const arrivalImages = ${JSON.stringify(manifest, null, 2)} as const satisfies Record<string, readonly ArrivalImage[]>;

export type ActKey = keyof typeof arrivalImages;
`;
  await writeFile(dest, body);
  console.log(`manifest -> ${dest}`);
}

const mode = process.argv[2];
if (mode === "dry-run") await dryRun();
else if (mode === "run") await executeRun();
else {
  console.error("usage: prepare-arrival-images.mjs dry-run|run");
  process.exit(1);
}
