// The two invocation forms the READMEs document have to parse to the same
// options, because both are what a maintainer will type.

import { parseArgs } from "node:util";
import { describe, expect, it } from "vitest";
import { scriptArgs } from "./script-args.js";

/** The seed script's own option set, so the case exercises what it parses. */
const SEED_OPTIONS = {
  from: { type: "string" },
  bookings: { type: "string" },
} as const;

function parseSeed(argv: readonly string[]): Record<string, unknown> {
  return parseArgs({ args: scriptArgs(argv), options: SEED_OPTIONS }).values;
}

describe("the separator pnpm forwards", () => {
  it("is dropped when it leads", () => {
    expect(scriptArgs(["--", "--from", "2027-03-01"])).toEqual([
      "--from",
      "2027-03-01",
    ]);
  });

  it("leaves an argument list that never had one alone", () => {
    expect(scriptArgs(["--from", "2027-03-01"])).toEqual([
      "--from",
      "2027-03-01",
    ]);
  });

  it("leaves an empty invocation empty", () => {
    expect(scriptArgs([])).toEqual([]);
  });

  it("removes one separator and not a second", () => {
    expect(scriptArgs(["--", "--", "--from", "2027-03-01"])).toEqual([
      "--",
      "--from",
      "2027-03-01",
    ]);
  });
});

describe("the documented db:seed invocation", () => {
  // `apps/api/README.md` writes it with the separator, which is the form that
  // used to throw before any option was read.
  it("parses with the separator", () => {
    expect(parseSeed(["--", "--from", "2027-03-01", "--bookings", "0"])).toEqual(
      { from: "2027-03-01", bookings: "0" },
    );
  });

  it("parses identically without it", () => {
    expect(parseSeed(["--from", "2027-03-01", "--bookings", "0"])).toEqual({
      from: "2027-03-01",
      bookings: "0",
    });
  });

  // The one `allowPositionals: true` would have got wrong quietly: the option
  // has to arrive as an option, not as a positional the seed never reads.
  it("carries the pinned date through rather than defaulting", () => {
    expect(parseSeed(["--", "--from", "2027-03-01"]).from).toBe("2027-03-01");
  });

  it("takes no arguments at all", () => {
    expect(parseSeed([])).toEqual({});
  });
});
