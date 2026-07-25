// Cut the intro's moving cards out of the Aman master film.
//
// The master is cut fast — most of its shots run 1-2.5s — so every window here
// sits wholly inside one shot, with a margin either side of the cut. Anything
// that straddles a cut dissolves between two different images at the loop
// point, which reads as a glitch rather than a loop.
//
// Two ways to close the loop:
//   pingpong  play forward then backward. Seamless by construction, and on a
//             slow architectural drift the reversal is invisible. The only
//             option for the sub-2.5s shots.
//   crossfade fade the clip's own tail back over its head. Needs a shot long
//             enough to spend ~0.5s on the blend, but keeps motion going one
//             way — which is what the hammam hands need.
//
// The tiles play at card size behind the monogram lens, so they are encoded
// small; the whole set costs about as much as one full-width hero video.
//
// Writes public/video/intro/<slug>.{webm,mp4,webp} and regenerates
// lib/intro-video-manifest.ts.
//
// Usage: node scripts/encode-intro-video-tiles.mjs

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);

const SRC = "C:/Users/tamla/Downloads/design-materials/landing-page.mp4";
const OUT = path.resolve(import.meta.dirname, "..", "public", "video", "intro");
const MANIFEST = path.resolve(import.meta.dirname, "..", "lib", "intro-video-manifest.ts");

/** Source is 1920x1080 at 25fps; crops are centred windows of it. */
const SRC_W = 1920;
const SRC_H = 1080;
const SRC_FPS = 25;
/** Length of the crossfade wrap, seconds. */
const WRAP = 0.5;

// `shot` records the master's own cut points, so the margin between it and
// (start, start+hold) is auditable when the film is re-graded or re-cut.
const TILES = [
  { slug: "atlas-ridge", shot: [7.12, 9.12], start: 7.30, hold: 1.72,
    aspect: [16, 9], width: 960, loop: "pingpong",
    alt: "Cloud shadow crossing the Atlas foothills" },
  { slug: "arch-garden", shot: [13.72, 15.52], start: 13.90, hold: 1.50,
    aspect: [3, 4], width: 540, loop: "pingpong",
    alt: "Palms framed by a keyhole arch" },
  { slug: "terracotta-corridor", shot: [15.52, 17.64], start: 15.72, hold: 1.78,
    aspect: [1, 1], width: 640, loop: "pingpong",
    alt: "A porter crossing a terracotta corridor" },
  { slug: "hammam-hands", shot: [34.72, 43.72], start: 35.40, hold: 4.00,
    aspect: [16, 9], width: 960, loop: "crossfade",
    alt: "Hands working oil across a shoulder" },
  { slug: "pool-teal", shot: [43.72, 46.60], start: 43.95, hold: 2.45,
    aspect: [4, 5], width: 576, loop: "pingpong",
    alt: "Green tiled water at the pool edge" },
  { slug: "colonnade-walk", shot: [49.20, 51.32], start: 49.40, hold: 1.80,
    aspect: [3, 4], width: 540, loop: "pingpong",
    alt: "A colonnade opening onto the garden" },
];

/** Centred crop of the source at the tile's aspect, as an ffmpeg crop filter. */
function cropFilter([aw, ah]) {
  let w = SRC_W;
  let h = Math.round((SRC_W * ah) / aw);
  if (h > SRC_H) {
    h = SRC_H;
    w = Math.round((SRC_H * aw) / ah);
  }
  w -= w % 2;
  h -= h % 2;
  return `crop=${w}:${h}:${Math.round((SRC_W - w) / 2)}:${Math.round((SRC_H - h) / 2)}`;
}

const even = (n) => n - (n % 2);

/** trim -> crop -> scale, shared by both loop modes. */
function sourceChain(tile) {
  const height = even(Math.round((tile.width * tile.aspect[1]) / tile.aspect[0]));
  return `[0:v]trim=start=${tile.start}:duration=${tile.hold},setpts=PTS-STARTPTS,` +
    `${cropFilter(tile.aspect)},scale=${even(tile.width)}:${height}`;
}

