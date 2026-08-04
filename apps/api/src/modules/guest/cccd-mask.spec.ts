// The masking rule, at every length — including the ones a real card never has.
//
// This is the only part of `FR-GST-03` with no database under it, and the only
// part where a bug is silent: a mask that leaks does not throw, does not fail a
// constraint and does not show up in an audit. It reads as a number on a screen
// somebody was allowed to see. So the cases below are lengths rather than
// examples, and the assertions are about what is *absent* from the answer.

import { describe, expect, it } from "vitest";
import { maskCccd } from "./cccd-mask.js";

// Twelve digits, the length a CCCD actually is. Not a real number: the first
// three digits of a real one are a province code and the next one a
// century-and-sex code, and a committed fixture that decodes to a plausible
// person is a small thing to avoid.
const CCCD = "079301012345";

describe("masking a CCCD", () => {
  it("shows the last four characters and hides the rest", () => {
    expect(maskCccd(CCCD)).toBe("********2345");
  });

  it("never contains the number it was given", () => {
    // The property the requirement is actually about, stated so it holds for
    // every case below rather than for the one worked example above.
    expect(maskCccd(CCCD)).not.toContain(CCCD.slice(0, -4));
  });

  it("keeps the length, so a fragment on file is visible as one", () => {
    expect(maskCccd(CCCD)).toHaveLength(CCCD.length);
  });

  it("shows nothing of a number exactly four characters long", () => {
    // The boundary, and the reason the tail rule is a floor and not a
    // subtraction: "show the last four" applied here prints its own input.
    expect(maskCccd("1234")).toBe("****");
  });

  it("shows nothing of a number shorter than four characters", () => {
    // The column carries no length check, so a mistyped entry is storable. A
    // masking function that leaks precisely on the records somebody got wrong
    // is the failure worth spending a branch on.
    expect(maskCccd("7")).toBe("*");
    expect(maskCccd("12")).toBe("**");
    expect(maskCccd("123")).toBe("***");
  });

  it("shows a single character of a number one longer than the tail", () => {
    expect(maskCccd("12345")).toBe("*2345");
  });

  it("leaves a number nobody took as absent, not as withheld", () => {
    // Two different facts: the property never had the number, against the
    // property having it and not showing it. A row of asterisks for the first
    // makes a residence report unable to say who is undocumented.
    expect(maskCccd(null)).toBeNull();
  });
});
