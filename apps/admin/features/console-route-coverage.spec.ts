import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* Which screen owns which act, as a test rather than as a paragraph.
 *
 * One act reachable from several screens is how a worked queue quietly becomes
 * a second stay-detail screen. So each procedure below names exactly one file
 * that may call it, and this proves both halves of that: the owner still calls
 * it, and nobody else has started to. Presence alone would let Arrivals grow an
 * `orpc.booking.cancel` next year and say nothing.
 */
const EXPECTED_CONSOLE_CALLERS = {
  "bookings/bookings-queries.ts": [
    "orpc.booking.confirm",
    "orpc.booking.cancel",
    "orpc.booking.cancelWithWaiver",
    "orpc.booking.markNoShow",
    "orpc.booking.reinstate",
    "orpc.booking.moveRoom",
    "orpc.booking.changeRoomType",
    "orpc.booking.extendStay",
    "orpc.booking.shortenStay",
    "orpc.booking.resendAccountLink",
  ],
  "folios/folios-queries.ts": [
    "orpc.service.listCatalog",
    "orpc.folio.postCharge",
    "orpc.folio.postServiceItem",
    "orpc.folio.reversePosting",
  ],
  "payments/payments-queries.ts": [
    "orpc.payment.listRefundCandidates",
    "orpc.folio.postPolicyRefund",
    "orpc.folio.postOverrideRefund",
  ],
  "rooms/rooms-queries.ts": [
    "orpc.inventory.listRoomClosures",
    "orpc.inventory.reopenRoom",
  ],
} as const;

const FEATURES = fileURLToPath(new URL(".", import.meta.url));

/** Every feature module the console ships, addressed the way the map above is. */
function featureSources(): { path: string; source: string }[] {
  const found: { path: string; source: string }[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      // Specs are excluded, this one above all: it names every procedure in the
      // map, so a scan that read it would report the map as its own violation.
      if (!/\.tsx?$/.test(entry.name) || /\.spec\.tsx?$/.test(entry.name)) {
        continue;
      }

      found.push({
        path: absolute.slice(FEATURES.length).replaceAll("\\", "/"),
        source: readFileSync(absolute, "utf8"),
      });
    }
  };

  walk(FEATURES);

  return found;
}

/** The call, and not a longer name it is the beginning of — `orpc.booking.cancel`
 *  must not answer for `orpc.booking.cancelWithWaiver`, which is a different act
 *  under a different capability. */
const IDENTIFIER_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$";

function calls(source: string, caller: string): boolean {
  for (
    let at = source.indexOf(caller);
    at !== -1;
    at = source.indexOf(caller, at + 1)
  ) {
    if (!IDENTIFIER_CHARS.includes(source.charAt(at + caller.length))) {
      return true;
    }
  }

  return false;
}

describe("console route coverage", () => {
  const sources = featureSources();

  for (const [relativePath, callers] of Object.entries(
    EXPECTED_CONSOLE_CALLERS,
  )) {
    it(`keeps the accepted callers in ${relativePath}`, () => {
      const owner = sources.find((file) => file.path === relativePath);

      expect(
        owner,
        `${relativePath} is not a console feature module`,
      ).toBeDefined();

      for (const caller of callers) {
        expect(
          calls(owner?.source ?? "", caller),
          `${caller} has no console caller`,
        ).toBe(true);
      }
    });

    it(`keeps every other screen out of ${relativePath}'s acts`, () => {
      for (const caller of callers) {
        const trespassers = sources
          .filter(
            (file) => file.path !== relativePath && calls(file.source, caller),
          )
          .map((file) => file.path);

        expect(
          trespassers,
          `${caller} belongs to ${relativePath} alone`,
        ).toEqual([]);
      }
    });
  }
});
