import { defineConfig, devices } from "@playwright/test";

/* The two console requirements a browser is the only witness to.
 *
 * `NFR-11` is "0 mouse events end to end" and `NFR-04` is "< 150 ms, no
 * entrance animation on operational screens" — `docs/product-requirements.md`
 * §NFR. Neither is provable in jsdom: one is about what a real input device
 * emits and the other is about when a frame is painted, and jsdom has neither
 * an input pipeline nor a compositor. So these run in Chromium, against the
 * console the operator actually uses, and the vitest suite beside them keeps
 * covering the pure logic underneath.
 *
 * **No `webServer` block.** The console, the API and Postgres are long-lived
 * processes in this repo's development setup, and a Playwright-owned server
 * would be a second `next dev` fighting the first for port 3002. The run is
 * pointed at whatever is already serving `ADMIN_E2E_BASE_URL`.
 */

const BASE_URL = process.env.ADMIN_E2E_BASE_URL ?? "http://localhost:3002";

export default defineConfig({
  testDir: "./e2e",

  // One worker, always. Two of these measure each other's scheduling as much as
  // they measure the console — a millisecond budget verified on a contended
  // machine is a budget verified against noise — and both specs write through
  // the same arrivals queue.
  workers: 1,
  fullyParallel: false,

  // No retries anywhere. A retry turns "the console took 190 ms once" into a
  // green run, which is the one thing a timing requirement must never do.
  retries: 0,

  forbidOnly: process.env.CI !== undefined,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["github"]],

  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    // Deliberately not `reducedMotion: "reduce"`. `globals.css` carries a
    // reduced-motion kill switch that flattens every duration to 0.01 ms, so a
    // run asking for it would report "no entrance animation" about a preference
    // rather than about the console.
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Fixed after the device profile, so a measurement means the same thing
        // on a laptop and on CI: same viewport, same locale, same clock.
        viewport: { width: 1440, height: 900 },
        locale: "en-GB",
        timezoneId: "Asia/Bangkok",
      },
    },
  ],
});
