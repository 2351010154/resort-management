import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

describe("console route coverage", () => {
  for (const [relativePath, callers] of Object.entries(
    EXPECTED_CONSOLE_CALLERS,
  )) {
    it(`keeps the accepted callers in ${relativePath}`, () => {
      const source = readFileSync(
        new URL(relativePath, import.meta.url),
        "utf8",
      );

      for (const caller of callers) {
        expect(source, `${caller} has no console caller`).toContain(caller);
      }
    });
  }
});
