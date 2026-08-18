import {
  STAFF_ROLES,
  type StaffRole,
  updateSystemConfigInput,
} from "@mariva/shared";
import { describe, expect, it } from "vitest";

import {
  type ConfigEditAttempt,
  type ConfigFields,
  configEdit,
  configFingerprint,
  type ConfigurationEdit,
  dongLabel,
  fieldsFrom,
  lastSignedInLabel,
  mayEditConfiguration,
  mayManageStaffAccounts,
  mayReadConfiguration,
  NO_STAFF_ACCOUNT_FIELDS,
  type NewStaffAccount,
  rateLabel,
  resolvedWindowEnd,
  rolloverLabel,
  type StaffAccountFields,
  staffAccountAttempt,
  staffAccountsFrom,
  type SystemConfiguration,
} from "./settings-form";

/* The settings screen's decisions, held to the rules the module states.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives. What is
 * covered instead is everything underneath the markup, and two things above all,
 * because they are the two that corrupt a tax configuration without failing:
 *
 * 1. **Minimal-diff construction.** A `PATCH` that named a figure nobody touched
 *    would overwrite a rate an accountant set last week with whatever this form
 *    happened to be holding, and it would do it silently and successfully.
 * 2. **Null against undefined on the relief window.** The two are one keystroke
 *    apart in a form and opposite instructions on the wire: absent leaves an end
 *    where it stands, null unbounds it. Getting them the wrong way round either
 *    lapses a statutory relief period early or refuses to let it lapse at all.
 *
 * Beside those, the refusals: what the contract's own schema rejects, and the two
 * invariants that span two columns and can therefore be answered here — because
 * the screen holds the stored row it read beside the edit it is about to send.
 */

/* The property as `ASM-01` seeds it: 10% standard, 8% reduced, 1 Jul 2025 to 31
 * Dec 2026, a base that includes the service charge, a day that turns at 04:00. */
const PROPERTY: SystemConfiguration = {
  standardVatRateBps: 1000,
  reducedVatRateBps: 800,
  reducedVatFrom: "2025-07-01",
  reducedVatTo: "2026-12-31",
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 500,
  businessDateRolloverHour: 4,
  loyaltyPointsPerUnit: 1,
  loyaltyEarnUnitVnd: 100_000n,
  tierSilverStays: 3,
  tierSilverRevenueVnd: 30_000_000n,
  tierGoldStays: 8,
  tierGoldRevenueVnd: 80_000_000n,
};

/** The day relative dates are counted from, as the API would answer it. */
const TODAY = "2026-08-16";

/** The form as the row filled it, with whatever the test then typed into it. */
function attempt(typed: Partial<ConfigFields> = {}): ConfigEditAttempt {
  return configEdit({ ...fieldsFrom(PROPERTY), ...typed }, PROPERTY, TODAY);
}

/** The body an edit would send, or a failure naming what came back instead. */
function sent(over: Partial<ConfigFields> = {}): ConfigurationEdit {
  const answered = attempt(over);

  if (!("input" in answered)) {
    throw new Error(
      `expected a body to send, got ${"problem" in answered ? answered.problem : "an unchanged form"}`,
    );
  }

  return answered.input;
}

/** The sentence an edit was refused with, or a failure saying it was not. */
function refusal(over: Partial<ConfigFields> = {}): string {
  const answered = attempt(over);

  if (!("problem" in answered)) {
    throw new Error("expected a refusal, and the form produced none");
  }

  return answered.problem;
}

function account(typed: Partial<StaffAccountFields> = {}): StaffAccountFields {
  return {
    ...NO_STAFF_ACCOUNT_FIELDS,
    email: "quan.ly@mariva.vn",
    fullName: "Nguyễn Thị Mai",
    role: "RECEPTIONIST",
    password: "a-long-enough-one",
    ...typed,
  };
}

function created(typed: Partial<StaffAccountFields> = {}): NewStaffAccount {
  const answered = staffAccountAttempt(account(typed));

  if (!("account" in answered)) {
    throw new Error(`expected an account, got: ${answered.problem}`);
  }

  return answered.account;
}

// ── Who is offered which half ────────────────────────────────────────────────

