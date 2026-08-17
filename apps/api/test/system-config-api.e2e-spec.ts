// The system-configuration API, end to end — `FR-IDN-03`'s "editable by ADMIN
// without a deploy", over HTTP against a real Postgres and the real capability
// guard.
//
// `system-config.e2e-spec.ts` already asserts what the row does once it holds
// values: which of the two VAT rates a date resolves to on either side of the
// relief window, and that a value changed under a transaction is read by the
// next statement. None of that needs a route. What only exists once there are
// routes is what this file is for:
//
//  1. **Both routes are governed by the matrix row they declare**, driven off
//     `CAPABILITIES` rather than off a list written out here. The row gives
//     `MANAGER` 👁 and `ADMIN` ✅, so the read and the write are read out of one
//     row with two different actions — a manager who can open the screen and
//     cannot change a tax rate is the whole point of the row being split that
//     way, and a table that assumed "write" for both would assert the wrong
//     expectation for the read.
//  2. **An edit is read by the next request, with nothing restarted.** The
//     claim `FR-IDN-03` makes is about a deploy, so it is asserted the way it
//     will be met, twice over and against the two consumers that matter. The
//     rate is changed over HTTP and the very next call to the service a folio
//     posting splits a gross figure with returns the new one. The rollover hour
//     is changed the same way, and one fixed instant then belongs to a
//     different business date than it did a moment earlier — §2's "changes one
//     row, not a deploy", as an assertion. No process is stopped in between and
//     there is nothing to invalidate.
//  3. **A figure the configuration cannot hold is refused, not stored.** Each
//     refusal is followed by a read of the row, because a 400 that wrote
//     anyway is the failure mode worth catching — and the window's own
//     invariant is asserted through a `PATCH` that names one end, which is the
//     case only the server can see.
//  4. **A change leaves a row in the log, and a refused change leaves none.**
//     `schema/audit.ts` says these figures declined an `updated_by` column of
//     their own on the promise that the change log would serve them, so this is
//     the only attribution a tax rate change ever gets. What is asserted is the
//     account the guard resolved, the address the log gives a table with no
//     surrogate key, and both sides of the change — and then that a 400 leaves
//     the log exactly as it found it, because an entry describing a rate the
//     property never charged is worse than no entry at all.
//  5. **The answer carries the seven figures and nothing else.** The key set is
//     asserted exactly. `schema/config.ts` keeps gateway credentials in the
//     environment on the grounds that a secret in a table an `ADMIN` screen
//     reads has a wider audience than the process that spends it; an exact key
//     set is what turns that decision into something a test can defend, because
//     a column added to the table later cannot join the response silently.
//
// The figures used here are deliberately unreal — a 43.21% VAT rate, a day
// rolling at 09:00, a relief window in 2077. `property-and-tariff.md` §8 forbids
// the tree from carrying a rate, and a fixture that read like a plausible one
// would be the same defect wearing a test's clothes.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { auditEntry } from "../src/database/schema/audit.js";
import {
  systemConfig,
  type SystemConfigRow,
} from "../src/database/schema/config.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import {
  staffGrant,
  STAFF_ROLES,
  type CapabilityKey,
  type StaffRole,
} from "../src/modules/identity/rbac/matrix.js";
import {
  permits,
  type CapabilityAction,
} from "../src/modules/identity/rbac/roles.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";
import { SystemConfigSeeder } from "../src/modules/system-config/system-config.seeder.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

const ROUTE = "/system/config";

/**
 * Every figure the answer may carry — `FR-IDN-03`'s, and §7's loyalty figures,
 * as a list.
 *
 * The two halves are on one resource for opposite reasons: the tax figures
 * because nobody here may answer them, the loyalty figures because §7 says the
 * developer proposes them and the property tunes them. What they share is the
 * row, and a screen that reads it whole.
 */
const CONFIGURATION_FIELDS = [
  "standardVatRateBps",
  "reducedVatRateBps",
  "reducedVatFrom",
  "reducedVatTo",
  "vatIncludesServiceCharge",
  "serviceChargeRateBps",
  "businessDateRolloverHour",
  "loyaltyPointsPerUnit",
  "loyaltyEarnUnitVnd",
  "tierSilverStays",
  "tierSilverRevenueVnd",
  "tierGoldStays",
  "tierGoldRevenueVnd",
  "pointsExpireYearEnd",
] as const;

