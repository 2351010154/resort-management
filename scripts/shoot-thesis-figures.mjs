// Re-shoots the six live UI figures used in thesis chapter 4.
//
// The console token lives only for the tab that signs in, so this run uses one
// admin page from login through the final capture. Its credentials must arrive
// through the environment; putting a fallback here would turn a development
// account into a credential in the repository.
//
// Usage (Git Bash):
//   set -a
//   source apps/admin/.env.local
//   set +a
//   node scripts/shoot-thesis-figures.mjs
//
// Options:
//   --output-dir <path>       THESIS_FIGURES_DIR
//   --web-base-url <url>      WEB_BASE_URL
//   --admin-base-url <url>    ADMIN_E2E_BASE_URL

import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const requireFromWeb = createRequire(
  path.join(ROOT, "apps", "web", "package.json"),
);
const { chromium } = requireFromWeb("playwright");

const DEFAULT_OUTPUT = path.resolve(
  ROOT,
  "..",
  "design-materials",
  "report (thesis)",
  "figures",
);

const DEFAULTS = {
  outputDir: process.env.THESIS_FIGURES_DIR ?? DEFAULT_OUTPUT,
  webBaseUrl: process.env.WEB_BASE_URL ?? "http://localhost:3000",
  adminBaseUrl: process.env.ADMIN_E2E_BASE_URL ?? "http://localhost:3002",
};

const STAFF_EMAIL = process.env.ADMIN_E2E_EMAIL ?? "";
const STAFF_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";

const MISSING_CREDENTIALS = [
  "No staff account was given to the thesis figure run.",
  "Load ADMIN_E2E_EMAIL and ADMIN_E2E_PASSWORD from the gitignored",
  "apps/admin/.env.local file before running this script.",
  "The script does not guess or hardcode a password because that would put a",
  "credential in the repository.",
].join(" ");

const SHOTS = {
  bookingRooms: "hinh-4-2-pheu-dat-phong-buoc-chon-loai-phong.png",
  bookingDetails: "hinh-4-3-pheu-dat-phong-thong-tin-va-thanh-toan.png",
  arrivals: "hinh-4-4-hang-doi-khach-den.png",
  roomAssignment: "hinh-4-5-buoc-phan-phong-nhan-phong.png",
  revenue: "hinh-4-6-bao-cao-doanh-thu.png",
  audit: "hinh-4-7-nhat-ky-kiem-toan.png",
};

function usage() {
  return [
    "Usage: node scripts/shoot-thesis-figures.mjs [options]",
    "",
    "Options:",
    "  --output-dir <path>       PNG destination",
    "  --web-base-url <url>      guest app origin (default http://localhost:3000)",
    "  --admin-base-url <url>    console origin (default http://localhost:3002)",
    "  --help                    show this message",
  ].join("\n");
}

