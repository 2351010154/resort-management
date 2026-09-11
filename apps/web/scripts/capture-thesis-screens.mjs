// Captures the six chapter-4 thesis screenshots (Hình 4.3–4.8) from the running
// dev servers: web on 3000, admin on 3002. Viewport 1280×800 at device pixel
// ratio 2, so every file is 2560×1600 as §4.4 of the report states.
//
// Usage (servers already running, demo day seeded via seed-demo-day.mjs):
//   node apps/web/scripts/capture-thesis-screens.mjs --out <dir>
//     [--email <desk> --password <secret>] [--admin-email <admin> --admin-password <secret>]
//     [--check-in YYYY-MM-DD --check-out YYYY-MM-DD] [--only web,desk,admin]
//
// Frame sizes: 4.5, 4.6 are one 1280×800 viewport; 4.3 and 4.7 need 1280×900 to
// hold the whole step or chart; 4.4 is the full page at 1280 wide; 4.8 is 1600×900
// because the change table is clipped under the detail panel at 1280.
// Reads staff credentials from the flags or from DEMO_RECEPTIONIST_EMAIL /
// DEMO_RECEPTIONIST_PASSWORD; never prints them.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--"))
      acc.push([
        a.slice(2),
        all[i + 1]?.startsWith("--") ? "true" : all[i + 1],
      ]);
    return acc;
  }, []),
);
const OUT = args.out ?? "plans/reports/screenshots/thesis";
const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const ADMIN = process.env.ADMIN_URL ?? "http://localhost:3002";
const EMAIL = args.email ?? process.env.DEMO_RECEPTIONIST_EMAIL;
const PASSWORD = args.password ?? process.env.DEMO_RECEPTIONIST_PASSWORD;
// Reports and the audit log are ADMIN screens; the desk account cannot open them.
const ADMIN_EMAIL =
  args["admin-email"] ?? process.env.DEMO_ADMIN_EMAIL ?? EMAIL;
const ADMIN_PASSWORD =
  args["admin-password"] ?? process.env.DEMO_ADMIN_PASSWORD ?? PASSWORD;
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const wanted = (n) => !ONLY || ONLY.has(n);
const CHECK_IN = args["check-in"] ?? "2026-10-03";
const CHECK_OUT = args["check-out"] ?? "2026-10-05";
if (!EMAIL || !PASSWORD) throw new Error("staff credentials missing");
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
process.on("uncaughtException", async (error) => {
  console.error(String(error.message).slice(0, 200));
  try {
    await page.screenshot({ path: path.join(OUT, "_failure.png") });
  } catch {}
  process.exit(1);
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  locale: "en-GB",
  timezoneId: "Asia/Bangkok",
  reducedMotion: "reduce",
});
const page = await context.newPage();
const shot = async (name) => {
  await page.waitForTimeout(1500);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("wrote", file);
};
const longDate = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
};

// ---- Hình 4.3 / 4.4: guest booking funnel -------------------------------
if (wanted("web")) {
  // The rooms step pins itself to the viewport only when the window is taller
  // than 54rem (864px); at 800px tall the design scrolls by intent, so this one
  // frame is taken at 1280×900 to hold the whole step, then the size goes back.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${WEB}/booking`, { waitUntil: "networkidle" });
  await page
    .locator(`button[aria-label*="${longDate(CHECK_IN)}"]`)
    .first()
    .click();
  await page
    .locator(`button[aria-label*="${longDate(CHECK_OUT)}"]`)
    .first()
    .click();
  await page.locator("button[data-continue]").click();
  await page.locator('[data-room-row="SUPERIOR"]').waitFor();
  await page.locator('[data-room-row="SUPERIOR"]').click();
  await page.waitForTimeout(800);
  await shot("hinh-4-3-pheu-dat-phong-buoc-chon-loai-phong");
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.locator("button[data-stage-continue]").click();
  await page.waitForURL(/\/booking\/[^/]+\/details/, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  // Wait until the API has answered which providers the property can collect through.
  await page.getByText("VNPay", { exact: true }).waitFor();
  await page.waitForTimeout(2000);
  // The page is only ~370px taller than the window, so no scroll position puts
  // the details card at the top without slicing the card above it. This frame is
  // the whole page at 1280 wide instead of one viewport.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(OUT, "hinh-4-4-pheu-dat-phong-thong-tin-va-thanh-toan.png"),
    fullPage: true,
  });
  console.log("wrote hinh-4-4 (full page)");
}