/** Figures nobody could mistake for a property's real ones. */
const EDITED_RATE_BPS = 4_321;
const EDITED_REDUCED_RATE_BPS = 2_109;
const EDITED_SERVICE_CHARGE_BPS = 765;

/**
 * One moment, and the two rollover hours that put it on either side of a
 * business date.
 *
 * 06:30 in the property's own zone. A day that turns at 05:00 has already
 * turned by then, so the moment belongs to its own calendar date; a day that
 * turns at 09:00 has not, so the property is still working the one before. Both
 * hours are deliberately not §2's 04:00 — a fixture that read like the
 * property's own would be a constant this feature exists to abolish.
 */
const AN_INSTANT = new Date("2077-05-05T06:30:00+07:00");
const BEFORE_THE_INSTANT = 5;
const AFTER_THE_INSTANT = 9;
const THE_DAY_IT_LANDS_ON = "2077-05-05";
const THE_DAY_BEFORE_IT = "2077-05-04";

/**
 * A loyalty program an `ADMIN` tunes to, differing from §7's proposal in every
 * figure so that no assertion can pass on a value the column supplied.
 */
const EDITED_POINTS_PER_UNIT = 7;
const EDITED_EARN_UNIT_VND = 33_000n;
const EDITED_GOLD_STAYS = 13;

/** A Gold rung below the Silver one, which would leave Silver unreachable. */
const GOLD_BELOW_SILVER_STAYS = 1;

/** 10000 basis points is 100%, so this is one past the last real answer. */
const IMPOSSIBLE_RATE_BPS = 10_001;

/** 24 is the value somebody means as midnight and writes as a count. */
const IMPOSSIBLE_HOUR = 24;

/** A relief period, and a date well past the end of it. */
const WINDOW_OPENS = "2077-03-01";
const WINDOW_CLOSES = "2077-09-30";
const AFTER_IT_CLOSES = "2077-12-01";

/** Any date at all, for the posting-time read that is not about the window. */
const SOME_DATE = parseDate("2077-05-05");

const GUEST_EMAIL = "khach@example.test";
const GUEST_PASSWORD = "correct-horse-battery";

interface StaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

/** One account per staff role, because the matrix is asserted against all five. */
const STAFF = {
  MANAGER: {
    email: "quan.ly@mariva.test",
    fullName: "Nguyễn Thị Hạnh",
    role: "MANAGER",
    password: "manager-password-42",
  },
  RECEPTIONIST: {
    email: "le.tan@mariva.test",
    fullName: "Phạm Văn Dũng",
    role: "RECEPTIONIST",
    password: "reception-password-42",
  },
  HOUSEKEEPING: {
    email: "buong.phong@mariva.test",
    fullName: "Lê Thị Thu",
    role: "HOUSEKEEPING",
    password: "housekeeping-password-42",
  },
  ACCOUNTANT: {
    email: "ke.toan@mariva.test",
    fullName: "Vũ Minh Khoa",
    role: "ACCOUNTANT",
    password: "accountant-password-42",
  },
  ADMIN: {
    email: "quan.tri@mariva.test",
    fullName: "Hoàng Anh Tuấn",
    role: "ADMIN",
    password: "admin-password-42",
  },
} as const satisfies Record<StaffRole, StaffAccount>;

/**
 * Both routes, with the matrix row they declare and what each does with it.
 *
 * `action` is data rather than an assumption. One row governs the pair, and the
 * only thing that tells the manager's 👁 apart from the admin's ✅ is which
 * action the route declares — so a table that hard-coded "write" would assert
 * that a manager cannot open a screen the document says they can.
 */
const ROUTES: readonly {
  readonly name: string;
  readonly method: "get" | "patch";
  readonly capability: CapabilityKey;
  readonly action: CapabilityAction;
}[] = [
  {
    name: "read",
    method: "get",
    capability: "system.config",
    action: "read",
  },
  {
    name: "update",
    method: "patch",
    capability: "system.config",
    action: "write",
  },
];

/**
 * Captures what would have been sent, so the guest realm's verification link
 * can be followed here the way a guest follows it in an inbox.
 *
 * The guest realm is only needed for one claim — that a real session in the
 * wrong realm is refused — and a session cannot be had without finishing the
 * sign-up it gates.
 */
