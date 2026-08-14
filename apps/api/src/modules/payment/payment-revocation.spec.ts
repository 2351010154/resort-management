// What giving up an anonymous credential costs the payment path, and what it
// must not cost an account.
//
// The read path was made to honour `anon_access_revoked_at` first, and this is
// the door beside it: `payment.open-attempt` is one of the five capabilities a
// booking-scoped credential carries, and the branch that resolves a stay from
// that credential asked the row nothing about revocation. A cookie left in a
// lobby browser could still open a payment page against a stay it no longer
// opens anywhere else.
//
// Three claims, and each needs a real Postgres because each is about a `where`
// clause rather than about a decision a service makes.
//
// 1. **A stay whose anonymous access has been given up cannot be paid for
//    through the credential that used to open it**, and the refusal reads
//    exactly like the one a credential naming somebody else's stay gets.
// 2. **An account is unaffected.** Revocation kills the loose copy of an
//    anonymous credential and says nothing about who owns the booking, so the
//    guest who has just attached the stay pays for it through their session
//    exactly as before — the half that would be quietly lost by writing the
//    predicate one conjunction too high.
// 3. **A stay nobody has revoked is still payable that way**, which is what
//    stops the first claim from being met by refusing everybody.
//
// Every case runs against a second stay that is *not* revoked, carrying the same
// quoted total. A scope clause that lost its booking id would find that row and
// answer with it, and the revoked case would pass on a stay it never named.
//
// The gateway is the one thing stood in for, and the boundary is the one
// `FR-PAY-01` draws — `vnpay.adapter.spec.ts` is where a real signature is
// earned. The folio, the ledger, the transaction and the booking service are all
// the genuine ones. The collaborators no case here reaches are handed nothing at
// all rather than a stand-in, for the reason `payment.service.spec.ts` gives
// about its folio: a case that wandered into one fails loudly instead of quietly
// agreeing with a fake.

import "reflect-metadata";

import type { VndAmount } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../config/env.js";
import type { Database } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { folio } from "../../database/schema/folio.js";
import { guestUser } from "../../database/schema/index.js";
import * as schema from "../../database/schema/index.js";
import { roomType } from "../../database/schema/inventory.js";
import { payment } from "../../database/schema/payment.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import type { BookingTokenService } from "../auth/booking-token/booking-token.service.js";
import type { AssignmentService } from "../booking/assignment.service.js";
import { BookingService } from "../booking/booking.service.js";
import type { BusinessDateService } from "../booking/business-date.service.js";
import type { FolioPort } from "../booking/ports/folio.port.js";
import type { StayQuoteService } from "../booking/stay-quote.service.js";
import { FolioService } from "../folio/folio.service.js";
import type { GuestService } from "../guest/guest.service.js";
import type { HousekeepingService } from "../housekeeping/housekeeping.service.js";
import type { InventoryService } from "../inventory/inventory.service.js";
import type { BookingConfirmationService } from "../notification/booking-confirmation.service.js";
import { SystemConfigService } from "../system-config/system-config.service.js";
import type { GatewayPaymentRequest } from "./payment.service.js";
import { PaymentService } from "./payment.service.js";
import type {
  CallbackVerification,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
} from "./ports/payment-gateway.port.js";

const CHECK_IN = "2027-05-10";
const CHECK_OUT = "2027-05-13";

/**
 * The account the stay is attached to before its cookie is given up — the order
 * the schema insists on, because revocation with nobody to sign in as would be
 * a lock-out.
 */
const AN_ACCOUNT = "8Qm4t7ZwK2pR6sBn1cV9dG3hJ5xYuL0e";

/** What the stay was quoted, and therefore the only amount a guest may open an
 *  attempt for. */
const STAY_TOTAL: VndAmount = 5_400_000n;

const RETURN_URL = "https://mariva.test/stay/payment/return";
const PAYER_ADDRESS = "203.0.113.44";

let pool: pg.Pool;
let db: Database;
let payments: PaymentService;
let bookings: BookingService;