describe("the capability predicates", () => {
  it("gives staff accounts to the administrator alone", () => {
    // The one row in the matrix `ADMIN` holds by itself, which is why the
    // manager who may read every tax figure is still not offered this half.
    const offered = STAFF_ROLES.filter((role) => mayManageStaffAccounts(role));

    expect(offered).toEqual(["ADMIN"]);
  });

  it("lets a manager read the configuration and only an administrator change it", () => {
    expect(STAFF_ROLES.filter((role) => mayReadConfiguration(role))).toEqual([
      "MANAGER",
      "ADMIN",
    ]);
    expect(STAFF_ROLES.filter((role) => mayEditConfiguration(role))).toEqual([
      "ADMIN",
    ]);
  });

  it("offers a manager configuration without offering them accounts", () => {
    expect(mayReadConfiguration("MANAGER")).toBe(true);
    expect(mayManageStaffAccounts("MANAGER")).toBe(false);
    expect(mayEditConfiguration("MANAGER")).toBe(false);
  });

  it("offers the desk neither half", () => {
    const desk: readonly StaffRole[] = [
      "RECEPTIONIST",
      "HOUSEKEEPING",
      "ACCOUNTANT",
    ];

    for (const role of desk) {
      expect(mayManageStaffAccounts(role)).toBe(false);
      expect(mayReadConfiguration(role)).toBe(false);
      expect(mayEditConfiguration(role)).toBe(false);
    }
  });
});

// ── Half one: creating a staff account ───────────────────────────────────────

describe("staffAccountAttempt", () => {
  it("sends the four fields the API takes, and exactly one role", () => {
    expect(created()).toEqual({
      email: "quan.ly@mariva.vn",
      fullName: "Nguyễn Thị Mai",
      role: "RECEPTIONIST",
      password: "a-long-enough-one",
    });
  });

  it("trims the address and the name", () => {
    const made = created({
      email: "  quan.ly@mariva.vn ",
      fullName: "  Nguyễn Thị Mai  ",
    });

    expect(made.email).toBe("quan.ly@mariva.vn");
    expect(made.fullName).toBe("Nguyễn Thị Mai");
  });

  it("leaves the password exactly as it was typed", () => {
    // A space inside a password is part of the password. Trimming one here
    // creates an account whose holder cannot sign in.
    expect(created({ password: " twelve chars " }).password).toBe(
      " twelve chars ",
    );
  });

  it("refuses an address the API would not take", () => {
    expect(refusalFor({ email: "quan.ly" })).toContain("not an address");
  });

  it("refuses an account with nobody's name on it", () => {
    expect(refusalFor({ fullName: "   " })).toContain("needs the name");
  });

  it("refuses a name longer than the column holds", () => {
    expect(refusalFor({ fullName: "a".repeat(201) })).toContain("201");
  });

  it("refuses to guess a role, and says why there is only ever one", () => {
    expect(refusalFor({ role: null })).toContain("exactly one");
  });

  it("holds the twelve-character floor where the password is set", () => {
    expect(refusalFor({ password: "elevenchars" })).toContain("12 characters");
  });

  it("refuses a password longer than the API accepts", () => {
    expect(refusalFor({ password: "x".repeat(129) })).toContain(
      "128 characters",
    );
  });

  it("takes each of the five roles as the one role of an account", () => {
    for (const role of STAFF_ROLES) {
      expect(created({ role }).role).toBe(role);
    }
  });
});

function refusalFor(typed: Partial<StaffAccountFields>): string {
  const answered = staffAccountAttempt(account(typed));

  if (!("problem" in answered)) {
    throw new Error("expected a refusal, and the form produced none");
  }

  return answered.problem;
}