class RecordingMailer {
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }

  linkTo(address: string): string {
    const email = [...this.sent].reverse().find((sent) => sent.to === address);

    if (!email) {
      throw new Error(`No email was sent to ${address}`);
    }

    const link = /https?:\/\/\S+/.exec(email.text)?.[0];

    if (!link) {
      throw new Error(`No link in the email to ${address}`);
    }

    return link;
  }
}

let app: INestApplication;
let db: Database;
let seeder: SystemConfigSeeder;
let posting: SystemConfigService;
let day: BusinessDateService;
let http: () => request.Agent;
let guest: request.Agent;
let adminId: string;
const tokens = new Map<StaffRole, string>();

beforeAll(async () => {
  const mailer = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);
  seeder = app.get(SystemConfigSeeder);

  // The very instances a folio posting reads the rates through and every
  // business date in the application comes from, taken from the running
  // container rather than constructed here. A second instance would prove
  // nothing about the one that serves a charge.
  posting = app.get(SystemConfigService);
  day = app.get(BusinessDateService);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // The accounts below are created by email and the column is unique, so the
  // five have to be the only five — no suite owns these tables, and each leaves
  // whatever it last signed in with.
  await db.execute(
    sql`truncate staff_user, staff_session restart identity cascade`,
  );
  await db.execute(
    sql`truncate guest_user, guest_session, guest_account, guest_verification restart identity cascade`,
  );

  await fromTheEnvironment();

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    const created = await staff.create({ ...account });

    // Kept for the admin alone: the change log names an account id, and the
    // claim worth asserting is that it is the one the guard resolved from the
    // token rather than anything the request carried.
    if (account.role === "ADMIN") {
      adminId = created.id;
    }

    tokens.set(account.role, await signIn(account.email, account.password));
  }

  guest = await aVerifiedGuest(mailer);
}, 120_000);

afterAll(async () => {
  // The figures the environment supplies, put back. Every case here edits the
  // one row every other suite in this run reads, and a rate of 43.21% left
  // behind would surface in whichever file happens to post next.
  await fromTheEnvironment();
  await app?.close();
});

/**
 * The row as a boot would leave it.
 *
 * Through the seeder rather than through an insert written out here, so the
 * starting state is the environment's own figures and this file states none of
 * them. The seeder writes only when the row is absent, which is why it is
 * emptied first.
 */
async function fromTheEnvironment(): Promise<void> {
  await db.execute(sql`truncate system_config`);
  await seeder.onApplicationBootstrap();
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

/** A guest who has finished the sign-up their realm gates a session behind. */
async function aVerifiedGuest(mailer: RecordingMailer): Promise<request.Agent> {
  await http()
    .post("/api/auth/sign-up/email")
    .send({ name: "Anh Nguyễn", email: GUEST_EMAIL, password: GUEST_PASSWORD })
    .expect(200);

  const link = new URL(mailer.linkTo(GUEST_EMAIL));

  await http().get(`${link.pathname}${link.search}`).expect(302);

  const signedIn = request.agent(app.getHttpServer());

  await signedIn
    .post("/api/auth/sign-in/email")
    .send({ email: GUEST_EMAIL, password: GUEST_PASSWORD })
    .expect(200);

  return signedIn;
}

/** A call as one member of staff. A `GET` carries nothing but its session. */
function as(
  role: StaffRole,
  method: "get" | "patch",
  body: object = {},
): request.Test {
  const call = http()
    [method](ROUTE)
    .set("Authorization", `Bearer ${tokens.get(role)!}`);

  return method === "get" ? call : call.send(body);
}

/** The configuration as the read route answers it, to an admitted caller. */
async function read(role: StaffRole = "ADMIN") {
  return (await as(role, "get").expect(200)).body;
}

/** An edit an `ADMIN` makes, whatever the server makes of it. */
function edit(body: object): request.Test {
  return as("ADMIN", "patch", body);
}

/** The row itself, as against the answer a route gave for it. */
async function stored(): Promise<SystemConfigRow> {
  const [row] = await db.select().from(systemConfig);

  if (!row) {
    throw new Error("the system configuration is missing");
  }

  return row;
}

describe("the capability each system-configuration route declares", () => {
  // §4's obligation for the row M6 puts routes behind. Every role is put to
  // every route and the expectation is read off the matrix, so a declaration
  // changed without the document moving fails here. The write is sent no body:
  // the guard runs before the handler, so an admitted caller answers 400 and a
  // refused one answers 403 either way, and no figure changes while the matrix
  // is being asserted.
  for (const route of ROUTES) {
    for (const role of STAFF_ROLES) {
      const admitted = permits(staffGrant(route.capability, role), route.action);

      it(`${admitted ? "admits" : "refuses"} ${role} on ${route.name}`, async () => {
        const response = await as(role, route.method);

        if (admitted) {
          expect(response.status).not.toBe(403);
        } else {
          expect(response.status).toBe(403);
        }
      });
    }
  }

  it("lets a manager look without letting them change a rate", async () => {
    // The same two expectations the loop above derives, stated once in the
    // words the matrix uses — a 👁 that answered 403 and a 👁 that accepted a
    // tax rate would both pass a test that only counted refusals.
    await as("MANAGER", "get").expect(200);
    await as("MANAGER", "patch", {
      standardVatRateBps: EDITED_RATE_BPS,
    }).expect(403);

    expect((await stored()).standardVatRateBps).not.toBe(EDITED_RATE_BPS);
  });

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong role is refused.
    for (const route of ROUTES) {
      await http()[route.method](ROUTE).send().expect(401);
    }
  });

  it("refuses a real session from the guest realm", async () => {
    // The session is real and verified. The realm is wrong — `rbac-matrix.md`
    // §1 — so this is 403 rather than 401: the caller is somebody, and this row
    // is not for them.
    await guest.get(ROUTE).expect(403);
    await guest
      .patch(ROUTE)
      .send({ standardVatRateBps: EDITED_RATE_BPS })
      .expect(403);
  });
});

