// The message that offers an address to an account that does not hold it yet.
//
// It is the one email in this realm sent to somebody who may not have asked for
// it. Sign-up and reset both go to an address the person at the keyboard typed
// about themselves; this one goes wherever a signed-in guest names, which
// includes a stranger's inbox when the guest is a stranger. So what it must not
// say is as much the subject here as what it says: it may not confirm that the
// address it arrived at already has an account, and it may not name the account
// that asked, because either turns a mail nobody wanted into a disclosure.
//
// The link and the "once" are the other half. A guest who did not ask needs to
// be able to read, in the message itself, that ignoring it changes nothing.

import { describe, expect, it } from "vitest";
import { confirmEmailChange } from "./guest-auth-emails.js";

const URL = "https://api.mariva.test/api/auth/verify-email?token=a-token&callbackURL=%2Faccount";

const CHANGE = {
  to: "new-address@example.test",
  name: "Anh Nguyễn",
  url: URL,
};

describe("the confirmation for an address a guest wants to move to", () => {
  const email = confirmEmailChange(CHANGE);

  it("carries the link in both bodies", () => {
    // A text part as well as an HTML one, for the reason the file above states:
    // a link that only exists inside HTML cannot be followed by every client.
    expect(email.text).toContain(URL);
    // Escaped in the HTML body, which is what puts the query string back
    // together in a browser rather than truncating it at the ampersand.
    expect(email.html).toContain(URL.replaceAll("&", "&amp;"));
  });

  it("is addressed to the new address and greets the guest by name", () => {
    expect(email.to).toBe(CHANGE.to);
    expect(email.text).toContain(CHANGE.name);
    expect(email.html).toContain(CHANGE.name);
  });

  it("says the link expires in an hour and works once", () => {
    for (const body of [email.text, email.html]) {
      expect(body).toContain("hour");
      expect(body).toContain("once");
    }
  });

  it("says that ignoring it changes nothing", () => {
    // The whole recourse of somebody who received this and asked for nothing.
    for (const body of [email.text.toLowerCase(), email.html.toLowerCase()]) {
      expect(body).toContain("if this was not you");
      expect(body).toContain("nothing changes until the link is used");
    }
  });

  it("says nothing about whether this address already has an account", () => {
    const said = `${email.subject} ${email.text} ${email.html}`.toLowerCase();

    expect(
      said.includes("already"),
      "The change-email message tells its recipient something about an " +
        "account already registered to their address. Anyone signed in can " +
        "aim this message at any address, so a sentence that varies with " +
        "whether one exists is an account-existence oracle delivered by mail.",
    ).toBe(false);
  });

  it("quotes no address in either body", () => {
    // The guest asking for the move is identified nowhere in the message —
    // a stranger who aimed it here would otherwise have handed the recipient a
    // real Mariva address. The destination is not repeated either: the message
    // is already in that inbox, and printing it is one more string a forwarded
    // copy carries.
    const said = `${email.subject} ${email.text} ${email.html}`;

    expect(said).not.toContain("@");
  });

  it("escapes the name it interpolates into the HTML body", () => {
    // A display name comes from a sign-up form, so it is attacker-typed. This
    // template puts it in a heading.
    const injected = confirmEmailChange({
      ...CHANGE,
      name: '<script>alert("x")</script>',
    });

    expect(injected.html).not.toContain("<script>");
    expect(injected.html).toContain("&lt;script&gt;");
  });
});
