// The desk sending a stay's account link again.
//
// Against a real Postgres, because almost everything this flow promises is a
// row or a constraint: the link that gets minted, the link that must not be
// minted when a refusal fires, the audit entry that has to arrive in the same
// commit as the link, and the foreign key that makes an unattributed send
// impossible rather than merely discouraged.
//
// The claims:
//
// 1. **An eligible stay gets a link and a message**, and the message is the
//    account link alone.
// 2. **Every refusal refuses and mints nothing.** A link row left behind by a
//    refused call is a credential in a mailbox nobody meant to send.
// 3. **The address is the booking's.** The call takes a stay and there is no
//    argument for anything else, which is the shape rather than a check.
// 4. **The send is attributed, and attribution is not optional.** A call with no
//    member of staff behind it takes the link down with it, because the audit
//    row and the link row are one transaction.
// 5. **Only staff reach the route.** A guest session, a booking token and no
//    principal at all are refused before the service is touched.
// 6. **The limiter refuses past its figure**, counting refused calls like any
//    other.
// 7. **What the queue holds is facts, not a body** — and the facts recompose
//    into exactly the message that would have been sent.

import "reflect-metadata";

import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { ExecutionContext } from "@nestjs/common";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withAuditActor } from "../../common/audit/audit-actor.js";
import type { Principal } from "../../common/auth/principal.js";
import type { Env } from "../../config/env.js";
import type { Database } from "../../database/database.module.js";
import { auditEntry } from "../../database/schema/audit.js";
import { booking } from "../../database/schema/booking.js";
import { bookingLink } from "../../database/schema/booking-link.js";
import { user as guestUser } from "../../database/schema/guest-auth.js";
import { staffUser } from "../../database/schema/identity.js";
import * as schema from "../../database/schema/index.js";
import { roomType } from "../../database/schema/inventory.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { AuditService } from "../audit/audit.service.js";
import { BookingTokenService } from "../auth/booking-token/booking-token.service.js";
import { AccountLinkMailService } from "../notification/account-link-mail.service.js";
import type { MailQueue } from "../notification/mail-queue.service.js";
import type { OutgoingEmail } from "../notification/mailer.service.js";
import {
  composeQueuedAccountLink,
  queuedAccountLink,
  type QueuedAccountLink,
} from "../notification/queued-account-link.js";
import type { AccountLinkEmailParams } from "../notification/templates/account-link-email.js";
import {
  ACCOUNT_LINK_RESEND_RATE_LIMIT_POLICY,
  AccountLinkResendRateLimitGuard,
} from "./account-link-resend-rate-limit.guard.js";
import { AccountLinkResendService } from "./account-link-resend.service.js";
import { AccountLinkController } from "./account-link.controller.js";

const SECRET = "a-secret-at-least-thirty-two-characters-long";
const WEB_ORIGIN = "https://mariva.test";

const CHECK_IN = "2027-05-10";
const CHECK_OUT = "2027-05-13";

/** Distinguishes this run's fixtures from whatever an earlier one left. */
const RUN = Date.now().toString(36);

/** A booking id nothing holds. */
const NO_SUCH_BOOKING = "00000000-0000-4000-8000-000000000000";

/** One handover, as the recording queue below saw it. */
interface HandedOver {
  readonly email: OutgoingEmail;
  readonly facts: AccountLinkEmailParams;
}

/**
 * A queue that records instead of delivering.
 *
 * Both arguments are kept, because the two are the whole contract of the
 * handover: the message a process with no queue would send now, and the facts a
 * job row may hold instead of it.
 */
class RecordingQueue {
  readonly handed: HandedOver[] = [];

  async enqueueAccountLink(
    email: OutgoingEmail,
    facts: AccountLinkEmailParams,
  ): Promise<void> {
    this.handed.push({ email, facts });
  }
}

let pool: pg.Pool;
let db: Database;
let tokens: BookingTokenService;
let queue: RecordingQueue;
let resends: AccountLinkResendService;
let controller: AccountLinkController;
let transactions: TransactionRunner;
let staffUserId: string;
let roomTypeId: string;
let referenceOrdinal = 0;

function nextAddress(): string {
  referenceOrdinal += 1;

  return `resent-link-${referenceOrdinal}-${RUN}@example.test`;
}

