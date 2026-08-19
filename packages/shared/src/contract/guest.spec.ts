// What a guest may say about themselves, and what the shape refuses outright.
//
// The profile is the one guest-realm write whose *field list* is the security
// boundary. Everything else on the screen is either the property's record of the
// guest or a figure derived from their history, and none of it has a route in —
// so the claim worth pinning here is that the input cannot be widened by
// sending more, and that the two ways a `PATCH` can mean "nothing" stay
// distinguishable.
//
// The desk's transcription is held to the opposite half of that rule at the
// foot of the file. It writes onto the property's record rather than onto a
// guest's claim, so absent still leaves a fact alone and `null` is refused
// outright — the two inputs are one file apart precisely so the difference is
// read rather than assumed, and these cases are what stop them converging.

import { CalendarDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  guestProfileSchema,
  transcribeDocumentInput,
  updateProfileInput,
} from "./guest.js";

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

describe("the particulars read off a document at the desk", () => {
  const A_GUEST = "6b0f2b6a-9a1f-4c67-9d0e-2f5f8a5f1c01";

  it("takes the three facts a card carries and decodes the birthday", () => {
    const read = transcribeDocumentInput.parse({
      guestId: A_GUEST,
      cccdNumber: "079301770001",
      dateOfBirth: "1993-01-04",
      nationality: "VN",
    });

    expect(read.cccdNumber).toBe("079301770001");
    expect(read.dateOfBirth).toBeInstanceOf(CalendarDate);
    expect(read.dateOfBirth?.toString()).toBe("1993-01-04");
  });

  it("takes a transcription that names one fact, leaving the rest unsaid", () => {
    // A desk that read a nationality off a passport and had the number already
    // sends the nationality. The two facts it did not send must not arrive as
    // instructions about them.
    const read = transcribeDocumentInput.parse({
      guestId: A_GUEST,
      nationality: "VN",
    });

    expect("cccdNumber" in read).toBe(false);
    expect("dateOfBirth" in read).toBe(false);
  });

  it("has no spelling for clearing a fact, where the profile has one", () => {
    // The difference this file exists to keep visible. A guest clearing their
    // own nationality is saying something true about a profile; an identity
    // number cleared at a desk is the statutory record losing what Điều 44
    // obliged the property to take, so `null` is a `400` here and a `200` next
    // door.
    expect(updateProfileInput.safeParse({ nationality: null }).success).toBe(
      true,
    );

    for (const cleared of [
      { cccdNumber: null },
      { dateOfBirth: null },
      { nationality: null },
    ]) {
      expect(
        transcribeDocumentInput.safeParse({ guestId: A_GUEST, ...cleared })
          .success,
      ).toBe(false);
    }
  });

  it("refuses a body that records nothing rather than answering it", () => {
    // The reply that tells a desk its typing landed when it did not. Nothing
    // was read off any document, so there is no transcription to accept.
    expect(
      transcribeDocumentInput.safeParse({ guestId: A_GUEST }).success,
    ).toBe(false);
  });

  it("refuses a field that is not a particular, rather than dropping it", () => {
    // Strict for {@link updateProfileInput}'s reason, and one entry below is
    // the sharp one: a name sent here would be silently dropped by an ordinary
    // object, and the desk would read the `200` as having corrected it.
    for (const forbidden of [
      { fullName: "Nguyễn Thị Hoa" },
      { phone: "0901234567" },
      { email: "hoa@example.test" },
      { cccdMasked: "********0001" },
    ]) {
      expect(
        transcribeDocumentInput.safeParse({
          guestId: A_GUEST,
          cccdNumber: "079301770001",
          ...forbidden,
        }).success,
      ).toBe(false);
    }
  });

  it("bounds each fact where check-in bounds the same one", () => {
    // A number the desk may type into a check-in must not be refused by the
    // route that exists to record it afterwards — `checkInGuestSchema` carries
    // these two lengths.
    expect(
      transcribeDocumentInput.safeParse({
        guestId: A_GUEST,
        cccdNumber: "0".repeat(21),
      }).success,
    ).toBe(false);
    expect(
      transcribeDocumentInput.safeParse({
        guestId: A_GUEST,
        nationality: "n".repeat(61),
      }).success,
    ).toBe(false);

    expect(
      transcribeDocumentInput.safeParse({
        guestId: A_GUEST,
        cccdNumber: "0".repeat(20),
        nationality: "n".repeat(60),
      }).success,
    ).toBe(true);
  });

  it("trims what a scanner adds and refuses what trims away to nothing", () => {
    // A desk scanner emulates a keyboard and a stray space is what it adds. The
    // trim is the same one `guest.service.ts` performs before the write, said
    // where the caller can still be told; the blank is the clearing this schema
    // has no spelling for, arriving as an empty string instead.
    const read = transcribeDocumentInput.parse({
      guestId: A_GUEST,
      cccdNumber: " 079301770001 ",
    });

    expect(read.cccdNumber).toBe("079301770001");

    for (const blank of [{ cccdNumber: "   " }, { nationality: "" }]) {
      expect(
        transcribeDocumentInput.safeParse({ guestId: A_GUEST, ...blank })
          .success,
      ).toBe(false);
    }
  });

  it("names the guest it is about, so no body decides who was identified", () => {
    expect(
      transcribeDocumentInput.safeParse({ cccdNumber: "079301770001" }).success,
    ).toBe(false);
  });
});
