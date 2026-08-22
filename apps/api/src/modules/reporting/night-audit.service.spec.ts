// What a closed day is worth, and the three numbers a hotel is judged on falling
// out of it.
//
// `rollUp` is pure for the reason `decomposeGross` is, so every case below is
// reachable from literals: a night with two types trading, a night somebody
// corrected, and a night carrying a correction to an earlier one. Whether the
// statements above it select the right rows is a question about a real database
// and belongs to a storage test; what is asserted here is the arithmetic those
// rows are turned into, which is the part a report is read from.
//
// The last suite is the acceptance criterion stated as a test. `FR-RPT-03` wants
// occupancy, ADR and RevPAR from snapshots, and the claim `schema/night-audit.ts`
// makes is that the three countable facts it stores are sufficient for all three
// per type and property-wide. That claim is only worth anything if somebody has
// actually taken the ratios, so the suite takes them.

import type { VndAmount } from "@mariva/shared";
import { describe, expect, it } from "vitest";
import {
  type AuditedPosting,
  rollUp,
  type SellableRooms,
} from "./night-audit.service.js";

const DELUXE = "room-type-deluxe";
const SUITE = "room-type-suite";

/** Twenty of one type and four of the other were on sale that night. */
const ON_SALE: readonly SellableRooms[] = [
  { roomTypeId: DELUXE, sellableRooms: 20 },
  { roomTypeId: SUITE, sellableRooms: 4 },
];

describe("what a night's postings come to", () => {
  it("sums the net room charges and counts one room per stay charged", () => {
    const day = rollUp(
      [
        roomCharge({ posting: "one", stay: "a-stay", net: 1_200_000n }),
        roomCharge({ posting: "two", stay: "another-stay", net: 1_000_000n }),
        roomCharge({
          posting: "three",
          stay: "a-suite-stay",
          net: 3_000_000n,
          roomTypeId: SUITE,
        }),
      ],
      ON_SALE,
    );

    expect(day.roomsSold).toBe(3);
    expect(day.netRoomRevenueVnd).toBe(5_200_000n);
    expect(day.byType).toEqual([
      {
        roomTypeId: DELUXE,
        sellableRooms: 20,
        roomsSold: 2,
        netRoomRevenueVnd: 2_200_000n,
      },
      {
        roomTypeId: SUITE,
        sellableRooms: 4,
        roomsSold: 1,
        netRoomRevenueVnd: 3_000_000n,
      },
    ]);
  });

  it("leaves the VAT and the service charge out of room revenue", () => {
    // The three lines `FR-FOL-02` writes for one night. `FR-GST-04` says net
    // room revenue excludes the other two, and the whole of how that is done is
    // reading the `ROOM_CHARGE` line — a snapshot that summed the folio instead
    // would report the guest's gross price as the property's revenue and inflate
    // every ADR by the tax somebody else is owed.
    const day = rollUp(
      [
        roomCharge({ posting: "the-night", stay: "a-stay", net: 1_000_000n }),
        line({
          posting: "its-service-charge",
          stay: "a-stay",
          type: "SERVICE_CHARGE_FEE",
          amount: 50_000n,
        }),
        line({
          posting: "its-vat",
          stay: "a-stay",
          type: "VAT",
          amount: 84_000n,
        }),
      ],
      ON_SALE,
    );

    expect(day.netRoomRevenueVnd).toBe(1_000_000n);
    expect(day.otherRevenueVnd).toBe(0n);
  });

  it("counts what else the property sold, and no money merely moving", () => {
    const day = rollUp(
      [
        roomCharge({ posting: "the-night", stay: "a-stay", net: 1_000_000n }),
        line({
          posting: "a-laundry-item",
          stay: "a-stay",
          type: "SERVICE_ITEM",
          amount: 150_000n,
        }),
        // A guest settling their account is not a day's revenue. It is the same
        // money arriving, and counting it would report every night twice.
        line({
          posting: "the-settlement",
          stay: "a-stay",
          type: "PAYMENT",
          amount: -1_234_000n,
        }),
        line({
          posting: "a-refund",
          stay: "a-cancelled-stay",
          type: "REFUND",
          amount: -600_000n,
        }),
      ],
      ON_SALE,
    );

    expect(day.otherRevenueVnd).toBe(150_000n);
    expect(day.netRoomRevenueVnd).toBe(1_000_000n);
  });

  it("keeps a cancellation charge out of the takings altogether", () => {
    // §4's grid is not a sale: no night was let and nothing was served, so a
    // day of nothing but cancellations is a day the property did no business.
    // Counting the penalty would report it as a good one.
    const day = rollUp(
      [
        line({
          posting: "a-cancellation",
          stay: "a-cancelled-stay",
          type: "POLICY_CHARGE",
          amount: 400_000n,
        }),
      ],
      ON_SALE,
    );

    expect(day.otherRevenueVnd).toBe(0n);
    expect(day.netRoomRevenueVnd).toBe(0n);
    expect(day.roomsSold).toBe(0);
  });

  it("keeps the reversal of one out too, so the day is not credited for it", () => {
    // A reversal resolves to the type it undoes, and that type counts as
    // nothing here — so the correction counts as nothing either. A credit
    // recorded where the charge never was would take a day's revenue below what
    // the property actually earned.
    const day = rollUp(
      [
        line({
          posting: "a-laundry-item",
          stay: "a-stay",
          type: "SERVICE_ITEM",
          amount: 150_000n,
        }),
        reversalOf({
          posting: "waiving-the-penalty",
          undoing: "a-cancellation",
          was: "POLICY_CHARGE",
          stay: "a-cancelled-stay",
          amount: -400_000n,
        }),
      ],
      ON_SALE,
    );

    expect(day.otherRevenueVnd).toBe(150_000n);
  });

  it("gives a type that was on sale and sold nothing a row of its own", () => {
    // Without the row there is no RevPAR for that type — the figure a revenue
    // manager most wants on the morning after an empty night is the one a
    // missing row would silently drop.
    const day = rollUp([], ON_SALE);

    expect(day.byType.map((type) => type.roomTypeId)).toEqual([DELUXE, SUITE]);
    expect(day.sellableRooms).toBe(24);
    expect(day.roomsSold).toBe(0);
    expect(day.netRoomRevenueVnd).toBe(0n);
  });
});