describe("staffAccountsFrom", () => {
  const wire = {
    id: "9f1d0c2e-4b8a-4d1e-9a77-0c3e5b6a7d81",
    email: "quan.ly@mariva.vn",
    fullName: "Nguyễn Thị Mai",
    role: "MANAGER",
    isActive: true,
    lastSignedInAt: "2026-08-16T02:12:00.000Z",
  };

  it("reads the list the API answers with", () => {
    expect(staffAccountsFrom([wire])).toEqual([wire]);
  });

  it("reads an account that has never signed in", () => {
    expect(staffAccountsFrom([{ ...wire, lastSignedInAt: null }])).toHaveLength(
      1,
    );
  });

  it("reads an empty list as an empty list", () => {
    expect(staffAccountsFrom([])).toEqual([]);
  });

  it("refuses a body that is not a list of accounts", () => {
    // A 200 whose body is not the list it claims to be is a deployment
    // mismatch, and finding out by rendering an object into a table cell is
    // finding out three screens later.
    expect(staffAccountsFrom({ accounts: [wire] })).toBeNull();
    expect(staffAccountsFrom(null)).toBeNull();
    expect(staffAccountsFrom("[]")).toBeNull();
  });

  it("refuses a list with an account missing a field the API names", () => {
    const { role, ...withoutRole } = wire;

    expect(staffAccountsFrom([withoutRole])).toBeNull();
    expect(role).toBe("MANAGER");
  });

  it("refuses an account whose fields are the wrong shape", () => {
    expect(staffAccountsFrom([{ ...wire, isActive: "true" }])).toBeNull();
    expect(staffAccountsFrom([{ ...wire, lastSignedInAt: 0 }])).toBeNull();
  });
});

describe("lastSignedInLabel", () => {
  it("says so when an account has never been used", () => {
    expect(lastSignedInLabel(null)).toBe("Never signed in");
  });

  it("reads the instant in the property's own zone", () => {
    // 02:12 UTC is 09:12 in Ho Chi Minh City. Slicing the date out of the ISO
    // text would have reported the UTC day, which is the previous one for every
    // sign-in before 07:00 local.
    const label = lastSignedInLabel("2026-08-16T02:12:00.000Z");

    expect(label).toContain("16 Aug 2026");
    expect(label).toContain("09:12");
  });
});

// ── Half two: shaping the row into a form ────────────────────────────────────

describe("fieldsFrom", () => {
  it("puts every figure in its field as the row holds it", () => {
    const fields = fieldsFrom(PROPERTY);

    expect(fields.standardVatRateBps).toBe("1000");
    expect(fields.reducedVatRateBps).toBe("800");
    expect(fields.serviceChargeRateBps).toBe("500");
    expect(fields.businessDateRolloverHour).toBe("4");
    expect(fields.vatIncludesServiceCharge).toBe(true);
  });

  it("carries money as whole đồng and never as a number", () => {
    const fields = fieldsFrom(PROPERTY);

    expect(fields.loyaltyEarnUnitVnd).toBe("100000");
    expect(fields.tierSilverRevenueVnd).toBe("30000000");
    expect(fields.tierGoldRevenueVnd).toBe("80000000");
  });

  it("shows a set window end as bounded, with its date", () => {
    const fields = fieldsFrom(PROPERTY);

    expect(fields.reducedVatFromBound).toBe(true);
    expect(fields.reducedVatFrom).toBe("2025-07-01");
    expect(fields.reducedVatToBound).toBe(true);
    expect(fields.reducedVatTo).toBe("2026-12-31");
  });

  it("shows an unbounded end as unbounded rather than as an empty box", () => {
    const fields = fieldsFrom({ ...PROPERTY, reducedVatTo: null });

    expect(fields.reducedVatToBound).toBe(false);
    expect(fields.reducedVatTo).toBe("");
  });
});

// ── The heart of it: an edit names only what moved ───────────────────────────

