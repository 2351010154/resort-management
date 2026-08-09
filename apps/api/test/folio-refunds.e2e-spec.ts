// The two refund routes, end to end — `FR-PAY-04` over HTTP, against a real
// Postgres and the real capability guard.
//
// `folio-refund-service.e2e-spec.ts` proves the arithmetic: which row of §4's
// grid a stay falls under, what each row charges over the nights the booking
// froze, and what is handed back once that charge stands. None of that needs a
// route. What only exists once there are routes is what this file asserts:
//
// 1. **Two capabilities, two declarations, and the split is real.**
//    `rbac-matrix.md` §2 forbids "one endpoint with an amount check", so the
//    claim under test is that a receptionist reaches §4's figure and is refused
//    a manager's — with a body a manager would have been admitted for, which is
//    what distinguishes an authority check from a validation one. Driven off
//    `CAPABILITIES` rather than off a list written out here, per §4's own
//    instruction.
// 2. **The guest realm never reaches either handler.** Unlike `folio.read`, both
//    rows deny it, so the refusal comes from the guard and no ownership question
//    is owed anywhere — money leaving the property is staff-only at every
//    milestone.
// 3. **The policy route takes no figure, and there is nowhere to put one.** The
//    request carries the stay and nothing else, so the assertion is over the
//    account that comes back: a charge naming its grid row, the money returned
//    beside it, and the two summing against the payment to leave the account
//    settled.
// 4. **The line is attributed to the person who filed it**, by name, off the
//    session and never off the body.
// 5. **A `VndAmount` survives the round trip.** Money leaves as decimal text and
//    arrives as decimal text, and a refund is the one figure here that is
//    positive on the ledger while being money going out.
//
// The routes are reached through `AppModule` and nothing is registered here, so
// this suite fails if `folio.module.ts` ever stops carrying the controller.
//
// **Which row of the grid fires is deliberately not asserted here.** It turns on
// the wall clock against §4's 18:00 deadline, and a suite that pinned it would
// be asserting the calendar it happened to run on. What is asserted instead is
// the relation the route must keep whichever row fired — the refund is the
// payment less the charge, and the account settles — which is true in June and
// in December. The service suite pins the rows, with the instant written down.
//
// The tax figures are deliberately unreal — 12.34% VAT over a 3.21% service
// charge, a day rolling at 11:00. §8 forbids the tree from carrying a real rate.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { systemConfig } from "../src/database/schema/config.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import {
  capability,
  type CapabilityKey,
  staffGrant,
  STAFF_ROLES,
  type StaffRole,
} from "../src/modules/identity/rbac/matrix.js";
import { permits } from "../src/modules/identity/rbac/roles.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

const SEED_FROM = parseDate("2027-06-01");

/** The property's day, stopped — so a posting's business date is a constant and
 *  a line dated from the calendar cannot pass by coincidence. */
const TODAY = parseDate("2027-06-10");

const ARRIVAL = "2027-06-10";
const DEPARTURE = "2027-06-13";

/** A configuration nobody could mistake for a property's real one. */
const CONFIGURED = {
  standardVatRateBps: 1_234,
  reducedVatRateBps: 2_468,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 321,
  businessDateRolloverHour: 11,
} satisfies typeof systemConfig.$inferInsert;

const A_STAY = {
  roomType: "SUPERIOR",
  checkIn: ARRIVAL,
  checkOut: DEPARTURE,
  plan: "STANDARD",
  adults: 2,
  childAges: [],
} as const;

/** What a manager hands back outside the grid, and why. */
const A_DISCRETIONARY_REFUND = 350_000n;
const A_REASON = "The room was not ready until the second evening";

const GUEST_EMAIL = "khach@example.test";
const GUEST_PASSWORD = "correct-horse-battery";

/** The property's day, stopped — the device every booking suite here uses. */
class StoppedClock extends BusinessDateService {
  constructor() {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return TODAY;
  }
}

/** Captures what would have been sent, so the guest's verification link can be
 *  followed the way a guest follows it out of an inbox. */
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

interface StaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

/** One account per staff role, because both rows are asserted against all
 *  five. */
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

