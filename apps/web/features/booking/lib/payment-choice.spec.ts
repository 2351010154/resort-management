// What the funnel does with the choice between VNPay and PayPal, proved at
// the one boundary this test suite can reach.
//
// `vitest.config.ts` says outright that a component here is verified in a
// real browser rather than in jsdom, so `details-screen.tsx` is not rendered
// by this file. What is proved instead is `openPayment`'s half of the
// contract those components stand on: that the guest's choice reaches the API
// as the gateway named and not as a guess, and that whatever the attempt
// froze for a foreign gateway arrives at the caller exactly as the wire sent
// it — never a figure this app converted a second time. `PaypalConfirm` in
// `details-screen.tsx` reads that field straight into `formatPresentment`
// with no arithmetic of its own, which is the design this file's third case
// is evidence for.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HeldStay } from "./stay-funnel";

const openAttempt = vi.fn();

vi.mock("@/lib/api", () => ({
  api: { payment: { openAttempt } },
}));

const { openPayment } = await import("./stay-funnel");

/** A held stay quoted at a total the tests can recognise on the wire. */
const A_STAY: HeldStay = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  reference: "MRV4K2QX",
  userId: "guest-account",
  contactEmail: "mai@example.com",
  contactName: "Mai Tran",
  state: "HELD",
  cancellationReason: null,
  roomType: "DELUXE",
  checkIn: "2026-08-20",
  checkOut: "2026-08-22",
  plan: "STANDARD",
  adults: 2,
  childAges: [],
  stayTotalGross: 1_200_000n,
  holdExpiresAt: null,
};

beforeEach(() => {
  openAttempt.mockReset();
});

describe("choosing PayPal", () => {
  it("opens the attempt as a PayPal one and not a guess from locale", async () => {
    openAttempt.mockResolvedValue({
      paymentUrl: "https://paypal.invalid/checkoutnow?token=abc",
      reference: "ref-1",
      presentment: { currency: "USD", minorUnits: 4590n, rate: "26150.5" },
    });

    await openPayment(A_STAY, "PAYPAL");

    expect(openAttempt.mock.calls[0]?.[0]).toMatchObject({
      bookingId: A_STAY.id,
      method: "PAYPAL",
    });
  });

  // The one figure a screen may show a payer. It has to be the attempt's
  // own answer, unmodified — a component that recomputed it from the đồng
  // total would be the second read `contract/payment.ts` forbids, silently
  // disagreeing with the row the property just froze the moment an `ADMIN`
  // edits the configured rate.
  it("hands back the presentment the attempt froze, exactly as the wire sent it", async () => {
    const froze = { currency: "USD", minorUnits: 4590n, rate: "26150.5" };

    openAttempt.mockResolvedValue({
      paymentUrl: "https://paypal.invalid/checkoutnow?token=abc",
      reference: "ref-1",
      presentment: froze,
    });

    const opened = await openPayment(A_STAY, "PAYPAL");

    expect(opened.presentment).toEqual(froze);
    // A bigint and not a number this call rounded on the way through — the
    // one thing `money.ts` says a presentment must never quietly become.
    expect(opened.presentment?.minorUnits).toBe(4590n);
  });
});

describe("choosing VNPay", () => {
  it("opens the attempt as a VNPay one", async () => {
    openAttempt.mockResolvedValue({
      paymentUrl: "https://sandbox.vnpayment.invalid/pay?vnp_TxnRef=abc",
      reference: "ref-2",
    });

    await openPayment(A_STAY, "VNPAY");

    expect(openAttempt.mock.calls[0]?.[0]).toMatchObject({
      bookingId: A_STAY.id,
      method: "VNPAY",
    });
  });

  // No presentment at all is what tells `details-screen.tsx` to skip the
  // interstitial and leave for the gateway the moment the attempt is open —
  // exactly as it did before PayPal existed.
  it("answers with no presentment to show, so there is nothing to confirm", async () => {
    openAttempt.mockResolvedValue({
      paymentUrl: "https://sandbox.vnpayment.invalid/pay?vnp_TxnRef=abc",
      reference: "ref-2",
    });

    const opened = await openPayment(A_STAY, "VNPAY");

    expect(opened.presentment).toBeUndefined();
  });
});

it("sends the stay's own total and description regardless of which gateway is chosen", async () => {
  openAttempt.mockResolvedValue({
    paymentUrl: "https://sandbox.vnpayment.invalid/pay?vnp_TxnRef=abc",
    reference: "ref-3",
  });

  await openPayment(A_STAY, "VNPAY");

  expect(openAttempt.mock.calls[0]?.[0]).toMatchObject({
    amount: "1200000",
    description: `Mariva stay ${A_STAY.reference}`,
  });
});