/** A confirmed stay with somewhere to write to, unattached and unrevoked. */
async function aStayWithNoAccount(
  contact: { email: string; name: string } | null = {
    email: nextAddress(),
    name: "Nguyễn An",
  },
): Promise<{ bookingId: string; reference: string; address: string | null }> {
  referenceOrdinal += 1;

  const reference = `MRV-20270510-${String(referenceOrdinal).padStart(4, "0")}`;

  const [row] = await db
    .insert(booking)
    .values({
      reference,
      state: "CONFIRMED",
      roomTypeId,
      checkInDate: CHECK_IN,
      checkOutDate: CHECK_OUT,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 5_400_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
      contactEmail: contact?.email ?? null,
      contactName: contact?.name ?? null,
    })
    .returning({ id: booking.id });

  return { bookingId: row!.id, reference, address: contact?.email ?? null };
}

/** The act, with a member of staff behind it, as the route performs it. */
async function resend(bookingId: string) {
  return await withAuditActor({ staffUserId }, async () =>
    await transactions.run((exec) => resends.resend(exec, bookingId)),
  );
}

/** Every account link this stay has, live or not. */
async function linksFor(bookingId: string) {
  return await db
    .select({ id: bookingLink.id, purpose: bookingLink.purpose })
    .from(bookingLink)
    .where(eq(bookingLink.bookingId, bookingId));
}

/** What the trail says about one link row. */
async function trailFor(rowId: string) {
  return await db
    .select({
      actorId: auditEntry.actorId,
      tableName: auditEntry.tableName,
      action: auditEntry.action,
      before: auditEntry.before,
      after: sql<string>`"after"::text`,
    })
    .from(auditEntry)
    .where(eq(auditEntry.rowId, rowId));
}

/** A request from one address, in the shape a guard reads. */
function fromAddress(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip, socket: {} }) }),
  } as unknown as ExecutionContext;
}

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString, max: 10 });
  db = drizzle({ client: pool, schema });

  tokens = new BookingTokenService({
    BETTER_AUTH_SECRET: SECRET,
    NODE_ENV: "test",
  } as Env);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await db.execute(
    sql`truncate booking_link, room_assignment, booking_night, booking, type_inventory, room, room_type restart identity cascade`,
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

  // A real row, because `audit_entry.actor_id` references it and the point of
  // several cases below is that the reference holds.
  const [receptionist] = await db
    .insert(staffUser)
    .values({
      email: `le.tan-${RUN}@mariva.test`,
      fullName: "Phạm Văn Dũng",
      role: "RECEPTIONIST",
      passwordHash: "not-a-hash-nothing-here-signs-in",
    })
    .returning({ id: staffUser.id });

  staffUserId = receptionist!.id;

  queue = new RecordingQueue();

  const mail = new AccountLinkMailService(
    queue as unknown as MailQueue,
    // Reached only when the handover itself throws, which nothing here does.
    { error: () => undefined } as never,
  );

  transactions = new TransactionRunner(db);
  resends = new AccountLinkResendService(
    { WEB_ORIGIN } as Env,
    tokens,
    mail,
    new AuditService(),
  );
  controller = new AccountLinkController(resends, transactions);
});

beforeEach(() => {
  referenceOrdinal += 1;
  queue.handed.length = 0;
});

afterAll(async () => {
  await pool?.end();
});

describe("an account link the desk sends again", () => {
  it("mints one link for the stay and hands one message over", async () => {
    const stay = await aStayWithNoAccount();

    const sent = await resend(stay.bookingId);

    expect(sent).toEqual({ to: stay.address, reference: stay.reference });

    const links = await linksFor(stay.bookingId);

    expect(links).toHaveLength(1);
    expect(links[0]!.purpose).toBe("ACCOUNT_CREATE");
    expect(queue.handed).toHaveLength(1);
  });

  it("goes to the address on the booking and to nothing a caller supplied", async () => {
    const stay = await aStayWithNoAccount();

    // The call takes a stay and an executor, and there is no third argument a
    // caller could put an address in. That is the guarantee — not a check
    // inside the service, which somebody could later move.
    expect(resends.resend.length).toBe(2);

    await resend(stay.bookingId);

    expect(queue.handed[0]!.email.to).toBe(stay.address);
    expect(queue.handed[0]!.facts.to).toBe(stay.address);
  });

  it("carries the account link and no other link at all", async () => {
    const stay = await aStayWithNoAccount();

    await resend(stay.bookingId);

    const { email } = queue.handed[0]!;
    const [link] = await linksFor(stay.bookingId);
    const expected = `${WEB_ORIGIN}/bookings/${stay.reference}/account#invitation=${encodeURIComponent(
      tokens.signLink(link!.id),
    )}`;

    expect(email.text).toContain(expected);
    expect(email.text.match(/https?:\/\/\S+/g)).toEqual([expected]);
  });

  it("leaves a link already outstanding exactly as it was", async () => {
    const stay = await aStayWithNoAccount();

    await resend(stay.bookingId);

    const [first] = await linksFor(stay.bookingId);

    await resend(stay.bookingId);

    const links = await linksFor(stay.bookingId);
    const [stillThere] = await db
      .select({ consumedAt: bookingLink.consumedAt })
      .from(bookingLink)
      .where(eq(bookingLink.id, first!.id));

    // Two live offers of one account, which is what `mintLink` inserting rather
    // than updating means. Whichever is followed attaches the stay and gives up
    // its anonymous access, and `liveLink` then refuses the other.
    expect(links).toHaveLength(2);
    expect(stillThere!.consumedAt).toBeNull();
  });
});

