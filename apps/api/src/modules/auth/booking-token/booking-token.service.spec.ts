// What the signature buys, asserted directly.
//
// The e2e suite proves the credential opens the right stay over HTTP. What only
// a unit test can put clearly is the set of things that must *not* verify, and
// each of them is a way somebody would try to turn a stay of their own into
// somebody else's: edit the booking id, edit the reference, keep the payload
// and forge the signature, keep both and outlive the expiry, or present a token
// minted under a different deployment's secret.

import "reflect-metadata";

import { describe, expect, it } from "vitest";
import type { Env } from "../../../config/env.js";
import { BookingTokenService } from "./booking-token.service.js";

const SECRET = "a-secret-at-least-thirty-two-characters-long";

const A_STAY = {
  bookingId: "11111111-1111-4111-8111-111111111111",
  reference: "AAAA-1111",
  expiresAt: new Date(Date.now() + 86_400_000),
};

function tokens(secret = SECRET): BookingTokenService {
  return new BookingTokenService({
    BETTER_AUTH_SECRET: secret,
    NODE_ENV: "test",
  } as Env);
}

/** The payload half of a token, decoded — how the tampering below is written. */
function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.slice(0, token.lastIndexOf(".")), "base64url").toString(
      "utf8",
    ),
  );
}

function reassemble(payload: object, signature: string): string {
  return `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${signature}`;
}

describe("a booking token", () => {
  it("opens the stay it was minted for", () => {
    const service = tokens();

    expect(service.verify(service.mint(A_STAY))).toEqual({
      realm: "booking",
      bookingId: A_STAY.bookingId,
      reference: A_STAY.reference,
    });
  });

  it("names one stay and no account", () => {
    // The property that keeps it from being a login: there is nothing in it a
    // handler could mistake for a guest account, so no code path can widen it
    // into a session by reading a field.
    const service = tokens();
    const opened = service.verify(service.mint(A_STAY));

    expect(opened).not.toHaveProperty("userId");
    expect(opened).not.toHaveProperty("sessionId");
  });

  it("refuses a payload edited to name another booking", () => {
    const service = tokens();
    const minted = service.mint(A_STAY);
    const signature = minted.slice(minted.lastIndexOf(".") + 1);

    const edited = reassemble(
      { ...payloadOf(minted), b: "22222222-2222-4222-8222-222222222222" },
      signature,
    );

    expect(service.verify(edited)).toBeNull();
  });

  it("refuses a payload edited to name another reference", () => {
    const service = tokens();
    const minted = service.mint(A_STAY);
    const signature = minted.slice(minted.lastIndexOf(".") + 1);

    const edited = reassemble({ ...payloadOf(minted), r: "ZZZZ-9999" }, signature);

    expect(service.verify(edited)).toBeNull();
  });

  it("refuses a payload whose expiry was pushed out", () => {
    const service = tokens();
    const expired = service.mint({
      ...A_STAY,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const signature = expired.slice(expired.lastIndexOf(".") + 1);

    expect(service.verify(expired)).toBeNull();

    const extended = reassemble(
      { ...payloadOf(expired), e: Math.floor(Date.now() / 1000) + 3_600 },
      signature,
    );

    expect(service.verify(extended)).toBeNull();
  });

  it("refuses one minted under another secret", () => {
    // Two deployments, or a rotated key. A token that survived either would be
    // a credential the property could not revoke by changing anything.
    const elsewhere = tokens(`${SECRET}-but-different`);

    expect(tokens().verify(elsewhere.mint(A_STAY))).toBeNull();
  });

  it("refuses the shapeless cases the same way", () => {
    const service = tokens();

    for (const presented of [
      undefined,
      "",
      "no-separator",
      ".",
      `${"x".repeat(600)}.y`,
      `${Buffer.from("not json", "utf8").toString("base64url")}.y`,
    ]) {
      expect(service.verify(presented), presented).toBeNull();
    }
  });

  it("dies seven days after the guest checks out", () => {
    // The window decision 3 of the plan takes: long enough for a receipt and a
    // date somebody wants to check after the stay, short enough that a bearer
    // credential in a browser is not permanent.
    const checkOut = new Date("2027-06-09T00:00:00.000Z");

    expect(tokens().expiryFor(checkOut).toISOString()).toBe(
      "2027-06-16T00:00:00.000Z",
    );
  });
});