describe("configEdit — what travels", () => {
  it("sends nothing at all from a form nobody has touched", () => {
    // The round trip that matters: the row fills the form, the form is diffed
    // back against the row, and the answer is that there is no edit. Anything
    // else here is a figure this screen would overwrite with a copy of itself.
    expect(attempt()).toEqual({ unchanged: true });
  });

  it("sends one field when one figure moved", () => {
    expect(sent({ standardVatRateBps: "1100" })).toEqual({
      standardVatRateBps: 1100,
    });
  });

  it("leaves a tax rate alone when the rollover hour is corrected", () => {
    // `updateSystemConfigInput` is a PATCH for exactly this: an administrator
    // fixing the operating clock must not restate a rate they were not asked
    // about.
    const body = sent({ businessDateRolloverHour: "5" });

    expect(body).toEqual({ businessDateRolloverHour: 5 });
    expect(body.standardVatRateBps).toBeUndefined();
    expect(body.reducedVatFrom).toBeUndefined();
  });

  it("sends the tax-base rule on its own when it is flipped", () => {
    expect(sent({ vatIncludesServiceCharge: false })).toEqual({
      vatIncludesServiceCharge: false,
    });
  });

  it("sends money as the decimal text the contract takes", () => {
    expect(sent({ loyaltyEarnUnitVnd: "150000" })).toEqual({
      loyaltyEarnUnitVnd: "150000",
    });
  });

  it("does not read a leading zero as an edit", () => {
    // Typed text differs and the amount does not. A body naming this field
    // would file a change-log row for a figure nobody moved.
    expect(attempt({ loyaltyEarnUnitVnd: "0100000" })).toEqual({
      unchanged: true,
    });
  });

  it("ignores the whitespace around a figure", () => {
    expect(attempt({ standardVatRateBps: " 1000 " })).toEqual({
      unchanged: true,
    });
    expect(attempt({ tierGoldRevenueVnd: " 80000000 " })).toEqual({
      unchanged: true,
    });
  });

  it("sends several figures when several moved, and names them", () => {
    const answered = attempt({
      standardVatRateBps: "1200",
      serviceChargeRateBps: "0",
      tierGoldStays: "10",
    });

    if (!("input" in answered)) {
      throw new Error("expected a body to send");
    }

    expect(answered.input).toEqual({
      standardVatRateBps: 1200,
      serviceChargeRateBps: 0,
      tierGoldStays: 10,
    });
    expect(answered.changed).toEqual([
      "the standard VAT rate",
      "the service-charge rate",
      "Gold's stay count",
    ]);
  });

  it("never builds the empty body the contract refuses on purpose", () => {
    // The contract's own refusal, asserted here so the reason this screen holds
    // its save button is visible beside the rule that forces it.
    expect(updateSystemConfigInput.safeParse({}).success).toBe(false);
    expect(attempt()).not.toHaveProperty("input");
  });
});

// ── The relief window: absent, null, and a date ──────────────────────────────

describe("configEdit — the relief window's two ends", () => {
  it("leaves an end where it stands when the date is not retyped", () => {
    expect(attempt({ reducedVatTo: "2026-12-31" })).toEqual({
      unchanged: true,
    });
  });

  it("sends an explicit null when an end is switched off", () => {
    // "Unbound it", which is a different instruction from "do not touch it" —
    // and the only way for the operator to give it.
    expect(sent({ reducedVatToBound: false })).toEqual({ reducedVatTo: null });
  });

  it("sends nothing when an end that was already unbounded stays off", () => {
    const openEnded = { ...PROPERTY, reducedVatTo: null };

    expect(configEdit(fieldsFrom(openEnded), openEnded, TODAY)).toEqual({
      unchanged: true,
    });
  });

  it("sends a date when an unbounded end is given one", () => {
    const openEnded = { ...PROPERTY, reducedVatTo: null };

    expect(
      configEdit(
        {
          ...fieldsFrom(openEnded),
          reducedVatToBound: true,
          reducedVatTo: "2027-06-30",
        },
        openEnded,
        TODAY,
      ),
    ).toEqual({
      input: { reducedVatTo: "2027-06-30" },
      changed: ["the relief period's end"],
    });
  });

  it("unbounds one end without touching the other", () => {
    const body = sent({ reducedVatFromBound: false });

    expect(body).toEqual({ reducedVatFrom: null });
    expect("reducedVatTo" in body).toBe(false);
  });

  it("reads a date the way every other date field in the console does", () => {
    expect(sent({ reducedVatTo: "30/6/2027" })).toEqual({
      reducedVatTo: "2027-06-30",
    });
    expect(resolvedWindowEnd("30/6/2027", TODAY)).toBe("2027-06-30");
  });

  it("refuses a blank date rather than reading it as an unbinding", () => {
    // The keystroke that would otherwise lapse a statutory relief period. The
    // switch is how an end is cleared, and clearing the text is not it.
    const said = refusal({ reducedVatTo: "" });

    expect(said).toContain("switched on");
    expect(said).toContain("switch it off");
  });

  it("refuses a date it cannot read", () => {
    expect(refusal({ reducedVatFrom: "sometime in July" })).toContain(
      "needs a date",
    );
    expect(refusal({ reducedVatFrom: "2026-02-31" })).toContain("needs a date");
  });

  it("refuses a window that closes before it opens, naming both ends", () => {
    const said = refusal({
      reducedVatFrom: "2026-07-01",
      reducedVatTo: "2026-06-30",
    });

    expect(said).toContain("2026-07-01");
    expect(said).toContain("2026-06-30");
    expect(said).toContain("covers no date");
  });

  it("catches a window the stored row is half of", () => {
    // Only the start was typed, and it landed after the stored end. This is the
    // pair `system-config.service.ts` says only a caller holding the row beside
    // the edit can see — and a screen that read the row to fill its fields is
    // one.
    expect(refusal({ reducedVatFrom: "2027-01-01" })).toContain(
      "covers no date",
    );
  });

  it("allows both ends on one day, which is a window covering that day", () => {
    expect(
      sent({ reducedVatFrom: "2026-09-01", reducedVatTo: "2026-09-01" }),
    ).toEqual({
      reducedVatFrom: "2026-09-01",
      reducedVatTo: "2026-09-01",
    });
  });

  it("says nothing about order when one side is unbounded", () => {
    expect(
      sent({ reducedVatFromBound: false, reducedVatTo: "2020-01-01" }),
    ).toEqual({
      reducedVatFrom: null,
      reducedVatTo: "2020-01-01",
    });
  });
});