describe("the configuration as the read route answers it", () => {
  it("carries every figure a posting or an accrual reads, and the row's own values", async () => {
    const configured = await stored();

    expect(await read()).toEqual({
      standardVatRateBps: configured.standardVatRateBps,
      reducedVatRateBps: configured.reducedVatRateBps,
      reducedVatFrom: configured.reducedVatFrom,
      reducedVatTo: configured.reducedVatTo,
      vatIncludesServiceCharge: configured.vatIncludesServiceCharge,
      serviceChargeRateBps: configured.serviceChargeRateBps,
      businessDateRolloverHour: configured.businessDateRolloverHour,
      loyaltyPointsPerUnit: configured.loyaltyPointsPerUnit,
      // Đồng cross as decimal text and never as a JSON number, which is
      // `money.ts`'s rule rather than this route's: a total in đồng need not fit
      // a double, and a number that silently loses its last digits is worse
      // than one that never arrives.
      loyaltyEarnUnitVnd: configured.loyaltyEarnUnitVnd.toString(),
      tierSilverStays: configured.tierSilverStays,
      tierSilverRevenueVnd: configured.tierSilverRevenueVnd.toString(),
      tierGoldStays: configured.tierGoldStays,
      tierGoldRevenueVnd: configured.tierGoldRevenueVnd.toString(),
      pointsExpireYearEnd: configured.pointsExpireYearEnd,
    });
  });

  it("carries the thresholds a tier is derived from, and no tier", async () => {
    // `FR-GST-04` derives the tier on read from a trailing window, so there is
    // none in the row and none on the wire. A field here would be the one place
    // a screen could show a guest a tier that stopped being true when the
    // window moved.
    const answered = Object.keys(await read()).join(" ").toLowerCase();

    expect(answered).toContain("tiersilverstays");
    expect(answered).not.toContain("currenttier");
    expect(answered).not.toContain("loyaltytier");
  });

  it("carries nothing else, including nothing a secret could travel in", async () => {
    // Asserted as the whole key set rather than as a handful of expectations,
    // because what matters here is the absence of fields. `schema/config.ts`
    // keeps gateway credentials in the environment and this table holds none,
    // so there is no secret to mask — and an exact list is what makes that stay
    // true when somebody adds a column.
    expect(Object.keys(await read()).sort()).toEqual(
      [...CONFIGURATION_FIELDS].sort(),
    );

    // The primary key is a boolean pinning the table to one row. It is not a
    // setting, and a screen offered it as one would render a checkbox nobody
    // can explain.
    expect(await read()).not.toHaveProperty("isTheConfiguration");
  });

  it("answers a manager exactly what it answers an admin", async () => {
    expect(await read("MANAGER")).toEqual(await read("ADMIN"));
  });
});

