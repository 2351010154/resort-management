// What the funnel does with the choice between VNPay and PayPal, and which of
// the two it may offer at all, proved at the one boundary this test suite can
// reach.
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
//
// The last suite is the other half of that boundary: which providers the
// screen may draw as choosable is the API's answer and never a list written
// into a component. A tile hard-coded as accepted on a deployment that holds
// no credentials for it is a guest who typed their name, chose it, pressed the
// button and read the registry's internal refusal — so what the tiles are
// derived from is asserted here, where it can be.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HeldStay } from "./stay-funnel";

const openAttempt = vi.fn();
const gateways = vi.fn();

vi.mock("@/lib/api", () => ({
  api: { payment: { openAttempt, gateways } },
}));

const { collectableGateways, gatewayOffer, openPayment } = await import(
  "./stay-funnel"
);

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
  gateways.mockReset();
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

describe("which providers the funnel may offer", () => {
  it("reports exactly the gateways this deployment answers with", async () => {
    // The property collects through a provider from the deploy that gives it
    // that provider's credentials and not before — so the tiles are drawn from
    // this and never from a list a component keeps of its own.
    gateways.mockResolvedValue({ methods: ["VNPAY"] });

    expect(await collectableGateways()).toEqual(["VNPAY"]);
  });

  it("offers nothing when the deployment has finished no onboarding at all", async () => {
    // An empty answer is an answer, and the screen draws every tile refused
    // rather than dropping the payment step.
    gateways.mockResolvedValue({ methods: [] });

    expect(await collectableGateways()).toEqual([]);
  });

  it("asks about the deployment and not about the stay", async () => {
    // Nothing narrows this: what it reports is which adapters the API has
    // bound, which is the same for every guest and every booking.
    gateways.mockResolvedValue({ methods: ["VNPAY", "PAYPAL"] });

    await collectableGateways();

    expect(gateways).toHaveBeenCalledWith();
  });
});

describe("what a provider tile may say about itself", () => {
  it("says nothing about a provider the listing has not answered about yet", () => {
    // The state that used to be folded into a refusal. Every guest booking
    // through VNPay — the gateway this property has always had — read "not
    // available at this property" under it for as long as one request took,
    // because the screen could not tell "we have not asked" from "we cannot".
    expect(gatewayOffer("VNPAY", undefined)).toBe("unasked");
  });

  it("refuses a provider this deployment holds no credentials for", () => {
    expect(gatewayOffer("PAYPAL", ["VNPAY"])).toBe("refused");
  });

  it("offers a provider the API listed", () => {
    expect(gatewayOffer("PAYPAL", ["VNPAY", "PAYPAL"])).toBe("offered");
  });

  it("refuses a tile no gateway could ever answer for, without waiting to be told", () => {
    // MoMo: a slot in the comp with no member of the contract's own list
    // behind it. It is refused whether or not the listing has come back,
    // because no answer could ever change it.
    expect(gatewayOffer(undefined, undefined)).toBe("refused");
    expect(gatewayOffer(undefined, ["VNPAY", "PAYPAL"])).toBe("refused");
  });

  it("refuses everything when the listing came back with nothing", () => {
    // A property part-way through both onboardings, and equally the failure
    // path: a listing that could not be read at all is recorded as an empty
    // answer, which refuses rather than offers.
    expect(gatewayOffer("VNPAY", [])).toBe("refused");
  });
});