describe("a night somebody corrected", () => {
  it("counts neither the revenue nor the room when the charge was taken back", () => {
    const day = rollUp(
      [
        roomCharge({ posting: "the-night", stay: "a-stay", net: 1_000_000n }),
        reversalOf({
          posting: "the-correction",
          undoing: "the-night",
          was: "ROOM_CHARGE",
          stay: "a-stay",
          amount: -1_000_000n,
        }),
        roomCharge({ posting: "another", stay: "another-stay", net: 900_000n }),
      ],
      ON_SALE,
    );

    // A night the property has agreed did not happen is not a room sold, and an
    // ADR over a denominator that counted it would understate itself by exactly
    // the night that was cancelled.
    expect(day.roomsSold).toBe(1);
    expect(day.netRoomRevenueVnd).toBe(900_000n);
  });

  it("leaves a reversed tax line out of revenue, as the line itself was", () => {
    const day = rollUp(
      [
        reversalOf({
          posting: "undoing-the-vat",
          undoing: "some-vat-line",
          was: "VAT",
          stay: "a-stay",
          amount: -84_000n,
        }),
      ],
      ON_SALE,
    );

    // A reversal read by its own type rather than by what it undoes would
    // subtract the state's money from the property's takings.
    expect(day.netRoomRevenueVnd).toBe(0n);
    expect(day.otherRevenueVnd).toBe(0n);
  });

  it("takes a correction to an earlier night off the day it was made on", () => {
    // `folio.service.ts` dates a reversal to the day the desk made it, so this
    // is what a snapshot of that day has to say: the credit lands here, and the
    // night it corrects keeps whatever was frozen for it. The reversed line is
    // not among today's postings, which is exactly how an earlier night looks
    // from here.
    const day = rollUp(
      [
        roomCharge({ posting: "tonight", stay: "a-stay", net: 1_000_000n }),
        reversalOf({
          posting: "a-correction",
          undoing: "a-night-last-week",
          was: "ROOM_CHARGE",
          stay: "another-stay",
          amount: -800_000n,
        }),
      ],
      ON_SALE,
    );

    expect(day.netRoomRevenueVnd).toBe(200_000n);
    // One room was slept in tonight. The correction is money and never a room.
    expect(day.roomsSold).toBe(1);
  });
});