interface Posting {
  readonly id: string;
  readonly type: string;
  readonly amount: string;
  readonly description: string;
  readonly businessDate: string;
  /** Which row of §4's grid a policy charge is, and null on every other line. */
  readonly chargeBasis: string | null;
  readonly postedBy: string | null;
}

interface Folio {
  readonly id: string;
  readonly bookingId: string;
  readonly summary: {
    readonly charged: string;
    readonly credited: string;
    readonly outstanding: string;
  };
  readonly postings: readonly Posting[];
}

interface Receipt {
  readonly posted: string[];
  readonly folio: Folio;
}

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
let mailer: RecordingMailer;
const tokens = new Map<StaffRole, string>();

/** The stay the capability probes are aimed at. Nothing is ever refunded on it:
 *  an admitted caller is answered by the state of the booking or by the shape of
 *  the body, and neither answer is 403, which is all those cases ask. */
let probeStayId: string;

beforeAll(async () => {
  mailer = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(BusinessDateService)
    .useClass(StoppedClock)
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheLedger();

  // The five accounts are created by email and the column is unique, so they
  // have to be the only five — the seed does not own this table. The guest realm
  // is emptied for the same reason.
  await db.execute(
    sql`truncate guest_user, guest_session, guest_account, guest_verification, staff_user, staff_session restart identity cascade`,
  );

  // No synthetic stays: every claim here counts lines on one account, and five
  // hundred random holds would put rooms and rates in the way.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  // After the seed and after the boot provider, both of which write this row.
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    await staff.create({ ...account });
    tokens.set(account.role, await signIn(account.email, account.password));
  }

  probeStayId = (await aStay()).bookingId;
}, 120_000);

afterAll(async () => {
  // The rows this file committed, taken back the only way a write-once table
  // allows. Left standing, a folio would hold a booking the next file's seed
  // cannot clear, and the failure would surface files away from its cause.
  await clearTheLedger();
  await app?.close();
});

/** Both ledger tables, emptied. A posting cannot be deleted, so `truncate` is
 *  the only way back. */
