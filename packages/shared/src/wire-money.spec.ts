import { describe, expect, it } from "vitest";
import { z } from "zod";

import { folioSchema } from "./contract/folio.js";
import { guestProfileSchema } from "./contract/guest.js";
import { shiftSchema } from "./contract/operations.js";
import { vndAmountSchema } from "./money.js";
import { reviveWireMoney } from "./wire-money.js";

/* The wire form, stated once.
 *
 * What arrives is JSON, so every amount in it is text and nothing in the type
 * system says so — that mismatch is the whole reason this module exists. The
 * fixtures below are written as the transport actually delivers them and read
 * back through this cast, rather than being built from the schema's own output
 * type, because building them from the output type would be asserting the bug
 * away instead of reproducing it.
 */
const revive = <T>(schema: unknown, value: unknown): T =>
  reviveWireMoney(schema, value) as T;

type Folio = z.infer<typeof folioSchema>;
type Shift = z.infer<typeof shiftSchema>;
type GuestProfile = z.infer<typeof guestProfileSchema>;

const POSTING_ID = "3f1b6b0e-7d2c-4a55-9c0e-1a2b3c4d5e6f";
const REVERSAL_ID = "8a7c5d31-2e4f-4b16-8d90-0f1e2d3c4b5a";

/** One folio as the API sends it: amounts as decimal text, ids and dates not. */
function wireFolio(): unknown {
  return {
    id: "0b9d1c2e-3f40-4152-8637-9a8b7c6d5e4f",
    bookingId: "5c4b3a29-1807-4655-9e4d-3c2b1a098765",
    state: "OPEN",
    openedAt: "2026-08-23T02:15:00.000Z",
    closedAt: null,
    summary: {
      charged: "1850000",
      credited: "2000000",
      outstanding: "-150000",
    },
    postings: [
      {
        id: POSTING_ID,
        type: "ROOM_CHARGE",
        amount: "1850000",
        description: "Room charge",
        businessDate: "2026-08-22",
        reversesPostingId: null,
        parentPostingId: null,
        chargeBasis: null,
        postedAt: "2026-08-23T02:15:00.000Z",
        postedBy: "Trang",
      },
      {
        id: REVERSAL_ID,
        type: "PAYMENT",
        amount: "-2000000",
        description: "Cash",
        businessDate: "2026-08-22",
        reversesPostingId: null,
        parentPostingId: null,
        chargeBasis: null,
        postedAt: "2026-08-23T02:20:00.000Z",
        postedBy: null,
      },
    ],
  };
}

describe("an amount off the wire", () => {
  it("is read back into đồng", () => {
    expect(revive(vndAmountSchema, "1850000")).toBe(1_850_000n);
  });

  // A refund and a reversing entry are negative charges — `money.ts` says the
  // type carries a sign, and a decoder that dropped it would balance a folio
  // that is not balanced.
  it("keeps its sign", () => {
    expect(revive(vndAmountSchema, "-2000000")).toBe(-2_000_000n);
    expect(revive(vndAmountSchema, "0")).toBe(0n);
  });

  // Applying the decoder twice must cost nothing but time: the transport
  // decodes once, and a caller that decodes again — or a cached value read a
  // second time — must not see a different figure or an exception.
  it("passes through when it is already đồng", () => {
    expect(revive(vndAmountSchema, 1_850_000n)).toBe(1_850_000n);
  });

  // Null is a fact of its own on this contract: a shift that has not been
  // counted has no closing count, and 0n would say the drawer was empty.
  it("leaves an absent amount absent", () => {
    const nullable = vndAmountSchema.nullable();

    expect(revive(nullable, null)).toBeNull();
    expect(revive(vndAmountSchema.optional(), undefined)).toBeUndefined();
    expect(revive(nullable, "500000")).toBe(500_000n);
  });

  // Not every string in a `bigint` position can be turned into one, and the
  // decoder is the wrong place to find that out: rendering a wrong figure is
  // recoverable and a thrown `SyntaxError` takes the screen down with it.
  it("leaves text that is not an amount alone rather than throwing", () => {
    expect(revive(vndAmountSchema, "")).toBe("");
    expect(revive(vndAmountSchema, "1.85e6")).toBe("1.85e6");
    expect(revive(vndAmountSchema, "one million")).toBe("one million");
  });
});

describe("a folio as the transport delivers it", () => {
  it("reads the summary's three figures out of a nested object", () => {
    const folio = revive<Folio>(folioSchema, wireFolio());

    expect(folio.summary.charged).toBe(1_850_000n);
    expect(folio.summary.credited).toBe(2_000_000n);
    expect(folio.summary.outstanding).toBe(-150_000n);
  });

  // The defect this whole module exists for: the ledger runs a balance with
  // `running += posting.amount` seeded at 0n, which is a `TypeError` the moment
  // one of those amounts is a string.
  it("reads every line's amount out of an array", () => {
    const folio = revive<Folio>(folioSchema, wireFolio());
    const running = folio.postings.reduce((sum, line) => sum + line.amount, 0n);

    expect(folio.postings.map((line) => line.amount)).toEqual([
      1_850_000n,
      -2_000_000n,
    ]);
    expect(running).toBe(-150_000n);
  });

  // The regression that matters most. Ids, dates and instants are digits too,
  // and a decoder that read the value instead of the schema would turn a
  // business date into a number and a uuid into nonsense.
  it("leaves everything that is not an amount exactly as it arrived", () => {
    const folio = revive<Folio>(folioSchema, wireFolio());
    const [charge] = folio.postings;

    expect(charge.id).toBe(POSTING_ID);
    expect(charge.businessDate).toBe("2026-08-22");
    expect(charge.postedAt).toBe("2026-08-23T02:15:00.000Z");
    expect(charge.type).toBe("ROOM_CHARGE");
    expect(charge.reversesPostingId).toBeNull();
    expect(charge.postedBy).toBe("Trang");
    expect(folio.state).toBe("OPEN");
    expect(folio.closedAt).toBeNull();
  });

  it("does not touch the object it was given", () => {
    const wire = wireFolio() as { summary: { charged: unknown } };

    revive<Folio>(folioSchema, wire);

    expect(wire.summary.charged).toBe("1850000");
  });

  it("hands back the same value when there was no money in it", () => {
    const plain = { scope: "rooms", rooms: [] };

    expect(
      reviveWireMoney(
        z.object({ scope: z.string(), rooms: z.array(z.any()) }),
        plain,
      ),
    ).toBe(plain);
  });
});