describe("a figure an admin changes", () => {
  it("takes effect on the next posting, with nothing restarted", async () => {
    // `FR-IDN-03`'s claim, asserted the way it will be met. The window is
    // cleared first, so every date resolves to the standard rate and this case
    // is about the edit rather than about the relief period.
    await edit({
      reducedVatFrom: null,
      reducedVatTo: null,
      standardVatRateBps: EDITED_RATE_BPS,
    }).expect(200);

    // The service a folio posting reads through, called immediately after the
    // request that changed the row returned. Nothing was stopped, nothing was
    // invalidated, and there is nowhere in the path for the old rate to have
    // been kept.
    expect(await posting.taxRules(db, SOME_DATE)).toMatchObject({
      vatRateBps: EDITED_RATE_BPS,
    });
  });

  it("moves which rate a date resolves to by moving the window under it", async () => {
    // The route's half of the resolution rule. Neither rate changes here; the
    // relief period does, and the same business date answers with the other
    // rate — which is the edit an `ADMIN` will actually make when a resolution
    // extends or ends the relief.
    await edit({
      standardVatRateBps: EDITED_RATE_BPS,
      reducedVatRateBps: EDITED_REDUCED_RATE_BPS,
      reducedVatFrom: WINDOW_OPENS,
      reducedVatTo: WINDOW_CLOSES,
    }).expect(200);

    expect(await posting.taxRules(db, SOME_DATE)).toMatchObject({
      vatRateBps: EDITED_REDUCED_RATE_BPS,
    });

    // The relief closes before that date. Nothing is refused — the rate simply
    // reverts, which is the whole reason both rates are configured.
    await edit({ reducedVatTo: WINDOW_OPENS }).expect(200);

    expect(await posting.taxRules(db, SOME_DATE)).toMatchObject({
      vatRateBps: EDITED_RATE_BPS,
    });
  });

  it("moves what day the property thinks it is, on the next request", async () => {
    // §2's "a property that runs its audit at 06:00 changes one row, not a
    // deploy", asserted against the service every business date in the
    // application comes through. One instant, asked about twice: at 06:30 in
    // the property's own zone, a day rolling at 05:00 has already turned and a
    // day rolling at 09:00 has not, so the same moment belongs to two different
    // business dates and the only thing that changed between the two answers is
    // the row this route wrote.
    await edit({ businessDateRolloverHour: BEFORE_THE_INSTANT }).expect(200);

    expect((await day.current(db, AN_INSTANT)).toString()).toBe(
      THE_DAY_IT_LANDS_ON,
    );

    await edit({ businessDateRolloverHour: AFTER_THE_INSTANT }).expect(200);

    expect((await day.current(db, AN_INSTANT)).toString()).toBe(
      THE_DAY_BEFORE_IT,
    );
  });

  it("leaves every figure the edit did not name exactly where it was", async () => {
    const before = await read();

    const response = await edit({
      serviceChargeRateBps: EDITED_SERVICE_CHARGE_BPS,
    }).expect(200);

    // The whole configuration comes back, not the field that moved: the caller
    // is a screen that must now show the six figures a posting will read.
    expect(response.body).toEqual({
      ...before,
      serviceChargeRateBps: EDITED_SERVICE_CHARGE_BPS,
    });
  });

  it("opens a relief window, and unbounds an end when it is cleared", async () => {
    await edit({
      reducedVatFrom: WINDOW_OPENS,
      reducedVatTo: WINDOW_CLOSES,
    }).expect(200);

    expect(await read()).toMatchObject({
      reducedVatFrom: WINDOW_OPENS,
      reducedVatTo: WINDOW_CLOSES,
    });

    // Null is unbounded and undefined is untouched, which is the difference
    // between "the relief has no end yet" and "do not move the end I set".
    const cleared = await edit({ reducedVatTo: null }).expect(200);

    expect(cleared.body).toMatchObject({
      reducedVatFrom: WINDOW_OPENS,
      reducedVatTo: null,
    });
  });
});