let roomTypeId: string;

/** The stay under test, and the one beside it that nobody revokes. */
let stayId: string;
let anotherStayId: string;

let referenceOrdinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await db.execute(
    sql`truncate payment, folio_posting, folio, booking_link, room_assignment, booking_night, booking, type_inventory, room, room_type, guest_session, guest_account, guest_user restart identity cascade`,
  );

  const [deluxe] = await db
    .insert(roomType)
    .values({
      code: "DELUXE",
      name: "Deluxe",
      maxOccupancy: 2,
      beddingSleeps: 2,
      takesExtraBed: true,
      squareMetres: 34,
      bedding: "one king bed (1.80 m)",
      aspect: "garden",
      description: "A garden-facing room with a king bed.",
      displayOrder: 2,
    })
    .returning({ id: roomType.id });

  roomTypeId = deluxe!.id;

  await db.insert(guestUser).values({
    id: AN_ACCOUNT,
    name: "Lê Hoàng Nam",
    email: "hoang.nam@mariva.test",
    emailVerified: true,
  });

  bookings = new BookingService(
    undefined as unknown as InventoryService,
    undefined as unknown as StayQuoteService,
    undefined as unknown as BusinessDateService,
    undefined as unknown as AssignmentService,
    undefined as unknown as GuestService,
    undefined as unknown as HousekeepingService,
    undefined as unknown as FolioPort,
    undefined as unknown as Env,
    // Neither is reached here: the confirmation email is minted and queued only
    // by the transition a paid hold makes, which nothing in this file drives.
    undefined as unknown as BookingTokenService,
    undefined as unknown as BookingConfirmationService,
  );

  payments = new PaymentService(
    new GatewayUnderTest(),
    new FolioService(db, new SystemConfigService()),
    // Never reached: nothing here resolves a callback, and the business date is
    // read only when money has actually moved.
    undefined as unknown as BusinessDateService,
    bookings,
    new TransactionRunner(db),
  );
});

beforeEach(async () => {
  stayId = await aStayOfTheAccounts();
  anotherStayId = await aStayOfTheAccounts();
});

afterAll(async () => {
  // A posting cannot be deleted, so the ledger this file opened accounts on is
  // truncated on the way out — left standing, its folios hold bookings the next
  // file's fixtures cannot clear.
  await db.execute(
    sql`truncate payment, folio_posting, folio restart identity cascade`,
  );
  await pool?.end();
});

describe("a stay whose anonymous access has been given up", () => {
  it("was payable through the credential naming it, and then is not", async () => {
    const opened = await payments.createPaymentRequest(
      byCredentialFor(stayId, stayId),
    );

    expect(opened.paymentUrl).toContain(opened.reference);

    await bookings.revokeAnonymousAccess(db, stayId);

    const refusal = await refused(
      payments.createPaymentRequest(byCredentialFor(stayId, stayId)),
    );

    expect(refusal.code).toBe("FORBIDDEN");

    // The attempt opened before the cookie was given up, and nothing after it.
    // A refusal that had written a row would leave a `PENDING` attempt against a
    // stay the credential can no longer reach.
    expect(await attemptsOn(stayId)).toHaveLength(1);
  });

  it("is still payable by the account it was attached to", async () => {
    // The half that matters most. Revocation takes away the loose copy of an
    // anonymous credential; it says nothing about ownership, and a guest who has
    // just attached this booking would otherwise have lost the ability to pay
    // for it at the moment they gained the account.
    await bookings.revokeAnonymousAccess(db, stayId);

    const opened = await payments.createPaymentRequest({
      ...aRequestFor(stayId),
      guestAccountId: AN_ACCOUNT,
    });

    expect(opened.paymentUrl).toContain(opened.reference);
    expect(await attemptsOn(stayId)).toHaveLength(1);
  });

  it("is refused in the same words as a credential naming another stay", async () => {
    // Two different facts and one answer. A revoked cookie told anything the
    // mismatch is not told would learn that its booking is real and that
    // something about it changed — which is the same oracle the read path
    // refuses to be.
    await bookings.revokeAnonymousAccess(db, stayId);

    const revoked = await refused(
      payments.createPaymentRequest(byCredentialFor(stayId, stayId)),
    );

    const somebodyElses = await refused(
      payments.createPaymentRequest(byCredentialFor(anotherStayId, stayId)),
    );

    expect(revoked.code).toBe(somebodyElses.code);
    expect(revoked.message).toBe(somebodyElses.message);
  });
});

