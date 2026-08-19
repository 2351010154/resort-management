// Who a booking may be addressed to, and which half of that a door refuses.
//
// The rule is asymmetric and the asymmetry is the whole of what is worth
// pinning. A name with no address is a telephone booking — the desk has the
// guest on the line, writes down who they are, and may never be given a mailbox
// now that a phone number has nowhere to live on a booking — so the pair is
// taken as it arrived and the property can still say whose stay it is. An
// address with nobody's name against it is the half nothing can compose a
// message from, and it stays refused.
//
// Both directions are asserted here rather than only the one that changed,
// because a predicate that was once symmetric fails silently in the other
// direction: relaxing it too far reads exactly like relaxing it correctly until
// somebody books a mailbox with no name on it.

import { describe, expect, it } from "vitest";
import { createBookingInput, createHoldInput } from "./booking.js";

/** A stay the schema is happy with, so only the contact is under test. */
const A_STAY = {
  roomType: "DELUXE",
  checkIn: "2027-10-04",
  checkOut: "2027-10-06",
  adults: 2,
};

describe("the contact the desk's creating door takes", () => {
  it("takes the pair a telephone booking with an address produces", () => {
    const stay = createBookingInput.parse({
      ...A_STAY,
      contactName: "Nguyễn Thu Hà",
      contactEmail: "phone-booking@example.test",
    });

    expect(stay.contactName).toBe("Nguyễn Thu Hà");
    expect(stay.contactEmail).toBe("phone-booking@example.test");
  });

  it("takes a name with no address, which is what a telephone call leaves", () => {
    // The case the old whole-or-nothing rule refused. Nothing is emailed to
    // this stay and nothing needs to be: what the desk gained is the ability to
    // say whose booking it is, which is the only thing the call produced.
    const stay = createBookingInput.parse({
      ...A_STAY,
      contactName: "Trần Văn Hùng",
    });

    expect(stay.contactName).toBe("Trần Văn Hùng");
    expect(stay.contactEmail).toBeUndefined();
  });

  it("refuses an address with nobody's name against it", () => {
    const refused = createBookingInput.safeParse({
      ...A_STAY,
      contactEmail: "nameless@example.test",
    });

    expect(refused.success).toBe(false);
    // Against the name, because that is the field the caller has to supply — a
    // message needs somebody to put at the top of it.
    expect(refused.error?.issues[0]?.path).toEqual(["contactName"]);
  });

  it("takes a walk-in who named nobody at all", () => {
    // Somebody at the counter is handed their confirmation, so neither half is
    // missing — there was never anything to write down.
    const stay = createBookingInput.parse(A_STAY);

    expect(stay.contactName).toBeUndefined();
    expect(stay.contactEmail).toBeUndefined();
  });

  it("still refuses a name that is blank once trimmed", () => {
    // Absent and empty stay apart: the relaxation is about a half that is
    // genuinely absent, not about accepting a name nobody typed.
    expect(
      createBookingInput.safeParse({ ...A_STAY, contactName: "   " }).success,
    ).toBe(false);
  });

  it("still refuses an address that is not one", () => {
    expect(
      createBookingInput.safeParse({
        ...A_STAY,
        contactName: "Trần Văn Hùng",
        contactEmail: "hung-at-home",
      }).success,
    ).toBe(false);
  });
});

describe("the funnel's creating door", () => {
  it("takes no contact at all, and is not loosened by the desk's rule", () => {
    // The hold is taken the moment a room is chosen, and asking a stranger who
    // they are in order to reserve twenty minutes is what the funnel stopped
    // doing — the pair is named on the review screen instead, where
    // `setHoldContactInput` requires both halves outright. So neither half is a
    // field of this door, and a body carrying them is stripped rather than
    // judged by the desk's predicate.
    const held = createHoldInput.parse({
      ...A_STAY,
      contactName: "Trần Văn Hùng",
      contactEmail: "funnel@example.test",
    });

    expect("contactName" in held).toBe(false);
    expect("contactEmail" in held).toBe(false);
  });
});
