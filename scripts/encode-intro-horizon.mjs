// Encode the sea master into Act 1's horizon backdrop:
//   public/video/horizon/sea-{1760,900}.{webm,mp4}
//   public/video/horizon/sea-poster.webp
//
// The master does not loop: over its ten seconds the cloud bank drifts far
// enough that cutting head to tail jumps (7.3% RMSE between first and last
// frame). Nothing in the shot moves fast, though, so the fix is a crossfade
// rather than a re-shoot — the tail is dissolved over the head and the overlap
// is dropped from the end, which costs FADE seconds of runtime and makes the
// seam invisible. See the filter graph below for why the weights run the way
// they do.
//
// Usage: node scripts/encode-intro-horizon.mjs [posterSeconds]

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);

const SRC = "C:/Users/tamla/Downloads/design-materials/intro.mp4";
const OUT = path.resolve(import.meta.dirname, "..", "public", "video", "horizon");
const POSTER_T = process.argv[2] ?? "2";

/** Master length, seconds. */
const SOURCE = 10.0417;
/** Crossfade length. Long enough to hide the cloud drift, short enough that the
 *  loop keeps most of its runtime. */
const FADE = 1.25;
const LOOP = SOURCE - FADE;

/**
 * Crop, then grade.
 *
 * The crop is what makes the shot placeable. Act 1 wants the waterline about
 * 62% of the way down the viewport, and a backdrop can only be slid that far
 * without exposing an edge if its own waterline already sits near 62% of its
 * height — the master's sits at 44%, so cover-fitting it lands the horizon
 * halfway up the frame on every desktop screen and no amount of offset
 * recovers it. Taking 810 rows from the top puts the master's horizon at 0.62
 * of what is left (see SOURCE_HORIZON), which is exactly the ratio that makes
 * cover fit and correct placement the same thing. It also drops the near-black
 * water at the bottom of the frame, which the act does not want under a mark
 * that is supposed to be standing in daylight.
 *
 * The grade is light. Straight off the master the sea reads as poster blue; a
 * small desaturation settles it next to the warm stills without giving up the
 * blue the act now opens on.
 */
const GRADE = "crop=1760:810:0:0,eq=contrast=1.02:saturation=0.9";

/**
 * Crossfade the tail over the head and drop the overlap.
 *
 * At T=0 the output must continue from where the loop's last frame left off —
 * source SOURCE-FADE — which is the tail's first frame, so the tail carries all
 * the weight there. At T=FADE the output hands over to `rest`, which starts at
 * source FADE, so the head carries all the weight by then. Hence head rising,
 * tail falling.
 */
const LOOPIFY =
  `[0:v]split[a][b];` +
  `[a]trim=start=0:end=${LOOP},setpts=PTS-STARTPTS[main];` +
  `[b]trim=start=${LOOP}:end=${SOURCE},setpts=PTS-STARTPTS[tail];` +
  `[main]split[m1][m2];` +
  `[m1]trim=start=0:end=${FADE},setpts=PTS-STARTPTS[head];` +
  `[m2]trim=start=${FADE},setpts=PTS-STARTPTS[rest];` +
  `[head][tail]blend=all_expr='A*(T/${FADE})+B*(1-T/${FADE})'[mix];` +
  `[mix][rest]concat=n=2:v=1:a=0[looped];` +
  `[looped]${GRADE}`;

/**
 * Desktop tier at the crop's native width and a mobile tier. Native rather than
 * a round number because the placement scales this up on most viewports — the
 * crop is 2.17:1 and a 16:10 screen has to magnify it to fill — so every pixel
 * given up here is given up twice.
 */
const TIERS = [
  { w: 1760, crf: 40 },
  { w: 900, crf: 44 },
];

async function ff(args) {
  await run("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 8 * 1024 * 1024 });
}

const mb = async (file) => ((await stat(file)).size / 1024 / 1024).toFixed(2);

await mkdir(OUT, { recursive: true });

for (const { w, crf } of TIERS) {
  const chain = w === TIERS[0].w
    ? `${LOOPIFY}[out]`
    : `${LOOPIFY},scale=${w}:-2:flags=lanczos[out]`;
  const webm = path.join(OUT, `sea-${w}.webm`);
  const mp4 = path.join(OUT, `sea-${w}.mp4`);

  // One pass, constant quality — the same reasoning as the threshold encode:
  // two-pass with `-b:v 0 -crf` is not constant quality and comes back larger.
  await ff([
    "-i", SRC, "-filter_complex", chain, "-map", "[out]",
    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf),
    "-row-mt", "1", "-deadline", "good", "-cpu-used", "1", "-an", webm,
  ]);
  await ff([
    "-i", SRC, "-filter_complex", chain, "-map", "[out]",
    "-c:v", "libx264", "-crf", "26", "-preset", "slower",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4,
  ]);

  const [webmSize, mp4Size] = await Promise.all([stat(webm), stat(mp4)]);
  console.log(`${w}w  webm ${await mb(webm)} MB   mp4 ${await mb(mp4)} MB`);
  // <source> order puts webm first, so a webm heavier than the mp4 is the file
  // every capable browser would fetch. Fail rather than ship that quietly.
  if (webmSize.size >= mp4Size.size) {
    throw new Error(`${w}w webm is not smaller than the mp4 — raise the vp9 crf`);
  }
}

// Poster: the still the reduced-motion and no-WebGL paths draw instead of the
// loop, so it has to be graded identically or those paths open on a different
// colour to the one the act is built around.
const poster = path.join(OUT, "sea-poster.webp");
await ff(["-ss", POSTER_T, "-i", SRC, "-vf", GRADE,
  "-frames:v", "1", "-quality", "84", poster]);
console.log(`poster ${await mb(poster)} MB (t=${POSTER_T}s)`);