describe("a shift as the transport delivers it", () => {
  const wireShift = {
    id: "6d5c4b3a-2918-4077-8e6d-5c4b3a291807",
    operatorId: "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9",
    operatorName: "Trang",
    openingFloat: "500000",
    openedAt: "2026-08-23T06:00:00.000Z",
    openingBusinessDate: "2026-08-23",
    cashTaken: "120000",
    cashBookNet: "-20000",
    closingCount: "600000",
    variance: "0",
    closedAt: "2026-08-23T14:00:00.000Z",
    handoverNote: null,
  };

  // Concatenation is what the screen does today: three strings and a `+` print
  // 500000120000 rather than 600000, and the sum is what the drawer is measured
  // against.
  it("makes the expected drawer a sum rather than a concatenation", () => {
    const shift = revive<Shift>(shiftSchema, wireShift);
    const expected = shift.openingFloat + shift.cashTaken + shift.cashBookNet;

    expect(expected).toBe(600_000n);
  });

  // `variance === 0n` against a string is never true, so a square drawer reads
  // as short until the figure is a `bigint`.
  it("lets a square drawer compare equal to zero", () => {
    const shift = revive<Shift>(shiftSchema, wireShift);

    expect(shift.variance).toBe(0n);
    expect(shift.variance === 0n).toBe(true);
  });

  it("leaves an open shift uncounted", () => {
    const open = revive<Shift>(shiftSchema, {
      ...wireShift,
      closingCount: null,
      variance: null,
      closedAt: null,
    });

    expect(open.closingCount).toBeNull();
    expect(open.variance).toBeNull();
    expect(open.openingFloat).toBe(500_000n);
  });
});

describe("a bigint that is not money", () => {
  // `guest.ts` declares `loyaltyPoints` as a bare `z.bigint()` on the argument
  // that a point is a count and not an amount. It is still serialised as text,
  // so the node kind and not a mark on `vndAmountSchema` is what the decoder
  // tests — and the guest's id, which is Better Auth's base-62 text and may be
  // all digits, has to survive beside it.
  it("is revived by its declared kind, and a digit-shaped id is not", () => {
    const profile = revive<GuestProfile>(guestProfileSchema, {
      id: "1850000",
      fullName: "Nguyễn Thị Trang",
      phone: "0901234567",
      email: "trang@example.com",
      dateOfBirth: "1994-02-11",
      nationality: "VN",
      cccdMasked: "•••••••••123",
      vipTier: "SILVER",
      loyaltyPoints: "24000",
      createdAt: "2026-01-04T09:00:00.000Z",
    });

    expect(profile.loyaltyPoints).toBe(24_000n);
    expect(profile.id).toBe("1850000");
    expect(profile.phone).toBe("0901234567");
    expect(profile.dateOfBirth).toBe("1994-02-11");
  });
});

describe("a schema the walker does not recognise", () => {
  /* A decoder that threw on an unfamiliar node would take down every screen at
   * once, over a field it did not need to touch. Every one of these returns the
   * value it was handed. */
  it("returns the value rather than throwing", () => {
    expect(reviveWireMoney(undefined, "1850000")).toBe("1850000");
    expect(reviveWireMoney(null, "1850000")).toBe("1850000");
    expect(reviveWireMoney({}, "1850000")).toBe("1850000");
    expect(reviveWireMoney({ _zod: {} }, "1850000")).toBe("1850000");
    expect(
      reviveWireMoney(
        { _zod: { def: { type: "a_kind_from_the_future" } } },
        {
          amount: "1850000",
        },
      ),
    ).toEqual({ amount: "1850000" });
  });

  it("keeps walking past an opaque member of an object it does know", () => {
    const mixed = z.object({ amount: vndAmountSchema, blob: z.unknown() });
    const decoded = revive<{ amount: bigint; blob: unknown }>(mixed, {
      amount: "1850000",
      blob: { anything: ["1850000"] },
    });

    expect(decoded.amount).toBe(1_850_000n);
    expect(decoded.blob).toEqual({ anything: ["1850000"] });
  });

  // A member the client's copy of the contract has not heard of yet must
  // survive the walk rather than be dropped from the object.
  it("carries a member the schema does not declare", () => {
    const decoded = revive<Record<string, unknown>>(
      z.object({ amount: vndAmountSchema }),
      { amount: "1850000", addedLater: "42" },
    );

    expect(decoded.amount).toBe(1_850_000n);
    expect(decoded.addedLater).toBe("42");
  });
});