describe("a stay nobody has revoked", () => {
  it("is payable through the credential naming it", async () => {
    // The other direction, on a fixture that sits beside a revoked one in every
    // case above: the conjunct refuses a surrendered credential and nothing
    // else.
    await bookings.revokeAnonymousAccess(db, stayId);

    const opened = await payments.createPaymentRequest(
      byCredentialFor(anotherStayId, anotherStayId),
    );

    expect(opened.paymentUrl).toContain(opened.reference);
    expect(await attemptsOn(anotherStayId)).toHaveLength(1);
  });
});

/** What the funnel asks for: the whole stay, against the id in the path. */
function aRequestFor(bookingId: string): GatewayPaymentRequest {
  return {
    bookingId,
    amount: STAY_TOTAL,
    description: "The stay, paid before arrival",
    returnUrl: RETURN_URL,
    payerIpAddress: PAYER_ADDRESS,
    guestAccountId: null,
  };
}

/**
 * The same request made by a guest who never signed up — the credential names
 * `proven`, and the stay being paid for is `bookingId`.
 *
 * The two are separate arguments because they are separate facts: the
 * controller settles that a credential may only name its own booking, and this
 * file drives both the case where they agree and the case where they do not.
 */
function byCredentialFor(
  bookingId: string,
  proven: string,
): GatewayPaymentRequest {
  return { ...aRequestFor(bookingId), provenBookingId: proven };
}

/** A stay of the account's, the way the funnel leaves one that has been
 *  attached: an account behind it, and its cookie not yet given up. */
async function aStayOfTheAccounts(): Promise<string> {
  referenceOrdinal += 1;

  const [row] = await db
    .insert(booking)
    .values({
      reference: `MRV-PAYREV-${String(referenceOrdinal).padStart(4, "0")}`,
      userId: AN_ACCOUNT,
      state: "CONFIRMED",
      roomTypeId,
      checkInDate: CHECK_IN,
      checkOutDate: CHECK_OUT,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: STAY_TOTAL,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  return row!.id;
}

/** Every attempt opened against one stay's account. */
async function attemptsOn(
  bookingId: string,
): Promise<(typeof payment.$inferSelect)[]> {
  return await db
    .select(getTableColumns(payment))
    .from(payment)
    .innerJoin(folio, eq(folio.id, payment.folioId))
    .where(eq(folio.bookingId, bookingId));
}

/** The refusal a call provoked. Fails the case if the service accepted it. */
async function refused(
  work: Promise<unknown>,
): Promise<ORPCError<string, unknown>> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }

    throw error;
  }

  throw new Error("that payment was expected to be refused and was not");
}

/**
 * The port, answering the one question this file asks it: where to send a payer
 * whose attempt was allowed to open.
 *
 * Nothing here verifies anything — no case reaches a callback — and the address
 * carries the reference for the reason VNPay's does: it is what identifies the
 * attempt afterwards.
 */
class GatewayUnderTest implements PaymentGateway {
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return await Promise.resolve({
      paymentUrl: `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_TxnRef=${input.reference}`,
    });
  }

  async verifyCallback(): Promise<CallbackVerification> {
    return await Promise.resolve({ verified: false });
  }

  async refund(): Promise<never> {
    throw new Error("no case here refunds");
  }

  async queryTransaction(): Promise<never> {
    throw new Error("no case here queries the gateway");
  }
}
