import { describe, expect, it } from "vitest";
import { AFTER_SIGN_IN, loginHref, safeAfterSignIn } from "./sign-in";

describe("returning after sign-in", () => {
  it("keeps the booking path and its current search", () => {
    const returnTo =
      "/booking?checkIn=2026-09-10&checkOut=2026-09-13&step=rooms";

    expect(safeAfterSignIn(returnTo)).toBe(returnTo);
    expect(loginHref(returnTo)).toBe(
      `/login?returnTo=${encodeURIComponent(returnTo)}`,
    );
  });

  it.each([
    ["an absolute address", "https://example.com/account"],
    ["a protocol-relative address", "//example.com/account"],
    ["a backslash authority", "/\\example.com/account"],
    ["the login screen itself", "/login"],
    ["a nested login path", "/login/"],
    ["an empty attach arrival", "/login?attach="],
    ["an empty value", ""],
  ])("refuses %s", (_label, candidate) => {
    expect(safeAfterSignIn(candidate)).toBe(AFTER_SIGN_IN);
  });

  it("uses the account area when no prior guest surface was supplied", () => {
    expect(safeAfterSignIn(undefined)).toBe("/account");
  });

  it("keeps the one login return that completes a booking attach", () => {
    const booking = "0f8fad5b-d9cb-469f-a165-70867728950e";

    expect(safeAfterSignIn(`/login?attach=${booking}`)).toBe(
      `/login?attach=${booking}`,
    );
  });
});
