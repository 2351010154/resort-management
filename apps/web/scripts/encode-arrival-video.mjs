// Encode the approved arrival loop master into web deliverables:
//   public/video/arrival-loop.webm  (vp9, two-pass)
//   public/video/arrival-loop.mp4   (h264)
//   public/video/arrival-loop-poster.webp
// Combined video target 3-6MB. Source stays untouched.
//
// Usage: node apps/web/scripts/encode-arrival-video.mjs [posterSeconds]

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);

const SRC = "C:/Users/tamla/Downloads/design-materials/landing-page-loop-master.mp4";
const OUT = path.resolve(import.meta.dirname, "..", "public", "video");
const POSTER_T = process.argv[2] ?? "14.2"; // archway-approach shot sits in the final segment

async function ff(args) {
  await run("ffmpeg", ["-v", "error", "-y", ...args]);
}

async function mb(file) {
  return ((await stat(file)).size / 1024 / 1024).toFixed(2);
}

await mkdir(OUT, { recursive: true });

const webm = path.join(OUT, "arrival-loop.webm");
const mp4 = path.join(OUT, "arrival-loop.mp4");
const poster = path.join(OUT, "arrival-loop-poster.webp");

// vp9 two-pass, constrained quality. crf 38 @ 1920w lands ~2-3MB for 15s of
// slow scenery; adjust crf if outside budget.
const vp9Common = ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "38", "-row-mt", "1", "-an"];
await ff(["-i", SRC, ...vp9Common, "-pass", "1", "-f", "null", "NUL"]);
await ff(["-i", SRC, ...vp9Common, "-pass", "2", webm]);

// h264 fallback: crf 27/slower keeps webm+mp4 combined near the 3-6MB budget
// (crf 23 pushed the pair to 8.6MB).
await ff(["-i", SRC, "-c:v", "libx264", "-crf", "27", "-preset", "slower",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);

await ff(["-ss", POSTER_T, "-i", SRC, "-frames:v", "1", "-quality", "82", poster]);

console.log(`webm  ${await mb(webm)} MB`);
console.log(`mp4   ${await mb(mp4)} MB`);
console.log(`poster ${await mb(poster)} MB (t=${POSTER_T}s)`);

for (const f of [webm, mp4]) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height", "-of", "default=nw=1", f]);
  console.log(`--- ${path.basename(f)}\n${stdout.trim()}`);
}
