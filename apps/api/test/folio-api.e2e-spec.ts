// The folio API, end to end — the five routes `matrix.ts` already governs, over
// HTTP against a real Postgres, the real capability guard and both realms.
//
// `folio-service.e2e-spec.ts` proves what a gross figure becomes once somebody
// posts it, and `folio-storage.e2e-spec.ts` proves what the tables will and will
// not hold. Neither can assert what only exists once there are routes, and that
// is what this file is for:
//
// 1. **Every route is governed by the matrix row it declares**, driven off
//    `CAPABILITIES` rather than off a list written out here — `rbac-matrix.md`
//    §4's own instruction, and the reason the read's row is asked with
//    `permits(grant, "read")` while the three writes are asked as writes.
// 2. **The guest realm is refused, and refusing is the ownership check.** The
//    row grants a guest `conditional` — "own, settled view" — and `roles.ts`
//    lets `conditional` past the guard, so a real signed-in guest reaches the
//    handler. No folio can be theirs: `schema/guest.ts` says the join between a
//    guest account and a stay is M7's. The session below is a real one, verified
//    by following the link out of the mailer, so what is asserted is a 403 and
//    not a 401 — the identity is fine and the authority is not — and that the
//    body carries no figure off the account.
// 3. **A `VndAmount` survives the round trip, negatives included.** Money leaves
//    as decimal text and arrives as decimal text, which `money.ts` fixes and
//    which a payment and a reversal are the only routes here that can show in
//    the negative.
// 4. **A correction is a line the account gains.** The reversal route adds rows
//    and removes none, and a line named against a stay it is not on is refused
//    rather than credited to whoever it does belong to.
// 5. **The close asks the invoice provider nothing.** `FR-FOL-04` promises that
//    a provider timeout never rolls back a checkout, and the route keeps that
//    promise by having no way to reach one — `e-invoice.job.ts` makes the closed
//    row itself the request for an invoice, drained later by a sweep. So the
//    provider is replaced below by one that counts what it is asked and is
//    refusing outright while the account is being agreed: a close that waited on
//    it would fail loudly here rather than pass quietly in production.
// 6. **An account is agreed once.** A second close is refused with the instant
//    of the first, and the row the sweep reads is left exactly as the first
//    close wrote it — one stay awaiting one invoice, however often the desk
//    asks. Whether the sweep then issues exactly one document is
//    `folio-close.e2e-spec.ts`'s claim and is not restated here.
//
// The routes are reached through `AppModule` and nothing is registered here, so
// this suite fails if `folio.module.ts` ever stops carrying the controller —
// which is the point of booting the real graph rather than a hand-built one.
//
// The tax figures are deliberately unreal — 12.34% VAT over a 3.21% service
// charge, a day rolling at 11:00. §8 forbids the tree from carrying a real rate.
// Nothing here asserts the split itself; that is the service suite's claim, and
// this one requires only that the three lines sum back to the figure that was
// posted.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { systemConfig } from "../src/database/schema/config.js";
import {
  folio as folioTable,
  folioPosting,
} from "../src/database/schema/folio.js";
import {
  BREAKFAST_PER_PERSON_GROSS,
  SERVICE_CATALOG,
} from "../src/database/seed/property.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { LocalEInvoiceService } from "../src/modules/folio/local-e-invoice.service.js";
import {
  type CorrectInvoiceInput,
  E_INVOICE_PORT,
  type EInvoicePort,
  type IssuedInvoice,
  type IssueInvoiceInput,
} from "../src/modules/folio/ports/e-invoice.port.js";
import {
  capability,
  type CapabilityKey,
  staffGrant,
  STAFF_ROLES,
  type StaffRole,
} from "../src/modules/identity/rbac/matrix.js";
import {
  type CapabilityAction,
  permits,
} from "../src/modules/identity/rbac/roles.js";
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
const BUSINESS_DATE = "2027-06-10";

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

/** What the desk posts, and what it takes. Neither divides evenly by the rates
 *  above, so a decomposition that lost a đồng would show in the summary. */
const A_CHARGE = 1_111_111n;
const A_PAYMENT = 400_000n;

const A_STAY = {
  roomType: "SUPERIOR",
  checkIn: ARRIVAL,
  checkOut: DEPARTURE,
  plan: "STANDARD",
  adults: 2,
  childAges: [],
} as const;

const GUEST_EMAIL = "khach@example.test";
const GUEST_PASSWORD = "correct-horse-battery";

/** What a folio line may say — the shape `folioPostingSchema` declares, as a
 *  list, so a field nobody thought of fails rather than travels. */
const POSTING_FIELDS = [
  "id",
  "type",
  "amount",
  "description",
  "businessDate",
  "reversesPostingId",
  "parentPostingId",
  // Which row of §4's grid a policy charge is, and null everywhere else. It
  // travels because a penalty of nothing and a penalty nobody applied are the
  // same figure and not the same fact.
  "chargeBasis",
  "postedAt",
  "postedBy",
] as const;

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