describe("a loyalty figure an admin changes", () => {
  it("is read by the next accrual, with nothing restarted", async () => {
    // §7's claim about its own values — tuning one is a data edit and not a
    // deploy — asserted against the service an accrual reads through, called
    // straight after the request that changed the row returned. Đồng go up as
    // decimal text, which is what `money.ts` puts on the wire in both
    // directions.
    await edit({
      loyaltyPointsPerUnit: EDITED_POINTS_PER_UNIT,
      loyaltyEarnUnitVnd: EDITED_EARN_UNIT_VND.toString(),
    }).expect(200);

    expect(await posting.loyaltyRules(db)).toMatchObject({
      pointsPerUnit: EDITED_POINTS_PER_UNIT,
      earnUnitVnd: EDITED_EARN_UNIT_VND,
    });
  });

  it("moves the rung a tier is derived at, without storing a tier", async () => {
    await edit({ tierGoldStays: EDITED_GOLD_STAYS }).expect(200);

    expect(await posting.tierThresholds(db)).toMatchObject({
      goldStays: EDITED_GOLD_STAYS,
    });
  });

  it("turns the expiry rule off and answers with it off", async () => {
    const response = await edit({ pointsExpireYearEnd: false }).expect(200);

    expect(response.body.pointsExpireYearEnd).toBe(false);
    expect((await posting.loyaltyRules(db)).pointsExpireAtYearEnd).toBe(false);

    await edit({ pointsExpireYearEnd: true }).expect(200);
  });

  it("is refused to a manager, who may read the program and not tune it", async () => {
    // The matrix row is one row for the whole configuration, so this is the
    // same 👁 that guards a tax rate — asserted here as well, because "the
    // manager cannot change a rate" and "the manager cannot change what a stay
    // earns" are the same guard and would be the same omission.
    const before = await stored();

    await as("MANAGER", "patch", {
      loyaltyPointsPerUnit: EDITED_POINTS_PER_UNIT,
    }).expect(403);

    expect((await stored()).loyaltyPointsPerUnit).toBe(
      before.loyaltyPointsPerUnit,
    );
  });
});

describe("a figure the configuration will not hold", () => {
  it("refuses a rate above a hundred percent", async () => {
    // Both rates, because the ceiling is a property of the field and not of
    // which of the two it happens to be — a bound mirrored onto one column and
    // forgotten on the other is exactly the kind of gap a rename leaves behind.
    await refuses({ standardVatRateBps: IMPOSSIBLE_RATE_BPS });
    await refuses({ reducedVatRateBps: IMPOSSIBLE_RATE_BPS });
  });

  it("refuses a rate that is not whole basis points", async () => {
    // A rate carried as 8.5% rather than as 850 is `NFR-12`'s float arriving at
    // the rate instead of at the amount, and the column is a `smallint`.
    await refuses({ standardVatRateBps: 8.5 });
  });

  it("refuses a negative rate, which would credit tax back on every line", async () => {
    await refuses({ serviceChargeRateBps: -1 });
  });

  it("refuses an hour no day has", async () => {
    await refuses({ businessDateRolloverHour: IMPOSSIBLE_HOUR });
  });

  it("refuses a date that does not exist", async () => {
    // The shape check alone accepts the thirtieth of February and a date
    // library would roll it forward into March, which is a relief period
    // starting on a day the operator did not choose.
    await refuses({ reducedVatFrom: "2077-02-30" });
  });

  it("refuses an edit that names nothing", async () => {
    // Unknown keys are stripped before the body is validated, so an empty edit
    // is usually a misspelled field. Accepted, it is an admin who believes they
    // changed a tax rate and did not.
    await refuses({});
  });

  it("refuses an earn rate that would award nothing or divide by nothing", async () => {
    // Both halves, because the failure differs at each: no points is a program
    // that runs and awards nothing, and no unit is a division by zero at the
    // close of a stay that has already happened.
    await refuses({ loyaltyPointsPerUnit: 0 });
    await refuses({ loyaltyEarnUnitVnd: "0" });
  });

  it("refuses an amount of đồng that is not whole", async () => {
    // Money crosses as decimal text, so this is the shape check rather than a
    // rounding rule — VND has no minor unit and nothing here would know what to
    // do with a half.
    await refuses({ tierSilverRevenueVnd: "15000000.5" });
  });

  it("refuses a tier rung the stored one would leave below its neighbour", async () => {
    // The tier ladder's version of the window case: the edit names Gold and only
    // the row says what Silver is, so this is refusable nowhere but the server.
    // A collapsed ladder does not fail on its own — Silver simply stops being
    // reachable while the configuration still reads like three levels.
    await edit({ tierSilverStays: 2, tierGoldStays: 4 }).expect(200);

    const refusal = await refuses({ tierGoldStays: GOLD_BELOW_SILVER_STAYS });

    // Both figures named, because the person reading it typed one of them and
    // cannot see the other.
    expect(refusal.body.message).toContain(String(GOLD_BELOW_SILVER_STAYS));
    expect(refusal.body.message).toContain("Silver");
  });

  it("refuses a window that the stored end would leave closing before it opens", async () => {
    // The case neither the wire schema nor a single column can see: the edit
    // names one end, and only the row it lands on says what pair that makes.
    await edit({
      reducedVatFrom: WINDOW_OPENS,
      reducedVatTo: WINDOW_CLOSES,
    }).expect(200);

    const refusal = await refuses({ reducedVatFrom: AFTER_IT_CLOSES });

    // Named in full, because the person reading it typed one of these two dates
    // and cannot see the other.
    expect(refusal.body.message).toContain(AFTER_IT_CLOSES);
    expect(refusal.body.message).toContain(WINDOW_CLOSES);
  });
});