describe("the three numbers a hotel is judged on", () => {
  it("are ratios of the figures the snapshot holds, per type and property-wide", () => {
    const day = rollUp(
      [
        roomCharge({ posting: "one", stay: "a-stay", net: 1_200_000n }),
        roomCharge({ posting: "two", stay: "another-stay", net: 1_000_000n }),
        roomCharge({ posting: "three", stay: "a-third-stay", net: 800_000n }),
        roomCharge({
          posting: "four",
          stay: "a-suite-stay",
          net: 3_000_000n,
          roomTypeId: SUITE,
        }),
      ],
      ON_SALE,
    );

    const deluxe = day.byType.find((type) => type.roomTypeId === DELUXE);

    // Three of twenty Deluxe, at an average of a million đồng, which is a
    // hundred and fifty thousand đồng of revenue per available Deluxe.
    expect(percent(deluxe?.roomsSold ?? 0, deluxe?.sellableRooms ?? 0)).toBe(15);
    expect(perRoom(deluxe?.netRoomRevenueVnd ?? 0n, deluxe?.roomsSold ?? 0)).toBe(
      1_000_000n,
    );
    expect(
      perRoom(deluxe?.netRoomRevenueVnd ?? 0n, deluxe?.sellableRooms ?? 0),
    ).toBe(150_000n);

    // And the same three questions of the whole property, from the parent row —
    // four rooms of twenty-four, six million đồng between them.
    expect(percent(day.roomsSold, day.sellableRooms)).toBeCloseTo(16.67, 2);
    expect(perRoom(day.netRoomRevenueVnd, day.roomsSold)).toBe(1_500_000n);
    expect(perRoom(day.netRoomRevenueVnd, day.sellableRooms)).toBe(250_000n);
  });

  it("adds up: the property row is the types, not a second count", () => {
    const day = rollUp(
      [
        roomCharge({ posting: "one", stay: "a-stay", net: 1_200_000n }),
        roomCharge({
          posting: "two",
          stay: "a-suite-stay",
          net: 3_000_000n,
          roomTypeId: SUITE,
        }),
      ],
      ON_SALE,
    );

    // The property-wide RevPAR of a report that summed the type rows itself has
    // to be the one the parent row gives, or the two halves of one page
    // disagree.
    expect(day.byType.reduce((sum, type) => sum + type.roomsSold, 0)).toBe(
      day.roomsSold,
    );
    expect(
      day.byType.reduce((sum, type) => sum + type.sellableRooms, 0),
    ).toBe(day.sellableRooms);
    expect(
      day.byType.reduce<VndAmount>(
        (sum, type) => sum + type.netRoomRevenueVnd,
        0n,
      ),
    ).toBe(day.netRoomRevenueVnd);
  });
});

/** Occupancy, as a percentage of what was on sale. */
function percent(sold: number, sellable: number): number {
  return sellable === 0 ? 0 : (sold * 100) / sellable;
}

/**
 * ADR when the divisor is rooms sold, RevPAR when it is rooms available.
 *
 * One function because they are one division over two denominators, which is the
 * whole reason `schema/night-audit.ts` stores the three counts rather than the
 * ratios. Integer đồng throughout — a rate in `number` is the loss `money.ts`
 * refuses.
 */
function perRoom(revenue: VndAmount, rooms: number): VndAmount {
  return rooms === 0 ? 0n : revenue / BigInt(rooms);
}

/** One night's rent, as `RoomChargeSweep` posts it. */
function roomCharge(night: {
  posting: string;
  stay: string;
  net: VndAmount;
  roomTypeId?: string;
}): AuditedPosting {
  return line({
    posting: night.posting,
    stay: night.stay,
    type: "ROOM_CHARGE",
    amount: night.net,
    roomTypeId: night.roomTypeId,
  });
}

/** The correction, carrying what the line it undoes was. */
function reversalOf(correction: {
  posting: string;
  undoing: string;
  was: AuditedPosting["type"];
  stay: string;
  amount: VndAmount;
}): AuditedPosting {
  return {
    ...line({
      posting: correction.posting,
      stay: correction.stay,
      type: "REVERSAL",
      amount: correction.amount,
    }),
    reversesPostingId: correction.undoing,
    reversedType: correction.was,
  };
}

/** Any folio line of the night, defaulting to a Deluxe stay. */
function line(posting: {
  posting: string;
  stay: string;
  type: AuditedPosting["type"];
  amount: VndAmount;
  roomTypeId?: string;
}): AuditedPosting {
  return {
    postingId: posting.posting,
    bookingId: posting.stay,
    roomTypeId: posting.roomTypeId ?? DELUXE,
    amount: posting.amount,
    type: posting.type,
    reversesPostingId: null,
    reversedType: null,
  };
}
