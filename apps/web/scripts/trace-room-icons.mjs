// Trace the three room-fact icons into single-path SVGs the funnel can mask.
//
// Same technique and the same reason as `trace-brand-svgs.mjs`: a traced
// single-path SVG is painted by CSS as a **mask over `currentColor`**, so the
// glyph takes the type colour it sits beside and is correct on the first frame.
// `funnel-nav.module.css` already does this with the wordmark, and it is why
// neither file needs an image loading state.
//
// The sources are 81×81 line-art PNGs with an alpha channel. Potrace reads
// luminance, not alpha, so each one is flattened onto white first — without that
// the transparent ground reads as black and every icon traces as a filled
// square.
//
// **These three are interim, exactly as the room photographs are.** They are
// third-party line icons standing in until the property has a drawn set of its
// own. `SOURCES` below is the record of which source became which slug, and
// `room-type-list.module.css` — the only file in the tree that reads them — is
// where each slug is bound to the fact it marks.
//
// **Six, and the set stops there because the library does.** It has a sea, a
// garden and a city outlook but nothing for a courtyard or a corner, and nothing
// for any of the room's fittings. Those two aspects are therefore drawn with no
// glyph at all rather than with an approximate one: an icon that is nearly right
// is a component inventing a hotel fact, which `design-foundations.md` §6 rules
// out. `room-icons.ts` is where that returns `null`, on purpose and under test.
//
// Usage: node apps/web/scripts/trace-room-icons.mjs <source-dir>
//   where <source-dir> holds the PNGs named in SOURCES below.

import { execFile as execFileCb } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import potrace from "potrace";

const execFile = promisify(execFileCb);
const trace = promisify(potrace.trace);

const ICONS = path.resolve(
  import.meta.dirname,
  "..",
  "public",
  "images",
  "booking",
  "icons",
);

/** Source PNG → the slug `room-icons.ts` names it by, and what it marks. */
const SOURCES = [
  {
    file: "61aca8054a85a776512405.png",
    slug: "size",
    label: "Floor area",
  },
  {
    file: "61aca80585980662040774.png",
    slug: "bed",
    label: "The bed",
  },
  {
    file: "61aca804571c2179631862.png",
    slug: "extra-bed",
    label: "An extra bed",
  },
  // The three aspects the library can draw. Each is a scene inside a frame,
  // which is what makes them read as *what the room looks onto* rather than as
  // what is in it — the same distinction the aspect word makes.
  {
    file: "61aca80525dde203467987.png",
    slug: "aspect-sea",
    label: "Sea",
  },
  {
    file: "61aca8059f16d752967572.png",
    slug: "aspect-garden",
    label: "Garden",
  },
  {
    file: "61aca8043306a334771949.png",
    slug: "aspect-city",
    label: "City",
  },
];

const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error("usage: trace-room-icons.mjs <source-dir>");
  process.exit(1);
}

const work = path.join(tmpdir(), "mariva-room-icons");
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
await mkdir(ICONS, { recursive: true });

for (const { file, slug, label } of SOURCES) {
  // Flatten onto white and scale up before tracing. Potrace follows the pixel
  // grid, so tracing an 81px source directly leaves visible stair-stepping on a
  // 1.25rem glyph; 4× first and the curve optimiser has something to fit.
  const flat = path.join(work, `${slug}.png`);
  await execFile("magick", [
    path.join(sourceDir, file),
    "-background",
    "white",
    "-alpha",
    "remove",
    "-alpha",
    "off",
    "-resize",
    "400%",
    flat,
  ]);

  const raw = await trace(flat, {
    threshold: 200,
    turdSize: 4,
    optTolerance: 0.2,
    alphaMax: 1,
  });

  const viewBox = raw.match(/viewBox="([^"]+)"/)[1];
  const paths = [...raw.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="currentColor" aria-label="${label}" role="img">
  <path fill-rule="evenodd" d="${paths.join(" ")}"/>
</svg>
`;

  await writeFile(path.join(ICONS, `${slug}.svg`), svg);
  console.log(
    `${slug}.svg: viewBox ${viewBox}, ${paths.length} subpath group(s), ${svg.length} bytes`,
  );
}

await rm(work, { recursive: true, force: true });