async function clearTheLedger(): Promise<void> {
  await db.execute(sql`truncate folio_posting, folio restart identity cascade`);
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

/** A call as one member of staff. */
function as(role: StaffRole, path: string, body: object = {}): request.Test {
  return http()
    .post(path)
    .set("Authorization", `Bearer ${tokens.get(role)!}`)
    .send(body);
}

const folioPath = (bookingId: string) => `/bookings/${bookingId}/folio`;

const policyRefundPath = (bookingId: string) =>
  `${folioPath(bookingId)}/policy-refunds`;

const overrideRefundPath = (bookingId: string) =>
  `${folioPath(bookingId)}/override-refunds`;

/** A stay the desk has taken, and the total it was sold for. */
async function aStay(plan: string = A_STAY.plan): Promise<{
  bookingId: string;
  stayTotalGross: bigint;
}> {
  const created = await http()
    .post("/bookings")
    .set("Authorization", `Bearer ${tokens.get("RECEPTIONIST")!}`)
    .send({ ...A_STAY, plan });

  if (created.status !== 201) {
    throw new Error(`the stay was refused: ${JSON.stringify(created.body)}`);
  }

  return {
    bookingId: created.body.id as string,
    stayTotalGross: BigInt(created.body.stayTotalGross as string),
  };
}

/**
 * A stay the guest paid for in full and then called off.
 *
 * Cancelled through the route rather than in SQL, because the instant the grid
 * measures against is the one the cancellation wrote — a fixture that set the
 * column by hand would be testing the refund against a moment no cancellation
 * produced.
 *
 * The waived variant goes through the manager's route for the same reason and a
 * stronger one: which route the caller reached is precisely what used to be the
 * only record of the waiver, so a fixture that wrote the columns itself would
 * prove nothing about the path that has to write them.
 */
async function aPaidCancellation(
  waived: { by: StaffRole; reason?: string } | null = null,
  plan?: string,
): Promise<{ bookingId: string; paid: bigint }> {
  const { bookingId, stayTotalGross } = await aStay(plan);

  await as("RECEPTIONIST", `${folioPath(bookingId)}/payments`, {
    amount: stayTotalGross.toString(),
    description: "Prepayment, card ****4242",
  }).expect(200);

  const [path, role] = waived
    ? ([`/bookings/${bookingId}/cancellation-waiver`, waived.by] as const)
    : ([`/bookings/${bookingId}/cancellation`, "RECEPTIONIST"] as const);

  await as(role, path, {
    reason: waived?.reason ?? "GUEST_REQUEST",
  }).expect(200);

  return { bookingId, paid: stayTotalGross };
}

const lineOfType = (folio: Folio, type: string) =>
  folio.postings.find((posting) => posting.type === type);

const sumOf = (postings: readonly Posting[]) =>
  postings.reduce((total, posting) => total + BigInt(posting.amount), 0n);

/**
 * The two routes, with the matrix row each declares.
 *
 * Both are writes, and neither has a read half — an account is read through
 * `folio.read`, and a 👁 grant over a row that only ever moves money would be a
 * permission with nothing behind it.
 */
const ROUTES: readonly {
  readonly name: string;
  readonly path: (bookingId: string) => string;
  readonly capability: CapabilityKey;
}[] = [
  {
    name: "postPolicyRefund",
    path: policyRefundPath,
    capability: "folio.refund-policy",
  },
  {
    name: "postOverrideRefund",
    path: overrideRefundPath,
    capability: "folio.refund-override",
  },
];

describe("the capability each refund route declares", () => {
  // No body is sent — the guard runs before the handler, so an admitted caller
  // is answered by the booking's state or by the missing amount and a refused
  // one answers 403 either way. No money moves while the matrix is asserted.
  for (const route of ROUTES) {
    for (const role of STAFF_ROLES) {
      const admitted = permits(staffGrant(route.capability, role), "write");

      it(`${admitted ? "admits" : "refuses"} ${role} on ${route.name}`, async () => {
        const response = await as(role, route.path(probeStayId));

        if (admitted) {
          expect(response.status).not.toBe(403);
        } else {
          expect(response.status).toBe(403);
        }
      });
    }
  }

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong role is refused.
    for (const route of ROUTES) {
      await http().post(route.path(probeStayId)).send().expect(401);
    }
  });

  it("names only rows the matrix already has", () => {
    // The guard types the decorator's first argument against the matrix, so an
    // invented key would not compile. This asserts the other half — that each
    // row is the one the route is meant to be under.
    for (const route of ROUTES) {
      expect(capability(route.capability).section).toBe("Folio and money");
    }
  });

  it("refuses a receptionist the discretionary refund with a body a manager is admitted for", async () => {
    // The sharpest form of `rbac-matrix.md` §2's rule: the same request, sent
    // twice, refused for the role and not for its shape. A single endpoint that
    // compared the amount against the grid would answer 200 here, having decided
    // for itself what this receptionist was allowed to hand back.
    const { bookingId } = await aPaidCancellation();

    const body = {
      amount: A_DISCRETIONARY_REFUND.toString(),
      reason: A_REASON,
    };

    await as("RECEPTIONIST", overrideRefundPath(bookingId), body).expect(403);
    await as("MANAGER", overrideRefundPath(bookingId), body).expect(200);
  });
});

describe("a guest holding a real session", () => {
  let guest: request.Agent;

  beforeAll(async () => {
    await http()
      .post("/api/auth/sign-up/email")
      .send({
        name: "Đỗ Thị Lan",
        email: GUEST_EMAIL,
        password: GUEST_PASSWORD,
      })
      .expect(200);

    const link = new URL(mailer.linkTo(GUEST_EMAIL));

    await http().get(`${link.pathname}${link.search}`).expect(302);

    guest = request.agent(app.getHttpServer());

    await guest
      .post("/api/auth/sign-in/email")
      .send({ email: GUEST_EMAIL, password: GUEST_PASSWORD })
      .expect(200);

    // The session is real, which is what makes the refusal below mean
    // something: it is about authority and not about the cookie.
    const session = await guest.get("/api/auth/get-session").expect(200);

    expect(session.body.user.emailVerified).toBe(true);
  });

  it("is refused both refunds outright, at the guard", async () => {
    // `denied` on both rows, unlike `folio.read`'s `conditional`, so these never
    // reach a handler: the realm is wrong rather than the scope, and there is no
    // ownership question left for a handler to answer.
    for (const route of ROUTES) {
      await guest.post(route.path(probeStayId)).send().expect(403);
    }
  });
});

