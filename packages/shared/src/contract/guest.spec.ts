// What a guest may say about themselves, and what the shape refuses outright.
//
// The profile is the one guest-realm write whose *field list* is the security
// boundary. Everything else on the screen is either the property's record of the
// guest or a figure derived from their history, and none of it has a route in —
// so the claim worth pinning here is that the input cannot be widened by
// sending more, and that the two ways a `PATCH` can mean "nothing" stay
// distinguishable.

import { CalendarDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { guestProfileSchema, updateProfileInput } from "./guest.js";

describe("what a guest may change about themselves", () => {
  it("takes the four editable fields and decodes the birthday", () => {
    const edit = updateProfileInput.parse({
      fullName: "Nguyễn Thị Hoa",
      phone: "0901234567",
      dateOfBirth: "1990-04-17",
      nationality: "Việt Nam",
    });

    expect(edit.fullName).toBe("Nguyễn Thị Hoa");
    expect(edit.dateOfBirth).toBeInstanceOf(CalendarDate);
    expect(edit.dateOfBirth?.toString()).toBe("1990-04-17");
  });

  it("takes an edit that names one field, leaving the rest unsaid", () => {
    // The whole reason the route is a `PATCH`. A screen editing a phone number
    // sends a phone number, and the three fields it did not send must not
    // arrive as instructions to clear them.
    const edit = updateProfileInput.parse({ phone: "0901234567" });

    expect(edit).toEqual({ phone: "0901234567" });
    expect("dateOfBirth" in edit).toBe(false);
  });

  it("tells clearing a field apart from leaving it alone", () => {
    const cleared = updateProfileInput.parse({ nationality: null });

    expect(cleared.nationality).toBeNull();
    expect("nationality" in cleared).toBe(true);
  });

  it("refuses a field that is not the guest's to change, rather than dropping it", () => {
    // The failure this exists to prevent: a `200` for a caller who sent a CCCD
    // and changed nothing. An ordinary object strips what it does not know,
    // which on a save screen reads as success.
    for (const forbidden of [
      { cccdNumber: "079301770001" },
      { email: "someone.else@example.test" },
      { vipTier: "GOLD" },
      { loyaltyPoints: "9999" },
      { id: "another-account" },
    ]) {
      expect(updateProfileInput.safeParse(forbidden).success).toBe(false);
    }
  });

  it("refuses a name that is blank once trimmed, so absent and empty stay apart", () => {
    // `guest_user_profile_full_name_present_when_set` refuses the same value
    // from the database's side. A blank name would fall through the fallback to
    // the account's registered name silently — the profile would answer with a
    // name nobody typed.
    expect(updateProfileInput.safeParse({ fullName: "   " }).success).toBe(
      false,
    );
    expect(updateProfileInput.safeParse({ phone: "" }).success).toBe(false);
  });

  it("bounds each field where check-in bounds the same fact", () => {
    // A guest who fills their profile in must not be refused at the desk for a
    // name the profile screen accepted — `checkInGuestSchema` carries the same
    // three lengths.
    expect(
      updateProfileInput.safeParse({ fullName: "n".repeat(121) }).success,
    ).toBe(false);
    expect(
      updateProfileInput.safeParse({ phone: "0".repeat(31) }).success,
    ).toBe(false);
    expect(
      updateProfileInput.safeParse({ nationality: "n".repeat(61) }).success,
    ).toBe(false);
  });
});

describe("the profile a guest is answered with", () => {
  const A_PROFILE = {
    id: "guest-account-1",
    fullName: "Nguyễn Thị Hoa",
    phone: null,
    email: "hoa@example.test",
    dateOfBirth: null,
    nationality: null,
    cccdMasked: "********0001",
    vipTier: "SILVER",
    loyaltyPoints: 1_200n,
    createdAt: "2027-06-07T02:00:00.000Z",
  };

  it("carries the account, the claim, the masked number and the two derived figures", () => {
    expect(guestProfileSchema.parse(A_PROFILE)).toMatchObject({
      vipTier: "SILVER",
      loyaltyPoints: 1_200n,
    });
  });

  it("has no field a plain CCCD could travel in", () => {
    // {@link guestRecordSchema} makes the same claim for the staff read, and it
    // is the same claim: the number leaves on one route, governed by its own
    // matrix row, and a handler cannot leak it through this shape by forgetting
    // to mask.
    expect(Object.keys(guestProfileSchema.shape)).not.toContain("cccdNumber");
  });

  it("takes the base tier, which is an absence everywhere else", () => {
    // `LOYALTY_TIERS` holds two rungs because that tuple types a promotion's
    // gate and MEMBER carries no discount. This question is different — what
    // tier is this guest standing at — and MEMBER is a real answer to it.
    expect(
      guestProfileSchema.safeParse({ ...A_PROFILE, vipTier: "MEMBER" }).success,
    ).toBe(true);
    expect(
      guestProfileSchema.safeParse({ ...A_PROFILE, vipTier: "PLATINUM" })
        .success,
    ).toBe(false);
  });
});
