import { describe, expect, it } from "vitest";
import {
  hasEdits,
  type ProfileFields,
  type ProfileValues,
  profileEdits,
} from "./profile-edits";

const ON_FILE: ProfileValues = {
  fullName: "Anh Nguyễn",
  phone: "0901234567",
  dateOfBirth: "1990-04-17",
  nationality: "Vietnamese",
};

const NOTHING_ON_FILE: ProfileValues = {
  fullName: "Anh Nguyễn",
  phone: null,
  dateOfBirth: null,
  nationality: null,
};

/** The form as a browser hands it back — every box a string, filled or not.
 *  Prefilled from a profile, because that is how the screen paints it. */
const typed = (
  from: ProfileValues,
  fields: Partial<ProfileFields> = {},
): ProfileFields => ({
  fullName: from.fullName,
  phone: from.phone ?? "",
  dateOfBirth: from.dateOfBirth ?? "",
  nationality: from.nationality ?? "",
  ...fields,
});

describe("profileEdits", () => {
  it("sends nothing when nothing was touched", () => {
    // A PATCH carrying no field writes nothing and answers 200, which reads to
    // a guest as a save that happened.
    expect(profileEdits(ON_FILE, typed(ON_FILE))).toEqual({});
  });

  it("sends only the field that changed", () => {
    expect(
      profileEdits(ON_FILE, typed(ON_FILE, { phone: "0987654321" })),
    ).toEqual({
      phone: "0987654321",
    });
  });

  it("clears an emptied box with null rather than omitting it", () => {
    // Absent means "leave it alone" — a guest who deletes a phone number they
    // no longer hold would otherwise keep it forever.
    expect(profileEdits(ON_FILE, typed(ON_FILE, { phone: "" }))).toEqual({
      phone: null,
    });
  });

  it("leaves a box that was empty and stayed empty alone", () => {
    expect(
      profileEdits(
        NOTHING_ON_FILE,
        typed(NOTHING_ON_FILE, { phone: "", nationality: "" }),
      ),
    ).toEqual({});
  });

  it("treats a trailing space as no change, because the API trims too", () => {
    expect(
      profileEdits(ON_FILE, typed(ON_FILE, { fullName: "Anh Nguyễn  " })),
    ).toEqual({});
  });

  it("sends a box that holds only spaces as a clear", () => {
    expect(
      profileEdits(ON_FILE, typed(ON_FILE, { nationality: "   " })),
    ).toEqual({
      nationality: null,
    });
  });

  it("clears a name, which the account falls back from rather than loses", () => {
    expect(profileEdits(ON_FILE, typed(ON_FILE, { fullName: "" }))).toEqual({
      fullName: null,
    });
  });

  it("carries every field that moved at once", () => {
    expect(
      profileEdits(
        NOTHING_ON_FILE,
        typed(NOTHING_ON_FILE, {
          fullName: "Anh Trần",
          phone: "0901234567",
          dateOfBirth: "1990-04-17",
          nationality: "Vietnamese",
        }),
      ),
    ).toEqual({
      fullName: "Anh Trần",
      phone: "0901234567",
      dateOfBirth: "1990-04-17",
      nationality: "Vietnamese",
    });
  });

  it("names no field the contract does not accept", () => {
    // `updateProfileInput` is a strict object: an unknown key is a 400 and not
    // a field quietly dropped, so the body may only ever hold these four.
    expect(
      Object.keys(
        profileEdits(NOTHING_ON_FILE, typed(NOTHING_ON_FILE, { phone: "090" })),
      ).every((key) =>
        ["fullName", "phone", "dateOfBirth", "nationality"].includes(key),
      ),
    ).toBe(true);
  });
});

describe("hasEdits", () => {
  it("is false for an untouched form", () => {
    expect(hasEdits(profileEdits(ON_FILE, typed(ON_FILE)))).toBe(false);
  });

  it("is true once one box has moved", () => {
    expect(hasEdits(profileEdits(ON_FILE, typed(ON_FILE, { phone: "" })))).toBe(
      true,
    );
  });
});