describe("§4's grid, applied over the wire", () => {
  it("posts the charge and the money going back, and settles the account", async () => {
    const { bookingId, paid } = await aPaidCancellation();

    const response = await as(
      "RECEPTIONIST",
      policyRefundPath(bookingId),
    ).expect(200);

    const { posted, folio } = response.body as Receipt;
    const charge = lineOfType(folio, "POLICY_CHARGE");
    const refund = lineOfType(folio, "REFUND");

    // Both lines this call authored, and both on the account it answered with.
    expect(posted).toHaveLength(2);
    expect(posted).toContain(charge?.id);
    expect(posted).toContain(refund?.id);

    // The relation the route keeps whichever row of the grid fired: what is
    // handed back is what the stay paid, less what §4 charged it.
    expect(BigInt(refund!.amount)).toBe(paid - BigInt(charge!.amount));

    // Settled, which is the whole point of the two lines — `NFR-02` over the
    // rows the response carries.
    expect(sumOf(folio.postings)).toBe(0n);
    expect(BigInt(folio.summary.outstanding)).toBe(0n);
    expect(BigInt(folio.summary.charged) - BigInt(folio.summary.credited)).toBe(
      0n,
    );
  });

  it("attributes the lines to the receptionist who applied it", async () => {
    // Off the session and never off the body — the account names a person, by
    // name, the way every other line on it does.
    const { bookingId } = await aPaidCancellation();

    const response = await as(
      "RECEPTIONIST",
      policyRefundPath(bookingId),
    ).expect(200);

    const { folio } = response.body as Receipt;

    for (const type of ["POLICY_CHARGE", "REFUND"]) {
      expect(lineOfType(folio, type)?.postedBy).toBe(
        STAFF.RECEPTIONIST.fullName,
      );
    }
  });

  it("dates the lines by the property's day and not by the calendar", async () => {
    const { bookingId } = await aPaidCancellation();

    const response = await as(
      "RECEPTIONIST",
      policyRefundPath(bookingId),
    ).expect(200);

    const { folio } = response.body as Receipt;

    expect(lineOfType(folio, "POLICY_CHARGE")?.businessDate).toBe(
      TODAY.toString(),
    );
  });

  it("refuses to apply the grid twice to one stay", async () => {
    // The grid prices the whole of what ended the stay, so a second application
    // charges one cancellation twice — and on an append-only ledger the second
    // charge can only be compensated, never removed.
    const { bookingId } = await aPaidCancellation();

    await as("RECEPTIONIST", policyRefundPath(bookingId)).expect(200);
    await as("RECEPTIONIST", policyRefundPath(bookingId)).expect(409);
  });

  it("refuses a stay that has not ended", async () => {
    // A stay nobody has cancelled has no row of the grid to be under, and the
    // refusal names the state so the desk knows which act is missing.
    const { bookingId } = await aStay();

    const response = await as(
      "RECEPTIONIST",
      policyRefundPath(bookingId),
    ).expect(409);

    expect(JSON.stringify(response.body)).toContain("CONFIRMED");
  });
});