/**
 * An edit the server must refuse, and a row it must leave alone.
 *
 * The second half is the point. A 400 that wrote anyway is the failure worth
 * catching here, and it is invisible in the response.
 */
async function refuses(body: object): Promise<request.Response> {
  const before = await stored();
  const refusal = await edit(body).expect(400);

  expect(await stored()).toEqual(before);

  return refusal;
}

describe("the change log a configuration edit leaves", () => {
  it("names the admin, the row, and both sides of the change", async () => {
    // These figures carry no `updated_by` of their own — `schema/audit.ts`
    // records that they declined one on the promise that this table would serve
    // them — so this row is the only account a configuration change is ever
    // attributed to.
    await db.delete(auditEntry);

    const before = (await read()).standardVatRateBps;

    await edit({ standardVatRateBps: EDITED_RATE_BPS }).expect(200);

    const [entry, ...rest] = await configurationEntries();

    // One row for one edit. Seven columns changed in one statement is one
    // change, not seven.
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      // Taken from the session the guard resolved, never from the body.
      actorId: adminId,
      tableName: "system_config",
      action: "UPDATE",
    });

    // The address the log gives a table that has no surrogate key, recomputed
    // here in SQL rather than copied. A constant written into both the writer
    // and this assertion would agree with itself while disagreeing with the
    // rule anything else derives the value from.
    expect(entry!.rowId).toBe(await theConfigurationsAddress());

    // Whole rows, as Postgres rendered them — so the figure that moved is
    // legible on both sides and the six that did not are there too. Which of the
    // two VAT rates changed is legible for the same reason: the columns are
    // named, so a later reader can tell a standard-rate correction from a
    // relief-rate one without knowing what the window was that day.
    expect(entry!.before).toMatchObject({ standard_vat_rate_bps: before });
    expect(entry!.after).toMatchObject({
      standard_vat_rate_bps: EDITED_RATE_BPS,
    });
  });

  it("files nothing for an edit it refused", async () => {
    // The entry and the change are one commit, so a rolled-back edit takes its
    // log row with it. A row left behind here would describe a rate the
    // property never charged, and nothing downstream could tell it from one it
    // did.
    await db.delete(auditEntry);

    await edit({
      reducedVatFrom: WINDOW_OPENS,
      reducedVatTo: WINDOW_CLOSES,
    }).expect(200);

    const afterTheLegalEdit = await configurationEntries();

    await refuses({ reducedVatFrom: AFTER_IT_CLOSES });

    expect(await configurationEntries()).toEqual(afterTheLegalEdit);
  });
});

/** Every change filed against the configuration, oldest first. */
async function configurationEntries() {
  return await db
    .select({
      actorId: auditEntry.actorId,
      tableName: auditEntry.tableName,
      rowId: auditEntry.rowId,
      action: auditEntry.action,
      before: auditEntry.before,
      after: auditEntry.after,
    })
    .from(auditEntry)
    .where(eq(auditEntry.tableName, "system_config"))
    .orderBy(asc(auditEntry.occurredAt));
}

/**
 * The uuid the log addresses this row by, from the database itself.
 *
 * `audit_entry.row_id` is a uuid because every many-rowed table addresses its
 * rows by one. This table pinned its primary key to a boolean so a second row
 * could not exist, so its address is its name — and the name in that shape is
 * what both the writer and this line compute.
 */
async function theConfigurationsAddress(): Promise<string> {
  const { rows } = await db.execute<{ address: string }>(
    sql`select md5('system_config')::uuid as address`,
  );

  return rows[0]!.address;
}