/**
 * Whoever issues the property's invoices, counted and switchable.
 *
 * Two devices in one, and each answers a claim the close route has to keep.
 * Every call is recorded, because the number the route must make is nought: the
 * close commits state and `EInvoiceJob` asks the provider minutes later, on a
 * connection no request handler holds. And {@link down} takes the provider away
 * entirely — the sharpest form of `FR-FOL-04`'s timeout — so a close that ever
 * did await one would answer 500 and roll its transaction back, which is a
 * failing test rather than a stay that cannot be checked out because a third
 * party is having an afternoon.
 */
class RecordingIssuer implements EInvoicePort {
  readonly asked: IssueInvoiceInput[] = [];
  down = false;

  private readonly local = new LocalEInvoiceService();

  async issue(input: IssueInvoiceInput): Promise<IssuedInvoice> {
    this.asked.push(input);

    if (this.down) {
      throw new Error("the provider is down");
    }

    return await this.local.issue(input);
  }

  async adjust(input: CorrectInvoiceInput): Promise<IssuedInvoice> {
    return await this.local.adjust(input);
  }

  async replace(input: CorrectInvoiceInput): Promise<IssuedInvoice> {
    return await this.local.replace(input);
  }
}

interface StaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

/** One account per staff role, because the four rows are asserted against all
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
  readonly reversesPostingId: string | null;
  readonly parentPostingId: string | null;
  readonly chargeBasis: string | null;
  readonly postedAt: string;
  readonly postedBy: string | null;
}

interface Folio {
  readonly id: string;
  readonly bookingId: string;
  readonly state: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly summary: {
    readonly charged: string;
    readonly credited: string;
    readonly outstanding: string;
  };
  readonly postings: readonly Posting[];
}

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
let mailer: RecordingMailer;
let issuer: RecordingIssuer;
const tokens = new Map<StaffRole, string>();

/**
 * Four stays, because the claims below must not interfere.
 *
 * The desk's account is charged, paid and corrected in sequence, so anything
 * that would add a line to it out of turn gets a stay of its own: the guest
 * realm needs an account with money on it to be refused, the cross-stay
 * correction needs a second account for a line to not belong to, and the
 * "no account yet" refusal needs one nothing is ever posted to.
 */
let stayId: string;
let emptyStayId: string;
let otherStayId: string;
let guestStayId: string;