// ---- desk login ----------------------------------------------------------
// Development-only overlays (Next.js dev indicator, TanStack Query devtools
// button) are not part of the product and are hidden for the frame only.
const hideDevOverlays = () =>
  page.addStyleTag({
    content:
      "nextjs-portal, .tsqd-open-btn-container, [class*='tsqd-'] { display: none !important; }",
  });
const login = async (email, password) => {
  await page.goto(`${ADMIN}/login`, { waitUntil: "networkidle" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard", { timeout: 20000 });
};
if (wanted("desk")) {
  await login(EMAIL, PASSWORD);

  // ---- Hình 4.5: arrivals queue -------------------------------------------
  await page.goto(`${ADMIN}/arrivals`, { waitUntil: "networkidle" });
  await page.locator("tbody tr[data-roving-value]").first().waitFor();
  await hideDevOverlays();
  await shot("hinh-4-5-hang-doi-khach-den");

  // ---- Hình 4.6: check-in, room step --------------------------------------
  // A row whose type still has ready rooms, so the room step has something to list.
  const premierRow = page
    .locator("tbody tr[data-roving-value]")
    .filter({ hasText: "PREMIER" })
    .first();
  const row = (await premierRow.count())
    ? premierRow
    : page.locator("tbody tr[data-roving-value]").first();
  await row.focus();
  await page.keyboard.press("Enter");
  const guestQuery = page.getByPlaceholder("Nguyễn Thị Hương");
  if (await guestQuery.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Names are written at check-in, so the queue row carries none yet; the
    // party is typed here the way the desk would type it.
    await guestQuery.fill("Nguyễn Thị Hương");
    await page.getByRole("option").first().waitFor({ timeout: 10000 });
    await page.getByRole("option").first().click();
  }
  const cccd = page.getByLabel("CCCD number");
  if (await cccd.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cccd.fill("079301000123");
    const nat = page.getByLabel("Nationality");
    if (await nat.isVisible().catch(() => false)) await nat.fill("VNM");
    await page.getByRole("button", { name: "Particulars taken" }).click();
  }
  const roomInput = page.getByPlaceholder("204");
  await roomInput.waitFor({ timeout: 10000 });
  await page.getByRole("option").first().waitFor({ timeout: 10000 });
  const firstOption = (
    await page.getByRole("option").first().innerText()
  ).trim();
  await roomInput.fill(firstOption.slice(0, 2));
  await page.getByRole("option").first().waitFor();
  await shot("hinh-4-6-buoc-phan-phong-nhan-phong");
  await page.keyboard.press("Escape");
}

if (wanted("admin")) {
  await context.clearCookies();
  await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  // ---- Hình 4.7: revenue report -------------------------------------------
  // Title, tiles and the whole chart do not share 800px; this frame is 1280×900.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${ADMIN}/reports/revenue`, { waitUntil: "networkidle" });
  await page.getByRole("combobox").first().selectOption({ label: "Each day" });
  await page.getByRole("button", { name: "Show the report" }).click();
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const chart = [...document.querySelectorAll("svg")].find(
      (s) => s.getBoundingClientRect().height > 100,
    );
    chart.style.scrollMarginBottom = "24px";
    chart.scrollIntoView({ block: "end" });
  });
  await hideDevOverlays();
  await shot("hinh-4-7-bao-cao-doanh-thu");
  await page.setViewportSize({
    width: Number(args["audit-width"] ?? 1600),
    height: Number(args["audit-height"] ?? 900),
  });

  // ---- Hình 4.8: audit log -------------------------------------------------
  await page.goto(`${ADMIN}/audit`, { waitUntil: "networkidle" });
  // Narrow to one staff member so the frame shows changes a person made, which
  // is what the audit log exists to answer (NFR-09).
  if (args["audit-actor"])
    await page.getByPlaceholder("A staff id").fill(args["audit-actor"]);
  await page.getByRole("button", { name: "Show changes" }).click();
  await page.locator("tbody tr").first().waitFor({ timeout: 20000 });
  await hideDevOverlays();
  await shot("hinh-4-8-nhat-ky-kiem-toan");
}

await browser.close();