describe("a penalty a manager waived, priced by a receptionist", () => {
  // The two capabilities meeting, which is the whole of what this file can
  // assert and the service suite cannot. `booking.cancel-waiver` is `MANAGER`+
  // and `folio.refund-policy` is the desk's, so the decision is taken in one
  // request and applied in another by somebody who holds neither the waiver nor
  // `folio.reverse-posting` — a charge that landed here could not be taken back
  // by the person who filed it.

  // The pair below is sold on `NONREF` deliberately. This file does not pin
  // which row of the grid fires — that turns on the wall clock against §4's
  // 18:00 deadline, and a suite asserting it would be asserting the calendar it
  // happened to run on. `NONREF` has one answer in every row, so "waived" and
  // "not waived" differ by the waiver in June and in December alike.

  it("charges nothing, and says the grid is what charged nothing", async () => {
    const { bookingId, paid } = await aPaidCancellation(
      { by: "MANAGER" },
      "NONREF",
    );

    const response = await as(
      "RECEPTIONIST",
      policyRefundPath(bookingId),
    ).expect(200);

    const { folio } = response.body as Receipt;
    const charge = lineOfType(folio, "POLICY_CHARGE");

    expect(charge?.amount).toBe("0");
    // `NONE` is a row of the grid rather than the absence of one, so the account
    // records that §4 was applied and came to nothing.
    expect(charge?.chargeBasis).toBe("NONE");

    // And the guest has the whole prepayment back, with the account settled.
    expect(BigInt(lineOfType(folio, "REFUND")!.amount)).toBe(paid);
    expect(sumOf(folio.postings)).toBe(0n);
  });

  it("charges the same stay in full when nobody waived it", async () => {
    // The regression guard, and the reason the case above means anything: the
    // two stays differ in the route the cancellation took and in nothing else.
    const { bookingId } = await aPaidCancellation(null, "NONREF");

    const response = await as(
      "RECEPTIONIST",
      policyRefundPath(bookingId),
    ).expect(200);

    const { folio } = response.body as Receipt;
    const charge = lineOfType(folio, "POLICY_CHARGE");

    // §4's `NONREF` column is the whole stay in every row, so the row is named
    // whatever the calendar says. The figure is left unpinned on purpose — it is
    // the nights as the calendar priced them, which `folio-refund-service.e2e-spec.ts`
    // works by hand; what this file is about is that something was charged.
    expect(charge?.chargeBasis).toBe("FULL_STAY");
    expect(BigInt(charge!.amount)).toBeGreaterThan(0n);
  });

  it("waives a guest's change of mind as readily as the property's own fault", async () => {
    // Reason and waiver are orthogonal, and this is the case a design that gated
    // the waiver on the reason code could not express. §4's grid has no reason
    // column; `GUEST_REQUEST` is the code such a rule would have refused, and it
    // waives here exactly as `STAFF_ERROR` does.
    for (const reason of ["GUEST_REQUEST", "STAFF_ERROR"]) {
      const { bookingId } = await aPaidCancellation(
        { by: "MANAGER", reason },
        "NONREF",
      );

      const response = await as(
        "RECEPTIONIST",
        policyRefundPath(bookingId),
      ).expect(200);

      const { folio } = response.body as Receipt;

      expect(lineOfType(folio, "POLICY_CHARGE")?.amount).toBe("0");
    }
  });
});

describe("money handed back at a manager's discretion", () => {
  it("posts the figure it was given, with the reason on the line", async () => {
    const { bookingId, paid } = await aPaidCancellation();

    const response = await as("MANAGER", overrideRefundPath(bookingId), {
      amount: A_DISCRETIONARY_REFUND.toString(),
      reason: A_REASON,
    }).expect(200);

    const { posted, folio } = response.body as Receipt;
    const refund = lineOfType(folio, "REFUND");

    expect(posted).toEqual([refund?.id]);
    // Decimal text out and decimal text back, and positive on the ledger while
    // being money going out — `schema/folio.ts`'s sign convention, which is what
    // makes the balance a plain sum.
    expect(refund?.amount).toBe(A_DISCRETIONARY_REFUND.toString());
    expect(refund?.description).toContain(A_REASON);
    expect(refund?.postedBy).toBe(STAFF.MANAGER.fullName);

    // The stay paid in full and has been handed part of it back, so it now owes
    // that part — the balance moved by exactly the refund and by nothing else.
    expect(BigInt(folio.summary.outstanding)).toBe(
      A_DISCRETIONARY_REFUND - paid,
    );
  });

  it("posts no line at all when the reason is missing", async () => {
    // The reason is required by the contract rather than defaulted, so this is
    // refused before the handler and the account is left untouched — a credit
    // with no account of why is one nobody can answer for later.
    const { bookingId } = await aPaidCancellation();

    await as("MANAGER", overrideRefundPath(bookingId), {
      amount: A_DISCRETIONARY_REFUND.toString(),
    }).expect(400);

    const account = await http()
      .get(folioPath(bookingId))
      .set("Authorization", `Bearer ${tokens.get("MANAGER")!}`)
      .expect(200);

    expect(lineOfType(account.body as Folio, "REFUND")).toBeUndefined();
  });

  it("refuses an amount that is not money going out", async () => {
    const { bookingId } = await aPaidCancellation();

    for (const amount of ["0", "-1"]) {
      await as("MANAGER", overrideRefundPath(bookingId), {
        amount,
        reason: A_REASON,
      }).expect(400);
    }
  });
});