describe("a stay the desk may not send an account link for", () => {
  it("refuses one that already belongs to an account, and mints nothing", async () => {
    const stay = await aStayWithNoAccount();

    await db
      .update(booking)
      .set({ userId: await anAccountId() })
      .where(eq(booking.id, stay.bookingId));

    await expect(resend(stay.bookingId)).rejects.toThrow(
      /already belongs to a guest account/,
    );
    expect(await linksFor(stay.bookingId)).toHaveLength(0);
    expect(queue.handed).toHaveLength(0);
  });

  it("refuses one whose anonymous access has been given up, and mints nothing", async () => {
    const stay = await aStayWithNoAccount();

    await db
      .update(booking)
      .set({ userId: await anAccountId(), anonAccessRevokedAt: new Date() })
      .where(eq(booking.id, stay.bookingId));

    await expect(resend(stay.bookingId)).rejects.toThrow(
      /already belongs to a guest account/,
    );
    expect(await linksFor(stay.bookingId)).toHaveLength(0);
    expect(queue.handed).toHaveLength(0);
  });

  it("refuses when the address already has an account, and says so plainly", async () => {
    const address = nextAddress();
    const stay = await aStayWithNoAccount({ email: address, name: "Lê Thu" });

    await anAccountId(address);

    // Honest rather than uniform: the caller is a member of staff who can read
    // this booking already, and what they need to tell the guest is that there
    // is nothing to create.
    await expect(resend(stay.bookingId)).rejects.toThrow(
      /already an account for the address/,
    );
    expect(await linksFor(stay.bookingId)).toHaveLength(0);
    expect(queue.handed).toHaveLength(0);
  });

  it("refuses one with no contact address, and mints nothing", async () => {
    const stay = await aStayWithNoAccount(null);

    await expect(resend(stay.bookingId)).rejects.toThrow(
      /no contact email/,
    );
    expect(await linksFor(stay.bookingId)).toHaveLength(0);
    expect(queue.handed).toHaveLength(0);
  });

  it("refuses a booking id nothing holds", async () => {
    await expect(resend(NO_SUCH_BOOKING)).rejects.toThrow(
      /no booking with that id/,
    );
    expect(queue.handed).toHaveLength(0);
  });
});

describe("who the desk's send is filed against", () => {
  it("files the new link against the member of staff who caused it", async () => {
    const stay = await aStayWithNoAccount();

    await resend(stay.bookingId);

    const [link] = await linksFor(stay.bookingId);
    const [filed] = await trailFor(link!.id);

    expect(filed).toBeDefined();
    expect(filed!.actorId).toBe(staffUserId);
    expect(filed!.tableName).toBe("booking_link");
    expect(filed!.action).toBe("INSERT");
    expect(filed!.before).toBeNull();
    // The snapshot is the row as Postgres rendered it, so the stay it opens is
    // readable from the trail without joining anything.
    expect(filed!.after).toContain(stay.bookingId);
  });

  it("sends nothing at all when no member of staff is behind the call", async () => {
    const stay = await aStayWithNoAccount();

    // No `withAuditActor`. `AuditService` refuses, and because the link and the
    // audit row are one transaction the refusal takes the link with it — which
    // is the whole reason they share a commit.
    await expect(
      transactions.run((exec) => resends.resend(exec, stay.bookingId)),
    ).rejects.toThrow(/no member of staff behind it/);

    expect(await linksFor(stay.bookingId)).toHaveLength(0);
    expect(queue.handed).toHaveLength(0);
  });
});

