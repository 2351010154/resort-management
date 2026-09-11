// Encode the four Act 3 ("The Approach") passages into web deliverables:
//   public/video/approach/<slug>.webm         (vp9, two-pass)
//   public/video/approach/<slug>.mp4          (h264 fallback)
//   public/video/approach/<slug>-poster.webp
//
// Each passage is 2-4 consecutive shots lifted out of a montage master and
// slowed to 0.8x so the cutting rate does not fight the slow scroll-driven
// scale-up the clips play under. Masters stay untouched (read only).
//
// Budget: <=1.1MB per webm, <=1.5MB per mp4, <10MB across the eight videos,
// <80KB per poster. The clips sit behind a scrim and grade to near-black, so
// 1600w is enough and 1920 would only waste bytes.
//
// Usage: node apps/web/scripts/encode-approach-clips.mjs [slug ...]

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);

const MASTERS =
  "C:/Users/tamla/Downloads/design-materials/arrival-page/masters";
const OUT = path.resolve(
  import.meta.dirname,
  "..",
  "public",
  "video",
  "approach",
);
const PASS_LOG_DIR = path.join(tmpdir(), "approach-clips-passlog");

const SPEED = 0.8; // setpts=PTS/0.8 === setpts=1.25*PTS
const WIDTH = 1600;
const VP9_CRF = 40;
const H264_CRF = 28;
const POSTER_QUALITY = 82;

// Source windows are in master seconds and were picked off frame sweeps so that
// every in/out point lands on a hard shot boundary, never mid-dissolve.
const CLIPS = [
  {
    slug: "arrival",
    source: "aman-spirit-master.mp4",
    // pavilion over the sea -> colonial arcade -> plaster corridor -> infinity
    // pool. Warm ochre throughout. Cuts away to New York at 52.9.
    segments: [[46.34, 52.88]],
    posterAt: 4.45, // plaster corridor, in output time
  },
  {
    slug: "last-light",
    source: "aman-festive-light-master.mp4",
    // pavilion silhouette on a golden sea -> sun on open water. One cut.
    // The master carries an audio track; -an drops it.
    segments: [[84.4, 90.9]],
    posterAt: 1.4, // pavilion silhouette
  },
  {
    slug: "nocturne",
    source: "aman-nocturne-master.mp4",
    // lake at dusk with a figure on a jetty -> moon over hills -> colonnade
    // reflected in still water. Contiguous, so one segment. The urban neon
    // block in this master starts at 46.9 and is excluded by the out point.
    segments: [[36.02, 43.2]],
    posterAt: 6.2, // colonnade reflection
  },
  {
    slug: "first-light",
    source: "aman-alchemy-master.mp4",
    // forest in mist -> cliff monastery, then green forest through window
    // mullions -> stupa through leaves. Both windows are free of the burned-in
    // devanagari/English type that covers the prayer-flag, manuscript and
    // sunrise shots between and after them.
    segments: [
      [0.05, 4.38],
      [11.95, 14.75],
    ],
    posterAt: 3.9, // cliff monastery
  },
];

async function ff(args) {
  await run("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 1 << 24 });
}

async function probe(file, entries) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    entries,
    "-of",
    "default=nw=1",
    file,
  ]);
  return stdout.trim();
}

async function mb(file) {
  return ((await stat(file)).size / 1024 / 1024).toFixed(2);
}

async function kb(file) {
  return ((await stat(file)).size / 1024).toFixed(1);
}

// trim/concat on the decoded stream keeps the cuts frame-accurate; a stream can
// only be consumed once, hence the split.
function filterGraph(segments) {
  const n = segments.length;
  const labels = segments.map((_, i) => `[in${i}]`).join("");
  const parts = [`[0:v]split=${n}${labels}`];
  segments.forEach(([start, end], i) => {
    parts.push(
      `[in${i}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[s${i}]`,
    );
  });
  const concatIn = segments.map((_, i) => `[s${i}]`).join("");
  parts.push(`${concatIn}concat=n=${n}:v=1:a=0[cat]`);
  parts.push(
    `[cat]setpts=${(1 / SPEED).toFixed(6)}*PTS,scale=${WIDTH}:-2,format=yuv420p[v]`,
  );
  return parts.join(";");
}

async function encode(clip) {
  const src = path.join(MASTERS, clip.source);
  const graph = filterGraph(clip.segments);
  const webm = path.join(OUT, `${clip.slug}.webm`);
  const mp4 = path.join(OUT, `${clip.slug}.mp4`);
  const poster = path.join(OUT, `${clip.slug}-poster.webp`);
  const passLog = path.join(PASS_LOG_DIR, clip.slug);

  const vp9 = [
    "-c:v",
    "libvpx-vp9",
    "-b:v",
    "0",
    "-crf",
    String(VP9_CRF),
    "-row-mt",
    "1",
    "-deadline",
    "good",
    "-cpu-used",
    "2",
    "-passlogfile",
    passLog,
    "-an",
  ];
  const common = ["-i", src, "-filter_complex", graph, "-map", "[v]"];

  await ff([...common, ...vp9, "-pass", "1", "-f", "null", "-"]);
  await ff([...common, ...vp9, "-pass", "2", webm]);

  await ff([
    ...common,
    "-c:v",
    "libx264",
    "-crf",
    String(H264_CRF),
    "-preset",
    "slower",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    mp4,
  ]);

  // Poster comes off the finished mp4 so it matches the delivered grade/scale.
  await ff([
    "-ss",
    String(clip.posterAt),
    "-i",
    mp4,
    "-frames:v",
    "1",
    "-quality",
    String(POSTER_QUALITY),
    poster,
  ]);

  return { clip, webm, mp4, poster };
}

const wanted = process.argv.slice(2);
const selected = wanted.length
  ? CLIPS.filter((c) => wanted.includes(c.slug))
  : CLIPS;

if (!selected.length) {
  console.error(
    `No clip matched ${wanted.join(", ")}. Known: ${CLIPS.map((c) => c.slug).join(", ")}`,
  );
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
await mkdir(PASS_LOG_DIR, { recursive: true });

const results = [];
for (const clip of selected) {
  const sourceSeconds = clip.segments.reduce((t, [a, b]) => t + (b - a), 0);
  console.log(
    `\n=== ${clip.slug}  ${clip.source}  ${clip.segments.map(([a, b]) => `${a}-${b}`).join(" + ")}` +
      `  (${sourceSeconds.toFixed(2)}s src -> ${(sourceSeconds / SPEED).toFixed(2)}s out)`,
  );
  results.push(await encode(clip));
}

await rm(PASS_LOG_DIR, { recursive: true, force: true });

let totalVideo = 0;
console.log("\n--- sizes");
for (const { clip, webm, mp4, poster } of results) {
  totalVideo += (await stat(webm)).size + (await stat(mp4)).size;
  console.log(
    `${clip.slug.padEnd(12)} webm ${await mb(webm)} MB   mp4 ${await mb(mp4)} MB   poster ${await kb(poster)} KB`,
  );
}
console.log(
  `total video   ${(totalVideo / 1024 / 1024).toFixed(2)} MB (budget 10.00 MB)`,
);
console.log(`crf           vp9 ${VP9_CRF} / h264 ${H264_CRF} @ ${WIDTH}w`);

console.log("\n--- ffprobe");
for (const { clip, webm, mp4 } of results) {
  for (const file of [webm, mp4]) {
    const info = await probe(
      file,
      "format=duration:stream=codec_type,codec_name,width,height",
    );
    console.log(`${path.basename(file)}\n${info}\n`);
  }
  void clip;
}