/**
 * Forward then backward. The reverse arm drops its first and last frames,
 * which are duplicates of the frames either side of it once concatenated.
 */
function pingpongFilter(tile) {
  const frames = Math.round(tile.hold * SRC_FPS);
  return `${sourceChain(tile)},split[f][r];` +
    `[r]reverse,trim=start_frame=1:end_frame=${frames - 1},setpts=PTS-STARTPTS[rv];` +
    `[f][rv]concat=n=2:v=1:a=0,format=yuv420p[v]`;
}

/**
 * Overlay the alpha-faded tail on the head. `xfade` cannot do this in one pass
 * because both halves come from the same input.
 */
function crossfadeFilter(tile) {
  const body = tile.hold - WRAP;
  return `${sourceChain(tile)},split[a][b];` +
    `[a]trim=0:${body},setpts=PTS-STARTPTS[head];` +
    `[b]trim=${body}:${tile.hold},setpts=PTS-STARTPTS,format=yuva420p,` +
    `fade=t=out:st=0:d=${WRAP}:alpha=1[tail];` +
    `[head][tail]overlay=0:0:eof_action=pass,format=yuv420p[v]`;
}

async function ff(args) {
  await run("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 1 << 26 });
}

const kb = async (file) => Math.round((await stat(file)).size / 1024);

await mkdir(OUT, { recursive: true });

const entries = [];

for (const tile of TILES) {
  const [cutIn, cutOut] = tile.shot;
  if (tile.start < cutIn || tile.start + tile.hold > cutOut) {
    throw new Error(`${tile.slug}: window crosses a cut in the master`);
  }

  const filter = tile.loop === "pingpong" ? pingpongFilter(tile) : crossfadeFilter(tile);
  const webm = path.join(OUT, `${tile.slug}.webm`);
  const mp4 = path.join(OUT, `${tile.slug}.mp4`);
  const poster = path.join(OUT, `${tile.slug}.webp`);

  // vp9 first: it carries the tile on every browser that matters, so it gets
  // the tighter quality target and h264 only has to be a credible fallback.
  await ff(["-i", SRC, "-filter_complex", filter, "-map", "[v]", "-an",
    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "38", "-row-mt", "1",
    "-deadline", "good", "-cpu-used", "2", webm]);

  await ff(["-i", SRC, "-filter_complex", filter, "-map", "[v]", "-an",
    "-c:v", "libx264", "-crf", "29", "-preset", "slower",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);

  await ff(["-i", SRC, "-filter_complex", filter, "-map", "[v]",
    "-frames:v", "1", "-quality", "80", poster]);

  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v",
    "-show_entries", "stream=width,height:format=duration", "-of", "csv=p=0", webm]);
  const [size, duration] = stdout.trim().split("\n");
  const [w, h] = size.split(",").map(Number);

  entries.push({ slug: tile.slug, width: w, height: h, alt: tile.alt });
  console.log(`${tile.slug.padEnd(16)} ${`${w}x${h}`.padEnd(9)} ` +
    `${tile.loop.padEnd(9)} ${(+duration).toFixed(2)}s  ` +
    `webm ${await kb(webm)}kB  mp4 ${await kb(mp4)}kB  poster ${await kb(poster)}kB`);
}

const manifest = `// GENERATED by scripts/encode-intro-video-tiles.mjs — do not edit by hand.

export interface IntroVideoTile {
  slug: string;
  /** Encoded pixel size; the field takes the card's aspect ratio from it. */
  width: number;
  height: number;
  alt: string;
}

/** Base path; append .webm / .mp4 / .webp. */
export const INTRO_VIDEO_BASE = "/video/intro";

export const introVideoTiles: IntroVideoTile[] = ${JSON.stringify(entries, null, 2)};

export const introVideoBySlug = new Map(introVideoTiles.map((t) => [t.slug, t]));
`;

await writeFile(MANIFEST, manifest);
console.log(`\nwrote ${path.relative(process.cwd(), MANIFEST)}`);
