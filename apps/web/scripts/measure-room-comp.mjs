// The comp's plate geometry, measured rather than eyeballed.
//
// `plans/reports/validation-260731-2117-booking-room-comp.md` §1 pins a reference comp (S1)
// and states the boxes of its three ivory plates as fractions of the frame. This
// is where those fractions come from, so an executor can re-derive them instead
// of trusting a table.
//
// Chromium decodes the PNG and canvas reads the pixels back. Every edge is the
// **median** first/last ivory pixel across a band of scanlines, so type, a
// thumbnail or a button inside a plate cannot move an edge — one row hitting a
// letterform is outvoted. Where two plates abut and there is no brightness step
// to find, the walk starts from a point known to be inside the plate and runs
// outward until the ivory stops.
//
// Usage: node apps/web/scripts/measure-room-comp.mjs [pngPath]

import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const PNG =
  process.argv[2] ??
  "C:/Users/tamla/Downloads/reference-image-260731.png";

const FILE = `data:image/png;base64,${readFileSync(PNG).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage();

const out = await page.evaluate(async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);

  /** The plates are a warm near-white; the photograph behind them never is. */
  const ivory = (x, y) => {
    const i = (y * width + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return r > 222 && g > 213 && b > 198 && r - b < 40 && r >= b;
  };
  /** Three in a row, so a bright speck in the photograph is not an edge. */
  const solid = (x, y, dx) =>
    ivory(x, y) && ivory(x + dx, y) && ivory(x + 2 * dx, y);
  const solidV = (x, y, dy) =>
    ivory(x, y) && ivory(x, y + dy) && ivory(x, y + 2 * dy);

  const median = (xs) => {
    const s = xs.filter((v) => v !== null).sort((a, b) => a - b);
    return s.length === 0 ? null : s[Math.floor(s.length / 2)];
  };

  const P = (f) => Math.round(f);
  const firstX = (y, x0, x1) => {
    for (let x = P(x0); x <= P(x1) - 2; x += 1) if (solid(x, y, 1)) return x;
    return null;
  };
  const lastX = (y, x0, x1) => {
    for (let x = P(x1); x >= P(x0) + 2; x -= 1) if (solid(x, y, -1)) return x;
    return null;
  };
  const firstY = (x, y0, y1) => {
    for (let y = P(y0); y <= P(y1) - 2; y += 1) if (solidV(x, y, 1)) return y;
    return null;
  };
  const lastY = (x, y0, y1) => {
    for (let y = P(y1); y >= P(y0) + 2; y -= 1) if (solidV(x, y, -1)) return y;
    return null;
  };

  /** Outward from inside the plate — for edges that abut another plate. */
  const walkX = (y, from, dir, limit) => {
    let x = P(from);
    while (x > 2 && x < width - 3 && Math.abs(x - P(from)) < limit) {
      if (!solid(x, y, dir)) return x - dir;
      x += dir;
    }
    return null;
  };
  const walkY = (x, from, dir, limit) => {
    let y = P(from);
    while (y > 2 && y < height - 3 && Math.abs(y - P(from)) < limit) {
      if (!solidV(x, y, dir)) return y - dir;
      y += dir;
    }
    return null;
  };

  const band = (a, b, step = 3) => {
    const xs = [];
    for (let v = P(a); v <= P(b); v += step) xs.push(v);
    return xs;
  };

  const W = width;
  const H = height;

  return {
    width,
    height,
    plates: {
      // The list plate, alone on the left of the frame.
      list: {
        left: median(
          band(0.16 * H, 0.88 * H).map((y) => firstX(y, 0, 0.2 * W)),
        ),
        right: median(
          band(0.16 * H, 0.88 * H).map((y) => lastX(y, 0.2 * W, 0.34 * W)),
        ),
        top: median(
          band(0.07 * W, 0.28 * W).map((x) => firstY(x, 0.02 * H, 0.3 * H)),
        ),
        bottom: median(
          band(0.07 * W, 0.28 * W).map((x) => lastY(x, 0.7 * H, 0.99 * H)),
        ),
      },
      // The wide room plate. Its left edge is walked from inside, because
      // scanning inward from x=0 finds the list plate first.
      stage: {
        left: median(
          band(0.545 * H, 0.565 * H, 1).map((y) =>
            walkX(y, 0.5 * W, -1, 0.25 * W),
          ),
        ),
        right: median(
          band(0.58 * H, 0.78 * H).map((y) => lastX(y, 0.8 * W, 0.95 * W)),
        ),
        top: median(
          band(0.36 * W, 0.55 * W).map((x) => firstY(x, 0.45 * H, 0.62 * H)),
        ),
        bottom: median(
          band(0.36 * W, 0.55 * W).map((x) => lastY(x, 0.7 * H, 0.92 * H)),
        ),
      },
      // The price plate under the room plate's right end. Its top is walked up
      // from inside through the one column clear of both the figure and the
      // button, neither of which is ivory.
      price: {
        left: median(
          band(0.87 * H, 0.92 * H).map((y) => firstX(y, 0.5 * W, 0.68 * W)),
        ),
        right: median(
          band(0.87 * H, 0.92 * H).map((y) => lastX(y, 0.8 * W, 0.95 * W)),
        ),
        top: median(
          band(1180, 1210, 2).map((x) => walkY(x, 0.915 * H, -1, 0.3 * H)),
        ),
        bottom: median(
          band(0.65 * W, 0.85 * W).map((x) => lastY(x, 0.88 * H, 0.99 * H)),
        ),
      },
    },
  };
}, FILE);

const { width: W, height: H } = out;
const pc = (v, t) => `${((v / t) * 100).toFixed(1)}%`;

console.log(`comp ${W}×${H}  ratio ${(W / H).toFixed(3)}`);
for (const [name, p] of Object.entries(out.plates)) {
  if (Object.values(p).some((v) => v === null)) {
    console.log(`${name}: incomplete ${JSON.stringify(p)}`);
    continue;
  }
  console.log(
    `${name.padEnd(6)} x ${p.left}→${p.right}  y ${p.top}→${p.bottom}  ` +
      `w ${pc(p.right - p.left + 1, W)}  h ${pc(p.bottom - p.top + 1, H)}  | ` +
      `left ${pc(p.left, W)}  right-edge ${pc(p.right + 1, W)}  ` +
      `top ${pc(p.top, H)}  bottom-edge ${pc(p.bottom + 1, H)}`,
  );
}

await browser.close();