// ── The refusals: the contract's own bounds, then the ladder ─────────────────

describe("configEdit — refusals the operator can act on", () => {
  it("answers a figure that is not whole basis points in the field's own unit", () => {
    const said = refusal({ standardVatRateBps: "10.5" });

    expect(said).toContain("basis points");
    expect(said).toContain("800 for 8%");
  });

  it("refuses a rate above 100%, naming the figure", () => {
    expect(refusal({ standardVatRateBps: "10001" })).toContain(
      "the standard VAT rate",
    );
  });

  it("refuses an hour that is not an hour of a day", () => {
    expect(refusal({ businessDateRolloverHour: "24" })).toContain(
      "the rollover hour",
    );
    expect(refusal({ businessDateRolloverHour: "-1" })).toContain(
      "hour of the property's own day",
    );
  });

  it("refuses an earn unit of nothing", () => {
    // A divisor of zero. The contract's own words, which name the unit.
    expect(refusal({ loyaltyEarnUnitVnd: "0" })).toContain("the earn unit");
  });

  it("refuses an amount that is not a whole number of đồng", () => {
    expect(refusal({ tierSilverRevenueVnd: "30 triệu" })).toContain(
      "Silver's revenue threshold",
    );
  });

  it("refuses a rung at zero stays", () => {
    expect(refusal({ tierSilverStays: "0" })).toContain("Silver's stay count");
  });

  it("refuses a Gold rung below the Silver one it was not shown beside", () => {
    // Only Gold was typed. The comparison is against the stored Silver figure,
    // which is why this refusal can be given here at all.
    const said = refusal({ tierGoldStays: "2" });

    expect(said).toContain("Gold at 2 stays");
    expect(said).toContain("Silver at 3");
    expect(said).toContain("stop being reachable");
  });

  it("refuses a Silver rung raised above the stored Gold one", () => {
    expect(refusal({ tierSilverStays: "12" })).toContain(
      "stop being reachable",
    );
  });

  it("allows equal rungs, because each axis is compared with its own", () => {
    expect(sent({ tierGoldStays: "3" })).toEqual({ tierGoldStays: 3 });
  });

  it("refuses a Gold revenue threshold below Silver's", () => {
    const said = refusal({ tierGoldRevenueVnd: "10000000" });

    expect(said).toContain("Gold at");
    expect(said).toContain("Set Gold's revenue threshold on or above Silver's");
  });

  it("compares the money axis only against the money axis", () => {
    // Gold reachable at fewer stays than Silver's revenue figure implies is not
    // a collapse: a rung is reached by stays *or* by revenue, and a property may
    // raise one bar while leaving the other.
    expect(
      sent({ tierGoldStays: "4", tierGoldRevenueVnd: "30000000" }),
    ).toEqual({
      tierGoldStays: 4,
      tierGoldRevenueVnd: "30000000",
    });
  });
});

// ── Rendering a figure without becoming its storage model ────────────────────