describe("who may reach the route", () => {
  const refused = async (principal: Principal | null) => {
    const stay = await aStayWithNoAccount();

    await expect(
      withAuditActor({ staffUserId }, async () =>
        await call(controller.resendAccountLink(principal), {
          bookingId: stay.bookingId,
        }),
      ),
    ).rejects.toThrow(/Only a signed-in member of staff/);

    expect(await linksFor(stay.bookingId)).toHaveLength(0);
    expect(queue.handed).toHaveLength(0);
  };

  it("refuses a request carrying no principal at all", async () => {
    await refused(null);
  });

  it("refuses a signed-in guest", async () => {
    await refused({ realm: "guest", userId: "a-guest-account" } as Principal);
  });

  it("refuses a booking token, which opens one stay and is not a login", async () => {
    await refused({
      realm: "booking",
      bookingId: NO_SUCH_BOOKING,
      reference: "MRV-0000",
    } as Principal);
  });

  it("admits a member of staff", async () => {
    const stay = await aStayWithNoAccount();

    const sent = await withAuditActor({ staffUserId }, async () =>
      await call(
        controller.resendAccountLink({
          realm: "staff",
          userId: staffUserId,
        } as Principal),
        { bookingId: stay.bookingId },
      ),
    );

    expect(sent.to).toBe(stay.address);
    expect(await linksFor(stay.bookingId)).toHaveLength(1);
  });
});

describe("how often the desk may send one", () => {
  it("admits callers up to the figure and refuses them past it", () => {
    const guard = new AccountLinkResendRateLimitGuard({
      limit: 2,
      windowMs: 60_000,
    });
    const desk = fromAddress("203.0.113.7");

    expect(guard.canActivate(desk)).toBe(true);
    expect(guard.canActivate(desk)).toBe(true);
    expect(() => guard.canActivate(desk)).toThrow(/Too many account links/);
  });

  it("counts its own refusals, so a refused caller does not get a fresh start", () => {
    const guard = new AccountLinkResendRateLimitGuard({
      limit: 1,
      windowMs: 60_000,
    });
    const desk = fromAddress("203.0.113.8");

    expect(guard.canActivate(desk)).toBe(true);
    expect(() => guard.canActivate(desk)).toThrow();
    expect(() => guard.canActivate(desk)).toThrow();
  });

  it("counts each address separately", () => {
    const guard = new AccountLinkResendRateLimitGuard({
      limit: 1,
      windowMs: 60_000,
    });

    expect(guard.canActivate(fromAddress("203.0.113.9"))).toBe(true);
    expect(guard.canActivate(fromAddress("203.0.113.10"))).toBe(true);
  });

  it("names the policy token the module binds the figure to", () => {
    expect(ACCOUNT_LINK_RESEND_RATE_LIMIT_POLICY).toBe(
      "mariva:account-link-resend-rate-limit",
    );
  });
});

describe("what the queue is asked to hold", () => {
  it("holds the facts, and the facts recompose into the very message", async () => {
    const stay = await aStayWithNoAccount();

    await resend(stay.bookingId);

    const { email, facts } = queue.handed[0]!;
    const job: QueuedAccountLink = queuedAccountLink(facts, tokens);

    // Nothing spendable in the row: an opaque link id and the address with its
    // credential cut off, exactly as `queued-account-link.ts` argues.
    expect(job.account.url).not.toContain(tokens.signLink(job.account.linkId));
    expect(JSON.stringify(job)).not.toContain(
      tokens.signLink(job.account.linkId),
    );
    expect(composeQueuedAccountLink(job, tokens)).toEqual(email);
  });
});

/**
 * An account id, for the cases that need a stay to have an owner or an address
 * to be taken.
 *
 * Rows in Better Auth's own table, which this file does not truncate: other
 * suites share it, so the fixtures must not collide with what a previous run
 * left behind.
 */
async function anAccountId(address: string = nextAddress()): Promise<string> {
  referenceOrdinal += 1;

  const [created] = await db
    .insert(guestUser)
    .values({
      id: `${RUN}${String(referenceOrdinal)}`.padEnd(32, "0").slice(0, 32),
      name: "Nguyễn An",
      email: address,
      emailVerified: true,
    })
    .returning({ id: guestUser.id });

  return created!.id;
}