beforeAll(async () => {
  mailer = new RecordingMailer();
  issuer = new RecordingIssuer();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(BusinessDateService)
    .useClass(StoppedClock)
    .overrideProvider(MailerService)
    .useValue(mailer)
    // `folio.module.ts` does not export this token, on purpose — what issues the
    // property's invoices is that module's business. A testing override reaches
    // it anyway, and does so without widening the boundary for production code,
    // which is what makes the count below assertable at all.
    .overrideProvider(E_INVOICE_PORT)
    .useValue(issuer)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheLedger();

  // The five accounts are created by email and the column is unique, so they
  // have to be the only five — the seed does not own this table. The guest
  // realm is emptied for the same reason.
  await db.execute(
    sql`truncate guest_user, guest_session, guest_account, guest_verification, staff_user, staff_session restart identity cascade`,
  );

  // No synthetic stays: every claim here counts lines on one account, and five
  // hundred random holds would put rooms and rates in the way.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  // After the seed and after the boot provider, both of which write this row.
  // The rates are read per posting through the caller's executor, so the update
  // is in force for everything below it.
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    await staff.create({ ...account });
    tokens.set(account.role, await signIn(account.email, account.password));
  }

  stayId = await aStay();
  emptyStayId = await aStay();
  otherStayId = await aStay();
  guestStayId = await aStay();
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

/** A call as one member of staff. A `GET` carries its arguments in the query
 *  string and everything else in the body. */
function as(
  role: StaffRole,
  method: "get" | "post",
  path: string,
  body: object = {},
): request.Test {
  const call = http()
    [method](path)
    .set("Authorization", `Bearer ${tokens.get(role)!}`);

  return method === "get" ? call.query(body) : call.send(body);
}

/** A stay the desk has taken, through the real route. */
async function aStay(): Promise<string> {
  const created = await as("RECEPTIONIST", "post", "/bookings", A_STAY);

  if (created.status !== 201) {
    throw new Error(`the stay was refused: ${JSON.stringify(created.body)}`);
  }

  return created.body.id as string;
}

const folioPath = (bookingId: string) => `/bookings/${bookingId}/folio`;

const closurePath = (bookingId: string) => `${folioPath(bookingId)}/closure`;

/** The account as one role reads it. */
async function readFolio(
  bookingId: string,
  role: StaffRole = "RECEPTIONIST",
): Promise<Folio> {
  const response = await as(role, "get", folioPath(bookingId)).expect(200);

  return response.body;
}

async function postCharge(
  bookingId: string,
  grossAmount: bigint,
  description: string,
  role: StaffRole = "RECEPTIONIST",
): Promise<{ posted: string[]; folio: Folio }> {
  const response = await as(role, "post", `${folioPath(bookingId)}/charges`, {
    grossAmount: grossAmount.toString(),
    description,
  }).expect(200);

  return response.body;
}

async function postPayment(
  bookingId: string,
  amount: bigint,
  description: string,
  role: StaffRole = "RECEPTIONIST",
): Promise<{ posted: string[]; folio: Folio }> {
  const response = await as(role, "post", `${folioPath(bookingId)}/payments`, {
    amount: amount.toString(),
    description,
  }).expect(200);

  return response.body;
}

/** A stay charged for its night and paid for in full, so its account comes to
 *  nothing and the desk can agree it. The three lines a gross figure decomposes
 *  into sum back to that figure, so one payment of it settles the account. */
async function aSettledStay(): Promise<string> {
  const bookingId = await aStay();

  await postCharge(bookingId, A_CHARGE, "One night, to be settled and agreed");
  await postPayment(bookingId, A_CHARGE, "Card, ****4242");

  return bookingId;
}

/**
 * The folio row as the database holds it, which is the queue `EInvoiceJob`
 * reads.
 *
 * Not off the route: `folioSchema` carries no `invoiceReference`, deliberately —
 * there is no number at the moment of the close — and it is precisely the null
 * in that column that makes a closed account one outstanding request for an
 * invoice. So the enqueue is counted where it actually lives.
 */
async function folioRowOf(bookingId: string) {
  const [row] = await db
    .select({
      id: folioTable.id,
      state: folioTable.state,
      closedAt: folioTable.closedAt,
      invoiceReference: folioTable.invoiceReference,
    })
    .from(folioTable)
    .where(eq(folioTable.bookingId, bookingId));

  return row;
}

/** The catalog row a posted line names, which the wire deliberately omits. */
async function catalogIdOn(postingId: string): Promise<string | null> {
  const [row] = await db
    .select({ serviceCatalogId: folioPosting.serviceCatalogId })
    .from(folioPosting)
    .where(eq(folioPosting.id, postingId));

  return row?.serviceCatalogId ?? null;
}

const lineOfType = (folio: Folio, type: string) =>
  folio.postings.find((posting) => posting.type === type);

const sumOf = (postings: readonly Posting[]) =>
  postings.reduce((total, posting) => total + BigInt(posting.amount), 0n);

/**
 * Every folio route, with the matrix row it declares and what it does with it.
 *
 * `action` is part of the data rather than assumed: the read is the one route
 * here that declares itself a read, and a table that assumed "write" would
 * assert the wrong expectation for it the day the matrix grants a role a 👁 over
 * the row.
 */
const ROUTES: readonly {
  readonly name: string;
  readonly method: "get" | "post";
  readonly path: (bookingId: string) => string;
  readonly capability: CapabilityKey;
  readonly action: CapabilityAction;
}[] = [
  {
    name: "read",
    method: "get",
    path: folioPath,
    capability: "folio.read",
    action: "read",
  },
  {
    name: "postCharge",
    method: "post",
    path: (id) => `${folioPath(id)}/charges`,
    capability: "folio.post-charge",
    action: "write",
  },
  {
    // Under the same row as the charge above it, and that is the matrix's own
    // reading rather than a convenience: "Post charge (room, service, minibar)"
    // names this act. Two routes sharing a key is not what §2 forbids — what it
    // forbids is one route whose authority depends on its body.
    name: "postServiceItem",
    method: "post",
    path: (id) => `${folioPath(id)}/service-items`,
    capability: "folio.post-charge",
    action: "write",
  },
  {
    name: "postPayment",
    method: "post",
    path: (id) => `${folioPath(id)}/payments`,
    capability: "folio.post-payment",
    action: "write",
  },
  {
    name: "reversePosting",
    method: "post",
    path: (id) => `${folioPath(id)}/reversals`,
    capability: "folio.reverse-posting",
    action: "write",
  },
  {
    name: "close",
    method: "post",
    path: closurePath,
    capability: "folio.close-invoice",
    action: "write",
  },
];

describe("the capability each folio route declares", () => {
  // §4's obligation for the five rows these routes add. No body is sent to the
  // writes — the guard runs before the handler, so an admitted caller answers
  // 400 and a refused one answers 403 either way, and no money moves while the
  // matrix is being asserted.
  //
  // Asked of the stay nothing is ever posted to, and that is not tidiness. The
  // close takes no body, so an admitted caller's request is valid and reaches
  // the handler; against an account with lines on it, one of these probes could
  // agree the very folio the rest of the file goes on to charge, and the damage
  // would surface three describes away from its cause. With no account opened
  // the handler can only answer 404, which is not 403 and is all this block
  // asks.
  for (const route of ROUTES) {
    for (const role of STAFF_ROLES) {
      const admitted = permits(staffGrant(route.capability, role), route.action);

      it(`${admitted ? "admits" : "refuses"} ${role} on ${route.name}`, async () => {
        const response = await as(role, route.method, route.path(emptyStayId));

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
      await http()[route.method](route.path(emptyStayId)).send().expect(401);
    }
  });

  it("names only rows the matrix already has", () => {
    // The guard types the decorator's first argument against the matrix, so an
    // invented key would not compile. This asserts the other half — that each
    // row is the one the route is meant to be under, and that none of them is a
    // key some future edit renamed out from under a route that still answers.
    for (const route of ROUTES) {
      expect(capability(route.capability).section).toBe("Folio and money");
    }
  });
});

// The catalog route is not a folio route — its row is filed under "Rooms,
// rates, inventory", because what is for sale is a fact about the property and
// not about anybody's account. It is asserted here because this is where the
// other half of `FR-FOL-03` runs: the list is what a code comes from, and a
// route the desk cannot open is a posting it cannot make.
describe("the capability the service catalog route declares", () => {
  const CATALOG_PATH = "/service-catalog";
  const CATALOG_CAPABILITY: CapabilityKey = "service.read-catalog";
  const CATALOG_ACTION: CapabilityAction = "read";

  for (const role of STAFF_ROLES) {
    const admitted = permits(
      staffGrant(CATALOG_CAPABILITY, role),
      CATALOG_ACTION,
    );

    it(`${admitted ? "admits" : "refuses"} ${role}`, async () => {
      const response = await as(role, "get", CATALOG_PATH);

      if (admitted) {
        expect(response.status).not.toBe(403);
      } else {
        expect(response.status).toBe(403);
      }
    });
  }

  it("refuses a stranger holding no session", async () => {
    // A price list is not public. What a guest is quoted comes from the funnel,
    // which prices a stay; this is the desk's list and it is asked for with a
    // session or not at all.
    await http().get(CATALOG_PATH).expect(401);
  });

  it("names the row the matrix already has", () => {
    expect(capability(CATALOG_CAPABILITY).section).toBe(
      "Rooms, rates, inventory",
    );
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

    // The session is real, which is what makes the refusals below mean
    // something: they are about authority and not about the cookie.
    const session = await guest.get("/api/auth/get-session").expect(200);

    expect(session.body.user.emailVerified).toBe(true);
  });

  it("is refused the ledger with 403 rather than 401", async () => {
    // The matrix grants this row `conditional` and `roles.ts` lets that past
    // the guard, so the refusal below comes from the handler: the ownership the
    // guard could not see is owed there, and no folio is linked to a guest
    // account — `schema/guest.ts` puts that join at M7. The set of folios that
    // are this caller's own is empty, and this is the caller seeing exactly
    // that set.
    const response = await guest.get(folioPath(stayId));

    expect(response.status).toBe(403);
  });

  it("is told nothing about the account it was refused", async () => {
    await postCharge(guestStayId, A_CHARGE, "A night, on an account with money");

    const response = await guest.get(folioPath(guestStayId)).expect(403);
    const body = JSON.stringify(response.body);

    // The claim is about the whole body rather than the fields expected to
    // carry the money, because the failure being guarded against is a field
    // nobody thought of.
    expect(body).not.toContain(A_CHARGE.toString());
    expect(body).not.toContain("postings");
    expect(body).not.toContain("summary");
  });

  it("is refused every write outright, at the guard", async () => {
    // `denied` on all three rows, so these never reach a handler — the realm is
    // wrong rather than the scope.
    for (const route of ROUTES.filter((each) => each.action === "write")) {
      await guest.post(route.path(stayId)).send().expect(403);
    }
  });

  it("is refused the price list, which is nobody's own booking", async () => {
    // `denied` and not `conditional`: there is no scope a handler could check
    // that would make one guest's view of what the property sells different
    // from another's, so the realm is wrong at the guard.
    await guest.get("/service-catalog").expect(403);
  });
});

describe("the account the desk reads", () => {
  it("refuses a stay no account has been opened for", async () => {
    await as("RECEPTIONIST", "get", folioPath(emptyStayId)).expect(404);
  });

  it("opens the account on the first charge and answers with it", async () => {
    const { posted, folio } = await postCharge(
      stayId,
      A_CHARGE,
      "One night in a superior",
    );

    expect(posted).toHaveLength(1);
    expect(folio.bookingId).toBe(stayId);
    expect(folio.state).toBe("OPEN");
    expect(folio.closedAt).toBeNull();

    // `FR-FOL-02`: the sale and the two percentages levied on it, as three
    // lines rather than one gross figure.
    const charge = lineOfType(folio, "ROOM_CHARGE");
    const serviceCharge = lineOfType(folio, "SERVICE_CHARGE_FEE");
    const vat = lineOfType(folio, "VAT");

    expect(charge?.id).toBe(posted[0]);
    expect(serviceCharge?.parentPostingId).toBe(posted[0]);
    expect(vat?.parentPostingId).toBe(posted[0]);

    // The three sum back to the figure the guest agreed to, to the đồng. The
    // split itself is the service suite's claim; this is the one property the
    // route has to preserve.
    expect(sumOf([charge!, serviceCharge!, vat!])).toBe(A_CHARGE);
  });

  it("dates the line by the property's day and not by the calendar", async () => {
    const folio = await readFolio(stayId);

    for (const posting of folio.postings) {
      expect(posting.businessDate).toBe(BUSINESS_DATE);
    }
  });

  it("attributes the line to the member of staff who posted it, by name", async () => {
    const folio = await readFolio(stayId);
    const charge = lineOfType(folio, "ROOM_CHARGE")!;

    // Taken from the session and never from the body — an attribution a caller
    // could state is one a caller could choose.
    expect(charge.postedBy).toBe(STAFF.RECEPTIONIST.fullName);

    // The instant, in full: two charges on one trading day are two moments.
    expect(new Date(charge.postedAt).getTime()).toBeGreaterThan(0);
  });

  it("carries exactly the fields a line is declared to have", async () => {
    const folio = await readFolio(stayId);

    for (const posting of folio.postings) {
      expect(Object.keys(posting).sort()).toEqual([...POSTING_FIELDS].sort());
    }
  });

  it("is opened to a role the matrix grants the row", async () => {
    // `ACCOUNTANT` holds this row in full and reads the same account the desk
    // does — the folio screen is theirs as much as the receptionist's.
    const folio = await readFolio(stayId, "ACCOUNTANT");

    expect(folio.bookingId).toBe(stayId);
    expect(folio.postings.length).toBeGreaterThan(0);
  });
});

describe("the balance, derived", () => {
  it("is the sum of the lines printed under it", async () => {
    const folio = await readFolio(stayId);

    // Not a figure queried beside the list: `outstanding` and the addition over
    // the postings are the same number, so there is nowhere for the two to
    // disagree. `NFR-02`.
    expect(BigInt(folio.summary.outstanding)).toBe(sumOf(folio.postings));
    expect(BigInt(folio.summary.charged) - BigInt(folio.summary.credited)).toBe(
      sumOf(folio.postings),
    );
  });

  it("falls by what a payment took, and the payment is stored negative", async () => {
    const before = BigInt((await readFolio(stayId)).summary.outstanding);

    const { posted, folio } = await postPayment(
      stayId,
      A_PAYMENT,
      "Cash at the desk",
      "ACCOUNTANT",
    );

    const payment = folio.postings.find((line) => line.id === posted[0])!;

    // Positive on the wire in, negative in the ledger out — the sign convention
    // is applied once, in the service, and this is the round trip that shows it.
    expect(BigInt(payment.amount)).toBe(-A_PAYMENT);
    expect(payment.type).toBe("PAYMENT");

    expect(BigInt(folio.summary.outstanding)).toBe(before - A_PAYMENT);
    expect(BigInt(folio.summary.credited)).toBe(A_PAYMENT);
  });

  it("carries every amount as decimal text, negatives included", async () => {
    const folio = await readFolio(stayId);

    // `money.ts`: đồng cross the wire as whole numbers in text, never as a JSON
    // number that would silently lose the last digits of a large one. The
    // negative is the case a magnitude-only encoding would break.
    for (const amount of [
      folio.summary.charged,
      folio.summary.credited,
      folio.summary.outstanding,
      ...folio.postings.map((posting) => posting.amount),
    ]) {
      expect(typeof amount).toBe("string");
      expect(amount).toMatch(/^-?\d+$/);
    }

    expect(
      folio.postings.some((posting) => BigInt(posting.amount) < 0n),
    ).toBe(true);
  });
});

describe("a correction", () => {
  it("posts a reversing entry and deletes nothing", async () => {
    const before = await readFolio(stayId);
    const charge = lineOfType(before, "ROOM_CHARGE")!;

    const response = await as(
      "ACCOUNTANT",
      "post",
      `${folioPath(stayId)}/reversals`,
      { postingId: charge.id },
    ).expect(200);

    const after: Folio = response.body.folio;

    // `matrix.ts` on this row: never a delete. Every line that was on the
    // account is still on it, and the account has gained the corrections.
    for (const line of before.postings) {
      expect(after.postings.map((each) => each.id)).toContain(line.id);
    }

    expect(after.postings.length).toBeGreaterThan(before.postings.length);

    // The sale and everything levied on it — reversing the charge alone would
    // leave tax standing on a night the property agrees did not happen.
    const reversals = after.postings.filter(
      (line) => line.type === "REVERSAL",
    );

    expect(reversals).toHaveLength(3);
    expect(response.body.posted).toHaveLength(3);

    // Each names the line it undoes and negates it exactly, so the pair sums to
    // nothing.
    for (const reversal of reversals) {
      const undone = before.postings.find(
        (line) => line.id === reversal.reversesPostingId,
      );

      expect(undone).toBeDefined();
      expect(BigInt(reversal.amount)).toBe(-BigInt(undone!.amount));
    }

    // The correction is dated the day it was made and attributed to whoever
    // made it: an invoice cannot say whose judgement it was if the column is
    // null.
    expect(reversals[0]!.businessDate).toBe(BUSINESS_DATE);
    expect(reversals[0]!.postedBy).toBe(STAFF.ACCOUNTANT.fullName);
  });

  it("refuses a second correction of the same line", async () => {
    const folio = await readFolio(stayId);
    const charge = lineOfType(folio, "ROOM_CHARGE")!;

    // A mistake is corrected once. The database refuses the second row and the
    // service reads that refusal back as an answer the desk can act on.
    await as("ACCOUNTANT", "post", `${folioPath(stayId)}/reversals`, {
      postingId: charge.id,
    }).expect(409);
  });

  it("refuses a line that is not on the stay it was named against", async () => {
    const folio = await readFolio(stayId);
    const line = lineOfType(folio, "PAYMENT")!;

    // The other stay's account, opened so the refusal is about the line
    // belonging elsewhere rather than about there being no account at all.
    await postCharge(otherStayId, A_CHARGE, "A night on the other stay");

    const response = await as(
      "ACCOUNTANT",
      "post",
      `${folioPath(otherStayId)}/reversals`,
      { postingId: line.id },
    );

    expect(response.status).toBe(404);

    // Nothing was credited to the account the line does belong to.
    const untouched = await readFolio(stayId);

    expect(
      untouched.postings.some((each) => each.reversesPostingId === line.id),
    ).toBe(false);
  });

  it("refuses a posting id nothing answers to", async () => {
    await as("ACCOUNTANT", "post", `${folioPath(stayId)}/reversals`, {
      postingId: "00000000-0000-4000-8000-000000000000",
    }).expect(404);
  });
});

describe("selling a catalog item over the route", () => {
  // Against the seeded catalog rather than a fixture of this file's own, which
  // is the point: `FR-FOL-03`'s acceptance names §6's eight items, and a suite
  // that inserted its own would prove the code works on rows the property does
  // not have. `BREAKFAST` is one of the two §6 prices; `MINIBAR` is one of the
  // six it leaves unset.
  const serviceItemsPath = (bookingId: string) =>
    `${folioPath(bookingId)}/service-items`;

  // One stay for every case that actually posts, and the assertions are scoped
  // to the sale they made rather than to the account's total. Rooms are finite
  // here — the seed seats a real property and `aStay()` consumes inventory — so
  // a describe that opened an account per case would starve the files after it
  // of the very thing they need, which is a failure with no relation to what it
  // would be reporting.
  let sellingStayId: string;

  beforeAll(async () => {
    sellingStayId = await aStay();
  });

  /** One sale: the item's own line and the two percentages levied on it. */
  const saleTotal = (folio: Folio, saleId: string) =>
    sumOf(
      folio.postings.filter(
        (posting) => posting.id === saleId || posting.parentPostingId === saleId,
      ),
    );

  // Every seeded item is on sale, so this says the list is §6's and that a null
  // price survives the wire. Whether withdrawing withholds an item is asked of
  // the read itself in `service-catalog.e2e-spec.ts`, which writes an inactive
  // row; the seed has none to withhold.
  it("lists §6's items, with an unpriced one still saying it has no price", async () => {
    const response = await as("RECEPTIONIST", "get", "/service-catalog").expect(
      200,
    );

    const items: {
      code: string;
      name: string;
      unitPriceGross: string | null;
      taxClass: string;
    }[] = response.body;

    expect(items).toHaveLength(SERVICE_CATALOG.length);

    const breakfast = items.find((item) => item.code === "BREAKFAST");
    const minibar = items.find((item) => item.code === "MINIBAR");

    expect(breakfast?.unitPriceGross).toBe(
      BREAKFAST_PER_PERSON_GROSS.toString(),
    );
    // Null over the wire and not "0" — the desk reads this to know it owes a
    // figure of its own, and a zero would read as a complimentary item.
    expect(minibar?.unitPriceGross).toBeNull();
    expect(minibar?.taxClass).toBe("STANDARD");
  });

  it("posts a priced item at the catalog's figure, times the count", async () => {
    const posted = await as(
      "RECEPTIONIST",
      "post",
      serviceItemsPath(sellingStayId),
      { code: "BREAKFAST", quantity: 2 },
    ).expect(200);

    const folio: Folio = posted.body.folio;
    const saleId: string = posted.body.posted[0];

    expect(saleTotal(folio, saleId)).toBe(BREAKFAST_PER_PERSON_GROSS * 2n);

    // The line names the catalog row, which is what the tax class on that row
    // is for and what `M8` will group by. The wire does not carry the id, so
    // the claim is made where it is stored.
    const sale = folio.postings.find((posting) => posting.id === saleId);

    expect(sale?.type).toBe("SERVICE_ITEM");
    expect(sale?.description).toBe("2 × Breakfast");
    expect(await catalogIdOn(saleId)).not.toBeNull();
  });

  it("refuses a figure the property has already published", async () => {
    // Against the stay nothing is ever posted to, so the claim below is about
    // this request and not about a folio some earlier case opened.
    await as("RECEPTIONIST", "post", serviceItemsPath(emptyStayId), {
      code: "BREAKFAST",
      quantity: 1,
      grossAmount: "1",
    }).expect(400);

    // Nothing was written, and the folio the failed request would have opened
    // was rolled back with it.
    expect(await folioRowOf(emptyStayId)).toBeUndefined();
  });

  it("takes the desk's figure for an item nobody has priced", async () => {
    const consumed = 415_000n;

    const posted = await as(
      "RECEPTIONIST",
      "post",
      serviceItemsPath(sellingStayId),
      { code: "MINIBAR", quantity: 3, grossAmount: consumed.toString() },
    ).expect(200);

    // The count did not scale it — three items came to one agreed total.
    expect(saleTotal(posted.body.folio, posted.body.posted[0])).toBe(consumed);
  });

  it("refuses to invent one the catalog does not hold", async () => {
    await as("RECEPTIONIST", "post", serviceItemsPath(sellingStayId), {
      code: "MINIBAR",
      quantity: 1,
    }).expect(400);
  });

  it("refuses a code nothing is sold under", async () => {
    await as("RECEPTIONIST", "post", serviceItemsPath(sellingStayId), {
      code: "NO_SUCH_ITEM",
      quantity: 1,
    }).expect(404);
  });

  it("refuses a count that is not a whole item", async () => {
    for (const quantity of [0, -1, 1.5]) {
      await as("RECEPTIONIST", "post", serviceItemsPath(stayId), {
        code: "BREAKFAST",
        quantity,
      }).expect(400);
    }
  });
});

describe("an amount the routes refuse", () => {
  it("refuses a charge of nothing or less", async () => {
    for (const grossAmount of ["0", "-1"]) {
      await as("RECEPTIONIST", "post", `${folioPath(stayId)}/charges`, {
        grossAmount,
        description: "A night that costs nothing",
      }).expect(400);
    }
  });

  it("refuses a payment of nothing or less", async () => {
    for (const amount of ["0", "-1"]) {
      await as("RECEPTIONIST", "post", `${folioPath(stayId)}/payments`, {
        amount,
        description: "A receipt nobody issued",
      }).expect(400);
    }
  });

  it("refuses an amount that is not whole đồng", async () => {
    // A JSON number rather than the decimal text the codec decodes, and a
    // fraction of a đồng — VND has no minor unit, so neither is an amount.
    for (const grossAmount of [1_000_000, "1000.50"]) {
      await as("RECEPTIONIST", "post", `${folioPath(stayId)}/charges`, {
        grossAmount,
        description: "Not whole đồng",
      }).expect(400);
    }
  });

  it("refuses a line with nothing written on it", async () => {
    // The description is what the guest reads on the invoice, and a blank one
    // is a required field filled in with nothing.
    await as("RECEPTIONIST", "post", `${folioPath(stayId)}/charges`, {
      grossAmount: A_CHARGE.toString(),
      description: "   ",
    }).expect(400);
  });
});

describe("agreeing the account", () => {
  beforeAll(() => {
    // The provider is taken away for every case below, and left away. Nothing
    // in this suite draws an invoice — `EInvoiceJob` runs on a schedule pg-boss
    // does not start under `NODE_ENV=test` — so the only thing this can break is
    // a close that reached for an issuer, which is the thing it is here to
    // catch. `folio-close.e2e-spec.ts` owns what the job does once it runs.
    issuer.down = true;
  });

  afterAll(() => {
    issuer.down = false;
  });

  it("refuses a stay whose account has not been settled", async () => {
    const bookingId = await aStay();

    await postCharge(bookingId, A_CHARGE, "One night, not yet paid for");

    const refusal = await as("RECEPTIONIST", "post", closurePath(bookingId));

    expect(refusal.status).toBe(409);
    // The service's own sentence, carrying the figure still outstanding — the
    // one thing a receptionist can act on. The route composes no refusal of its
    // own: a second wording of this would be a second answer to keep level with
    // the ledger, and the figure in it would be read outside the row lock that
    // makes the figure true.
    expect(refusal.body.message).toContain(A_CHARGE.toString());

    // Nothing half-happened. A folio left `CLOSED` on a refused close is an
    // account no line can be added to and no invoice can be drawn from.
    const account = await readFolio(bookingId);

    expect(account.state).toBe("OPEN");
    expect(account.closedAt).toBeNull();
  });

  it("refuses a stay no account has been opened for", async () => {
    // The service's refusal and not the read's: a folio is opened by the first
    // thing posted to it, so there is nothing here to agree.
    const bookingId = await aStay();
    const refusal = await as("RECEPTIONIST", "post", closurePath(bookingId));

    expect(refusal.status).toBe(404);
  });

  it("agrees one that comes to nothing, and answers with the closed account", async () => {
    const bookingId = await aSettledStay();

    const response = await as(
      "RECEPTIONIST",
      "post",
      closurePath(bookingId),
    ).expect(200);

    const agreed: Folio = response.body;

    expect(agreed.bookingId).toBe(bookingId);
    expect(agreed.state).toBe("CLOSED");
    expect(agreed.closedAt).not.toBeNull();
    expect(BigInt(agreed.summary.outstanding)).toBe(0n);

    // The lines travel back with it. They are what the invoice will be drawn
    // from, and they are read on the connection that closed the account rather
    // than by a second call that would be a later moment.
    expect(agreed.postings.length).toBeGreaterThan(0);

    // The instant is Postgres' and not this process's, so this is a window
    // rather than an equality — what it proves is that the moment came out of
    // the close and not out of a fixture.
    expect(new Date(agreed.closedAt!).getTime()).toBeGreaterThan(0);
  });

  it("asks the invoice provider nothing, even to agree an account", async () => {
    // `FR-FOL-04`: a provider timeout never rolls back a checkout. The provider
    // here is not slow but refusing outright, which is the same failure with the
    // waiting taken out, and the close is untouched by it — issuance was never
    // in this transaction. `e-invoice.job.ts` calls the committed row the
    // enqueue, and the row is what the assertions below read.
    //
    // First that the recorder is what the graph would actually hand a caller
    // reaching for an issuer. Without this the empty list further down is a fact
    // about an override that silently did not take, which is the one way a claim
    // of the form "nothing was called" can pass while being false.
    expect(app.get<EInvoicePort>(E_INVOICE_PORT)).toBe(issuer);

    const bookingId = await aSettledStay();

    const response = await as(
      "RECEPTIONIST",
      "post",
      closurePath(bookingId),
    ).expect(200);

    expect((response.body as Folio).state).toBe("CLOSED");

    // The direct form of the claim: the route made no call at all. A close that
    // awaited the issuer would have thrown against a provider that is down, and
    // the 200 above would already have failed — this says the stronger thing,
    // that it would not have called even one that answered.
    expect(issuer.asked).toEqual([]);

    // Closed and awaiting a number, which is the request the sweep drains.
    const enqueued = await folioRowOf(bookingId);

    expect(enqueued?.state).toBe("CLOSED");
    expect(enqueued?.invoiceReference).toBeNull();
  });

  it("agrees the account once, however often the desk asks", async () => {
    const bookingId = await aSettledStay();

    const first = await as(
      "RECEPTIONIST",
      "post",
      closurePath(bookingId),
    ).expect(200);

    const agreed: Folio = first.body;
    const second = await as("MANAGER", "post", closurePath(bookingId));

    // Refused rather than quietly accepted, and the refusal names when the
    // first close happened: a desk that closes twice has one stay it thinks is
    // still open, and a person needs to know which checkout they are looking at.
    expect(second.status).toBe(409);
    expect(second.body.message).toContain(agreed.closedAt);

    // The row is exactly as the first close left it. That row *is* the request
    // for an invoice — one stay, closed, still awaiting a number — so an
    // unchanged row is the whole of "no second document was asked for". A second
    // `closedAt` would also be a second date on a legal instrument.
    const after = await folioRowOf(bookingId);

    expect(after?.closedAt?.toISOString()).toBe(agreed.closedAt);
    expect(after?.invoiceReference).toBeNull();
    expect(issuer.asked).toEqual([]);
  });

  it("leaves the agreed account taking no further lines", async () => {
    // `FR-FOL-01`'s other half, over the route the desk actually uses: the
    // ledger's trigger refuses the posting, and the service reads that refusal
    // back as a sentence rather than a fault.
    const bookingId = await aSettledStay();

    await as("RECEPTIONIST", "post", closurePath(bookingId)).expect(200);

    const refused = await as(
      "RECEPTIONIST",
      "post",
      `${folioPath(bookingId)}/charges`,
      {
        grossAmount: A_CHARGE.toString(),
        description: "A night keyed after the account was agreed",
      },
    );

    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain("closed");

    // And the account still settles, because nothing was written.
    expect(BigInt((await readFolio(bookingId)).summary.outstanding)).toBe(0n);
  });
});
