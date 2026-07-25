// Encode the arcade colonnade master into the Act 4 threshold deliverables:
//   public/video/threshold/arcade-{1160,760}.{webm,mp4}
//   public/video/threshold/arcade-poster.webp
//
// The master is HEVC, which no browser will decode from a <video> tag, so this
// re-encode is mandatory rather than an optimisation.
//
// Two fixed decisions live in the filter chain:
//   crop  — the right 40% of the frame carries shop signage across the whole
//           20s. 1160px clears it on every frame (swept and checked).
//   grade — the ceiling murals are primary-colour; desaturating to 0.74 and
//           warming the balance lands them in the sand/umber family so the
//           footage belongs to the same hotel as the stills.
//
// Usage: node scripts/encode-threshold-video.mjs [posterSeconds]

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);

const SRC =
  "C:/Users/tamla/Downloads/design-materials/collabcapitolium-fr/media/capitole-arcades-a3ae1c42.mp4";
const OUT = path.resolve(import.meta.dirname, "..", "public", "video", "threshold");
const POSTER_T = process.argv[2] ?? "9";

const GRADE =
  "crop=1160:1080:0:0," +
  "eq=contrast=1.05:brightness=0.015:saturation=0.74," +
  "colorbalance=rs=0.05:gs=0.012:bs=-0.06:rm=0.03:bm=-0.03," +
  "vignette=a=PI/4.6";

/**
 * Native crop width, and a mobile tier. The vp9 crf is per-tier because the
 * x264 side is not: a fixed crf 28 buys a much cheaper file at 760 than at
 * 1160, so vp9 has to give up more quality down there to stay the smaller of
 * the two. At a shared crf 44 the 760 webm came out 1% *heavier* than its mp4.
 */
const TIERS = [
  { w: 1160, crf: 44 },
  { w: 760, crf: 48 },
];

async function ff(args) {
  await run("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 8 * 1024 * 1024 });
}

async function bytes(file) {
  return (await stat(file)).size;
}

const mb = (n) => (n / 1024 / 1024).toFixed(2);

await mkdir(OUT, { recursive: true });

for (const { w, crf } of TIERS) {
  const vf = w === TIERS[0].w ? GRADE : `${GRADE},scale=${w}:-2:flags=lanczos`;
  const webm = path.join(OUT, `arcade-${w}.webm`);
  const mp4 = path.join(OUT, `arcade-${w}.mp4`);

  // vp9 constant quality, single pass. The footage is a slow steady walk, so a
  // high crf still holds up; the stone and brick are the only fine detail.
  //
  // Two things were wrong with the first encode. crf 40 put the webm at 5.22 MB
  // against the mp4's 3.16 MB, and since <source> order puts webm first, every
  // browser that could take either fetched the heavier file. And `-b:v 0 -crf`
  // run as two passes is not constant quality — libvpx spends the second pass
  // redistributing bitrate into the busy stretches, which came back *larger*
  // than one pass at the same crf (4.17 MB vs 2.67 MB). One pass is the actual
  // constant-quality mode and lands the webm comfortably under the mp4.
  await ff([
    "-i", SRC,
    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf),
    "-row-mt", "1", "-deadline", "good", "-cpu-used", "1",
    "-an", "-vf", vf, webm,
  ]);

  await ff(["-i", SRC, "-vf", vf, "-c:v", "libx264", "-crf", "28", "-preset", "slower",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);

  const webmSize = await bytes(webm);
  const mp4Size = await bytes(mp4);
  console.log(`${w}w  webm ${mb(webmSize)} MB   mp4 ${mb(mp4Size)} MB`);
  // A webm heavier than the mp4 is worse than no webm: <source> order means it
  // is the one that gets fetched. Fail rather than ship that quietly.
  if (webmSize >= mp4Size) {
    throw new Error(
      `${w}w webm (${mb(webmSize)} MB) is not smaller than the mp4 ` +
        `(${mb(mp4Size)} MB) — raise the vp9 crf or drop the webm tier.`,
    );
  }
}

const poster = path.join(OUT, "arcade-poster.webp");
await ff(["-ss", POSTER_T, "-i", SRC, "-vf", GRADE, "-frames:v", "1", "-quality", "82", poster]);
console.log(`poster ${mb(await bytes(poster))} MB (t=${POSTER_T}s)`);
