import { describe, expect, it } from "vitest";

import {
  type ChosenGuest,
  documentTranscription,
  type Particulars,
  transcriptionRefusal,
} from "./arrival-queue";

/* What the document step sends, and what it refuses to send — `FR-GST-02`.
 *
 * The decision this covers is the one that used not to exist. A guest the
 * property already holds is named at check-in by id and by nothing else, so the
 * particulars typed beside that id went nowhere: a returning guest whose
 * document was never read could not gain one, and the stay could not discharge
 * Nghị định 96/2016/NĐ-CP Điều 44. `guest.transcribeDocument` is where they go
 * now, and what is asserted here is the two halves of when: everything the desk
 * typed about a known guest is sent, and a step nobody typed into sends nothing
 * at all — a returning guest whose record is already complete costs one press
 * and no request.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives.
 */

function typed(over: Partial<Particulars> = {}): Particulars {
  return {
    fullName: "",
    cccdNumber: "",
    dateOfBirth: "",
    nationality: "",
    phone: "",
    ...over,
  };
}

const KNOWN: ChosenGuest = {
  kind: "known",
  id: "6b0f2b6a-9a1f-4c67-9d0e-2f5f8a5f1c01",
  name: "Nguyễn Thị Mai",
  cccdMasked: null,
};

describe("what the document step owes the guest record", () => {
  it("sends what the desk read off a returning guest's document", () => {
    expect(
      documentTranscription(
        KNOWN,
        typed({
          cccdNumber: "079301770001",
          dateOfBirth: "1993-01-04",
          nationality: "VN",
        }),
      ),
    ).toEqual({
      guestId: KNOWN.id,
      cccdNumber: "079301770001",
      dateOfBirth: "1993-01-04",
      nationality: "VN",
    });
  });

  it("sends nothing when the desk typed nothing", () => {
    // The ordinary arrival of a guest whose record is already complete. The
    // contract refuses a body naming no particular, so deciding here is what
    // keeps the press from costing a request and a refusal.
    expect(documentTranscription(KNOWN, typed())).toBeNull();

    // A number on file is not something to resend: what the step shows is the
    // masked one, and the desk leaves the box alone.
    expect(
      documentTranscription({ ...KNOWN, cccdMasked: "********0001" }, typed()),
    ).toBeNull();
  });

  it("leaves out the boxes nobody filled in, rather than clearing them", () => {
    // Absent is "this document was not read for that", and the route has no
    // spelling for clearing a fact. A blank box travelling as null would take a
    // nationality off a statutory record because a passport did not repeat it.
    const read = documentTranscription(KNOWN, typed({ nationality: "VN" }));

    expect(read).toEqual({ guestId: KNOWN.id, nationality: "VN" });
    expect(read && "cccdNumber" in read).toBe(false);
    expect(read && "dateOfBirth" in read).toBe(false);
  });

  it("trims what a desk scanner adds, and reads a blank as untyped", () => {
    expect(
      documentTranscription(KNOWN, typed({ cccdNumber: " 079301770001 " })),
    ).toEqual({ guestId: KNOWN.id, cccdNumber: "079301770001" });

    expect(
      documentTranscription(KNOWN, typed({ nationality: "   " })),
    ).toBeNull();
  });

  it("sends nothing for a guest being registered now", () => {
    // Their particulars travel inside the check-in that creates the record, in
    // that transition's transaction. There is no id yet for a separate call to
    // name, and a second write would be a duplicate of the person.
    expect(
      documentTranscription(
        { kind: "new", name: "Trần Văn Sơn" },
        typed({ cccdNumber: "079301770002", nationality: "VN" }),
      ),
    ).toBeNull();

    // And nothing at all before the guest step has been answered.
    expect(
      documentTranscription(null, typed({ cccdNumber: "079301770002" })),
    ).toBeNull();
  });

  it("keeps a date the step would not have let past", () => {
    // The step refuses to advance on an unreadable birth date, so this is the
    // second line rather than the first: a date that is not one is dropped
    // instead of being sent for the API to reject halfway through a check-in.
    expect(
      documentTranscription(KNOWN, typed({ dateOfBirth: "1990-02-30" })),
    ).toBeNull();

    expect(
      documentTranscription(
        KNOWN,
        typed({ dateOfBirth: "04/01/1993", nationality: "VN" }),
      ),
    ).toEqual({ guestId: KNOWN.id, nationality: "VN" });
  });
});

describe("what a refused transcription tells the desk", () => {
  it("names the next act when the number is on another record", () => {
    // Not a fault: the property has met this person before. Either the digits
    // are wrong or the guest standing there is the other record, and the
    // sentence offers both.
    const sentence = transcriptionRefusal({ status: 409 });

    expect(sentence).toContain("another guest's record");
    expect(sentence).toContain("pick the guest");
  });

  it("invites the press again for anything else", () => {
    // Safe advice, because the route is idempotent: the same three facts sent
    // twice leave the record saying what the card says.
    for (const failure of [
      { status: 500 },
      new Error("the network was not there"),
      null,
    ]) {
      expect(transcriptionRefusal(failure)).toContain("Try again");
    }
  });
});
