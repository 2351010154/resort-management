// The reminder's five facts, and the one of them that is not a courtesy.
//
// The identity-document line is the reason this message exists at all:
// `FR-GST-02` has the desk read and transcribe a document before a room is handed
// over, so a guest who travels without one cannot be checked in. A reminder that
// dropped that sentence would still read like a nice email.
//
// The date assertion is fixed rather than derived from a clock, and it is written
// against the property's zone: a `StayDate` is a calendar day at the property, and
// formatting it as an instant in UTC is the off-by-one-night that the type exists
// to prevent — a guest arriving on the 11th told to come on the 10th.

import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { preArrivalReminder } from "./pre-arrival-reminder-email.js";
import {
  CHECK_IN_TIME,
  PROPERTY_ADDRESS,
} from "./guest-auth-emails.js";

const REMINDER = {
  to: "guest@example.test",
  guestName: "Trần Minh",
  reference: "MRV-2027-0042",
  arrival: parseDate("2027-06-11"),
  roomType: "Junior Suite",
} as const;

describe("the reminder a guest gets the day before arriving", () => {
  const email = preArrivalReminder(REMINDER);

  it("names the arrival day as a person reads one, in both bodies", () => {
    // Friday 11 June 2027 in the property's own zone. A body carrying
    // "2027-06-11" is a body written for a database.
    expect(email.text).toContain("11 June 2027");
    expect(email.html).toContain("11 June 2027");
    expect(email.text).not.toContain("2027-06-11");
  });

  it("says when the desk can hand over a room", () => {
    expect(email.text).toContain(CHECK_IN_TIME);
    expect(email.html).toContain(CHECK_IN_TIME);
  });

  it("names the room type the guest chose, and the reference the desk asks for", () => {
    expect(email.text).toContain(REMINDER.roomType);
    expect(email.html).toContain(REMINDER.roomType);
    expect(email.text).toContain(REMINDER.reference);
    expect(email.html).toContain(REMINDER.reference);
  });

  it("says where the property is", () => {
    expect(email.text).toContain(PROPERTY_ADDRESS);
    expect(email.html).toContain(PROPERTY_ADDRESS);
  });

  it("asks for the identity document, and says why it cannot be skipped", () => {
    for (const body of [email.text, email.html]) {
      expect(body).toContain("identity document");
      expect(body).toContain("CCCD");
      expect(body).toContain("passport");
      // The consequence, not just the request: a guest who reads this as
      // optional arrives without one and cannot be checked in.
      expect(body).toContain("cannot complete check-in");
    }
  });

  it("promises the document is not kept, which is `NFR-08` in a sentence", () => {
    expect(email.text).toContain("Nothing is copied or kept");
  });

  it("is addressed to the booking's contact, with the reference in the subject", () => {
    expect(email.to).toBe(REMINDER.to);
    expect(email.subject).toContain(REMINDER.reference);
    expect(email.text.trim()).not.toBe("");
    expect(email.html.trim()).not.toBe("");
  });

  it("greets the guest by the name on the booking", () => {
    expect(email.text).toContain(REMINDER.guestName);
    expect(email.html).toContain(REMINDER.guestName);
  });

  it("carries no link, which is why the whole message may be queued", () => {
    expect(email.text).not.toContain("http");
    expect(email.html).not.toContain("href");
  });
});

describe("a contact name that is trying to be markup", () => {
  const payload = '<img src=x onerror="alert(1)">';
  const email = preArrivalReminder({ ...REMINDER, guestName: payload });

  it("does not survive into the HTML in a form a client would execute", () => {
    expect(email.html).not.toContain(payload);
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain('onerror="');
  });

  it("is escaped in the heading and not only in the paragraphs", () => {
    expect(email.html).toContain(
      `<h1 style="font-weight:400;font-size:24px;margin:0 0 16px">See you tomorrow, &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</h1>`,
    );
  });
});

describe("a room type name that is trying to be markup", () => {
  // It is the property's own row rather than a guest's typing, and it is escaped
  // anyway: an `ADMIN` renaming a room type is not a reason for a mail client to
  // run something.
  const email = preArrivalReminder({ ...REMINDER, roomType: "Suite<script>" });

  it("is escaped in the HTML and left alone in the text", () => {
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Suite&lt;script&gt;");
    expect(email.text).toContain("Suite<script>");
  });
});