function readOptions(argv) {
  const options = { ...DEFAULTS };
  const names = {
    "--output-dir": "outputDir",
    "--web-base-url": "webBaseUrl",
    "--admin-base-url": "adminBaseUrl",
  };

  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];

    if (arg === "--help") {
      console.log(usage());
      process.exit(0);
    }

    const key = names[arg];
    if (key === undefined) {
      throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }

    const value = argv[at + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${arg} needs a value.\n\n${usage()}`);
    }

    options[key] = value;
    at += 1;
  }

  return {
    outputDir: path.resolve(options.outputDir),
    webBaseUrl: cleanOrigin(options.webBaseUrl, "web"),
    adminBaseUrl: cleanOrigin(options.adminBaseUrl, "admin"),
  };
}

function cleanOrigin(value, name) {
  let parsed;

  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`The ${name} base URL is not a valid URL: ${value}`, {
      cause: error,
    });
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`The ${name} base URL must use http or https.`);
  }

  return parsed.href.replace(/\/$/, "");
}

function at(origin, route) {
  return new URL(route, `${origin}/`).href;
}

/** The funnel prices against the property's clock, so the candidate date is
 *  derived in Asia/Bangkok rather than from the machine's local midnight. */
function propertyDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (kind) => parts.find((one) => one.type === kind)?.value;

  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Stay dates are calendar values, so UTC is used only as arithmetic over the
 *  three written parts. No local offset is allowed to move either boundary. */
function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

async function main() {
  if (STAFF_EMAIL === "" || STAFF_PASSWORD === "") {
    throw new Error(MISSING_CREDENTIALS);
  }

  const options = readOptions(process.argv.slice(2));
  await mkdir(options.outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const completed = [];

  try {
    const contextOptions = {
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      locale: "en-GB",
      timezoneId: "Asia/Bangkok",
    };
    const webContext = await browser.newContext(contextOptions);
    const adminContext = await browser.newContext(contextOptions);
    const web = await webContext.newPage();
    const admin = await adminContext.newPage();

    const webErrors = watchPageErrors(web, "guest app");
    const adminErrors = watchPageErrors(admin, "console");

    const roomSearchUrl = await openAvailableRoomSearch(
      web,
      options.webBaseUrl,
    );
    await waitForSettledUi(web);
    await capture(
      web,
      options.outputDir,
      SHOTS.bookingRooms,
      completed,
      webErrors,
    );

    await web.locator("[data-stage-continue]").click();
    await web.waitForURL(/\/booking\/[^/]+\/details(?:\?.*)?$/, {
      timeout: 20_000,
    });
    const detailHeading = web.getByRole("heading", {
      name: "Your details & payment",
    });
    await detailHeading.waitFor({ state: "visible", timeout: 20_000 });
    await detailHeading.evaluate((heading) => {
      window.scrollTo({
        top: heading.getBoundingClientRect().top + window.scrollY - 96,
      });
    });
    await waitForSettledUi(web);
    await capture(
      web,
      options.outputDir,
      SHOTS.bookingDetails,
      completed,
      webErrors,
    );

    // A separate context keeps the public hold cookie out of the staff console,
    // while the one console tab preserves the closure-held access token.
    await signIn(admin, options.adminBaseUrl);
    await goByPalette(admin, "Arrivals", "/arrivals");
    const arrivals = admin.locator("tr[data-roving-item]");
    await arrivals.first().waitFor({ state: "visible", timeout: 20_000 });
    await waitForSettledUi(admin);
    await capture(
      admin,
      options.outputDir,
      SHOTS.arrivals,
      completed,
      adminErrors,
    );

    await openRoomAssignment(admin, arrivals);
    await waitForSettledUi(admin);
    await capture(
      admin,
      options.outputDir,
      SHOTS.roomAssignment,
      completed,
      adminErrors,
    );

    // Escape discards only the unfinished local sequence. No room has been
    // selected, so this route has made no assignment or check-in write.
    await admin.keyboard.press("Escape");
    await goByPalette(admin, "Reports", "/reports");
    await admin.getByRole("link", { name: /^Revenue/ }).click();
    await admin.waitForURL(/\/reports\/revenue$/);
    await admin.getByLabel("Grouped by").selectOption("DAY");
    await admin.getByRole("button", { name: "Show the report" }).click();
    await waitForReport(admin);
    await waitForSettledUi(admin);
    await capture(
      admin,
      options.outputDir,
      SHOTS.revenue,
      completed,
      adminErrors,
    );

    await goByPalette(admin, "Audit", "/audit");
    const changes = admin.getByRole("button", { name: "Read the change" });
    await changes.first().waitFor({ state: "visible", timeout: 20_000 });
    await openPropertyChange(changes);
    await admin.getByText(/columns? moved, of/).waitFor({
      state: "visible",
      timeout: 20_000,
    });
    // Opening a change narrows the table, and the browser keeps the pressed
    // button in view by scrolling the log sideways. Reading starts at the first
    // column, so the sideways offset is undone before the figure is taken.
    await admin.evaluate(() => {
      for (const node of document.querySelectorAll("*")) {
        if (node.scrollLeft > 0) {
          node.scrollLeft = 0;
        }
      }
    });
    await waitForSettledUi(admin);
    await capture(
      admin,
      options.outputDir,
      SHOTS.audit,
      completed,
      adminErrors,
    );

    console.log(`Room search chosen: ${roomSearchUrl}`);
    console.log(`Wrote ${completed.length} figures to ${options.outputDir}`);
  } finally {
    await browser.close();
  }
}

/** A two-night window normally succeeds immediately, but the small set of
 *  offsets makes a re-shoot survive a sold-out first week without embedding a
 *  date that ages out of the booking horizon. */
async function openAvailableRoomSearch(page, origin) {
  const today = propertyDate();
  const offsets = [1, 3, 7, 14, 30, 45, 60, 90, 120, 180];

  for (const offset of offsets) {
    const from = addDays(today, offset);
    const to = addDays(from, 2);
    const query = new URLSearchParams({ from, to, step: "rooms" });
    const url = at(origin, `/booking?${query}`);

    await page.goto(url, { waitUntil: "domcontentloaded" });

    try {
      await page.locator("[data-room-row]").first().waitFor({
        state: "visible",
        timeout: 12_000,
      });
      await page.locator("[data-room-stage]").waitFor({
        state: "visible",
        timeout: 10_000,
      });
      return url;
    } catch {
      // The next offset is a different availability question. The only state
      // retained is the query string, which is the route contract under test.
    }
  }

  throw new Error(
    "No priced room type was visible in any candidate two-night window.",
  );
}

async function signIn(page, origin) {
  await page.goto(at(origin, "/login"), { waitUntil: "domcontentloaded" });
  const email = page.locator("#email");

  await email.waitFor({ state: "visible", timeout: 20_000 });
  await email.fill(STAFF_EMAIL);
  await page.locator("#password").fill(STAFF_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  try {
    await page
      .getByRole("navigation", { name: "Console sections" })
      .waitFor({ state: "visible", timeout: 20_000 });
  } catch (error) {
    const refusal = page.getByRole("alert");
    const detail =
      (await refusal.count()) === 0
        ? "The login screen reported nothing."
        : `The login screen said: ${await refusal.first().innerText()}`;

    throw new Error(`Sign-in did not reach the console. ${detail}`, {
      cause: error,
    });
  }
}

async function goByPalette(page, label, route) {
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByPlaceholder("Type a command…");

  await search.waitFor({ state: "visible", timeout: 10_000 });
  await search.fill(label);
  const option = page.getByRole("option", { name: label, exact: true });

  await option.waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.press("Enter");
  await page.waitForURL(new RegExp(`${route}$`), { timeout: 20_000 });
}

/** Reaching Room is deliberately stopped before choosing a number. Guest and
 *  document answers for a new local record make no request; room selection is
 *  the first write in this path. */
async function openRoomAssignment(page, arrivals) {
  const count = Math.min(await arrivals.count(), 20);

  for (let index = 0; index < count; index += 1) {
    const row = arrivals.nth(index);
    await row.focus();
    await page.keyboard.press("Enter");

    const guest = page.getByRole("combobox", { name: "Name on the document" });
    await guest.waitFor({ state: "visible", timeout: 10_000 });
    await guest.fill(`Thesis Figure ${Date.now()} ${index}`);
    const register = page.getByRole("option", { name: /^Register/ });
    await register.waitFor({ state: "visible", timeout: 10_000 });
    await page.keyboard.press("Enter");

    await page.getByRole("button", { name: "Particulars taken" }).waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.keyboard.press("Enter");

    const room = page.getByRole("combobox", { name: "Room number" });
    await room.waitFor({ state: "visible", timeout: 10_000 });
    const choices = page.getByRole("listbox", { name: "Room number" });

    if ((await choices.count()) > 0 && (await choices.isVisible())) {
      return;
    }

    await page.keyboard.press("Escape");
  }

  throw new Error(
    "The arrivals queue had no row with a ready room to show on assignment.",
  );
}

/** The newest logged change is this run's own sign-in, whose record carries the
 *  staff account address. A property change is opened instead, so the figure
 *  shows the audited domain and no account identity. */
async function openPropertyChange(changes) {
  const count = Math.min(await changes.count(), 20);

  for (let index = 0; index < count; index += 1) {
    const change = changes.nth(index);
    const record = await change.evaluate(
      (node) => node.closest("tr")?.innerText ?? "",
    );

    if (record.includes("staff_user")) {
      continue;
    }

    await change.click();
    return;
  }

  throw new Error("The audit log listed no change outside the staff account.");
}

async function waitForReport(page) {
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(
      (one) => one.textContent?.trim() === "Show the report",
    );
    return button instanceof HTMLButtonElement && !button.disabled;
  });

  if ((await page.getByText("No closed days in range").count()) > 0) {
    throw new Error("The revenue report returned no closed snapshot days.");
  }

  const chart = page.locator("section svg").first();
  await chart.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("section svg rect")].some((rect) => {
      const box = rect.getBoundingClientRect();
      return box.width > 2 && box.height > 2;
    }),
  );
}

function watchPageErrors(page, label) {
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(`${label}: ${error.message}`);
  });
  return errors;
}

/** Images and fonts are the visual evidence in these figures, so a network-idle
 *  page is not settled until both have decoded. The injected rule only removes
 *  Next's development badge; application content remains untouched. */
async function waitForSettledUi(page) {
  await page.addStyleTag({
    content:
      "nextjs-portal, .tsqd-parent-container { display: none !important; }",
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            }),
      ),
    );
  });
  await page.waitForTimeout(350);
}

async function capture(page, outputDir, filename, completed, pageErrors) {
  if (pageErrors.length > 0) {
    throw new Error(
      `The page raised an unhandled error before ${filename}: ${pageErrors.join(" | ")}`,
    );
  }

  const viewport = page.viewportSize();
  if (viewport?.width !== 1280 || viewport.height !== 800) {
    throw new Error(
      `${filename} would be captured at ${viewport?.width}x${viewport?.height}, not 1280x800.`,
    );
  }

  const target = path.join(outputDir, filename);
  await page.screenshot({ path: target, fullPage: false, type: "png" });
  completed.push({ filename, url: page.url() });
  console.log(`${filename} <- ${page.url()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