describe("rateLabel", () => {
  it("reads basis points as a percentage, on integers throughout", () => {
    expect(rateLabel("1000")).toBe("10.00%");
    expect(rateLabel("800")).toBe("8.00%");
    expect(rateLabel("150")).toBe("1.50%");
    expect(rateLabel("5")).toBe("0.05%");
    expect(rateLabel("0")).toBe("0.00%");
    expect(rateLabel("10000")).toBe("100.00%");
  });

  it("says nothing about a field that does not hold a figure yet", () => {
    expect(rateLabel("")).toBeNull();
    expect(rateLabel("8.5")).toBeNull();
    expect(rateLabel("eight")).toBeNull();
  });
});

describe("rolloverLabel", () => {
  it("reads the hour as the clock reads it", () => {
    expect(rolloverLabel("4")).toBe("04:00");
    expect(rolloverLabel("0")).toBe("00:00");
    expect(rolloverLabel("23")).toBe("23:00");
  });

  it("says nothing about an hour no day has", () => {
    expect(rolloverLabel("24")).toBeNull();
    expect(rolloverLabel("")).toBeNull();
  });
});

describe("dongLabel", () => {
  it("reads a typed amount as the property writes money", () => {
    expect(dongLabel("100000")).toContain("100.000");
    expect(dongLabel(" 1250000 ")).toContain("1.250.000");
  });

  it("says nothing about text that is not an amount", () => {
    expect(dongLabel("")).toBeNull();
    expect(dongLabel("1.250.000")).toBeNull();
    expect(dongLabel("-5")).toBeNull();
  });
});

describe("configFingerprint — the row the form was seeded from", () => {
  it("is the same string for a read that answered with the same row", () => {
    // The ordinary refetch. `lib/query-client.ts` re-asks on window focus and a
    // console left open on a desk asks often, so the common case must leave a
    // half-typed edit exactly where the operator left it.
    expect(configFingerprint({ ...PROPERTY })).toBe(
      configFingerprint(PROPERTY),
    );
  });

  it("changes when any one of the thirteen figures moves", () => {
    const moved: Partial<SystemConfiguration>[] = [
      { standardVatRateBps: 1200 },
      { reducedVatRateBps: 500 },
      { reducedVatFrom: "2025-08-01" },
      { reducedVatTo: "2027-01-31" },
      { vatIncludesServiceCharge: false },
      { serviceChargeRateBps: 700 },
      { businessDateRolloverHour: 6 },
      { loyaltyPointsPerUnit: 2 },
      { loyaltyEarnUnitVnd: 200_000n },
      { tierSilverStays: 4 },
      { tierSilverRevenueVnd: 35_000_000n },
      { tierGoldStays: 9 },
      { tierGoldRevenueVnd: 90_000_000n },
    ];

    for (const one of moved) {
      expect(configFingerprint({ ...PROPERTY, ...one })).not.toBe(
        configFingerprint(PROPERTY),
      );
    }
  });

  it("tells an unbounded end from an end that happens to be empty", () => {
    // The two states the form draws differently, and the one pair that would
    // collapse if the row were read as text rather than through `fieldsFrom`.
    expect(configFingerprint({ ...PROPERTY, reducedVatTo: null })).not.toBe(
      configFingerprint(PROPERTY),
    );
  });

  it("survives money, which is bigint and which JSON refuses on its own", () => {
    expect(() => configFingerprint(PROPERTY)).not.toThrow();
    expect(configFingerprint(PROPERTY)).toContain("100000");
  });
});

describe("the edit a form that was never reseeded would send", () => {
  it("re-sends a figure this operator never touched, which is why the screen keys on the row", () => {
    // Another administrator raises the standard rate while this form sits open.
    // The form still holds the figures it was seeded with; only the refetched
    // row moved.
    const stale = fieldsFrom(PROPERTY);
    const fresh: SystemConfiguration = {
      ...PROPERTY,
      standardVatRateBps: 1200,
    };

    // This operator corrects the rollover hour and nothing else.
    const answered = configEdit(
      { ...stale, businessDateRolloverHour: "6" },
      fresh,
      TODAY,
    );

    if (!("input" in answered)) {
      throw new Error("expected a body to send");
    }

    // The rate goes back down to what this form was seeded with — the other
    // administrator's change, reverted by somebody who never typed into that
    // field. `configFingerprint` is what stops the pair reaching this state:
    // the row moved, so the form is remounted and seeded again from it.
    expect(answered.input.standardVatRateBps).toBe(1000);
    expect(configFingerprint(fresh)).not.toBe(configFingerprint(PROPERTY));
  });
});
