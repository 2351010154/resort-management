// The message a guest gets when their hold is paid for, and the five things
// that must be true of it.
//
// 1. **It is never sent about a stay that was not confirmed.** The transaction
//    the confirmation runs in goes on to post the payment to a folio, and that
//    posting can refuse. The queue is not in that transaction — pg-boss commits
//    on its own connection — so a message handed over inside it would outlive
//    the rollback and carry two links whose rows went back with it. That is why
//    every case below runs through `TransactionRunner`, which is what the
//    payment callback uses and what holds the message back until the commit.
// 2. **It is queued, never sent.** The trigger runs on a payment gateway's
//    callback, inside the transaction that took the money. A round trip to the
//    mail vendor there is a callback the gateway may time out and redeliver, so
//    the mailer must not be touched at all — asserted by handing the service a
//    mailer that throws if anything reaches it.
// 3. **Nothing about it can cost the guest their booking.** A queue that refuses
//    the message leaves the stay `CONFIRMED`. The guest has paid.
// 4. **It branches on whether the address is registered, and only there.** An
//    unknown address is offered an account; a known one is not. The two links it
//    carries are real — both are redeemed here rather than pattern-matched.
// 5. **No address, no message.** `contact_email` and `contact_name` are null
//    together on every stay the desk took, and a walk-in must not produce a
//    confirmation addressed to nobody.
// 6. **Both doors onto `HELD → CONFIRMED` send it, and between them they send it
//    once.** A gateway callback is one; a receptionist confirming a transfer the
//    property received off-line is the other, and the guest behind it is a funnel
//    guest who named an address and is owed the same message. The message hangs
//    off the transition, so the second door inherits it and a second press says
//    nothing.
//
// A real Postgres, because four of the five are claims about rows: the stay a
// rollback must take back, the link table the mail's URLs address, the account
// table the branch reads, and the booking that must survive a refused send.

import "reflect-metadata";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PinoLogger } from "nestjs-pino";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env.js";
import type { Database, DbExecutor } from "../../database/database.module.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { booking } from "../../database/schema/booking.js";
import { bookingLink } from "../../database/schema/booking-link.js";
import { guestUser } from "../../database/schema/index.js";
import * as schema from "../../database/schema/index.js";
import { roomType } from "../../database/schema/inventory.js";
import { BookingTokenService } from "../auth/booking-token/booking-token.service.js";
import type { BookingCancellationService } from "../notification/booking-cancellation.service.js";
import { BookingConfirmationService } from "../notification/booking-confirmation.service.js";
import type { MailQueue } from "../notification/mail-queue.service.js";
import type { MailerService, OutgoingEmail } from "../notification/mailer.service.js";
import type { AssignmentService } from "./assignment.service.js";
import { BookingService } from "./booking.service.js";
import type { BusinessDateService } from "./business-date.service.js";
import type { GuestService } from "../guest/guest.service.js";
import type { TierDerivationService } from "../guest/tier-derivation.service.js";
import type { HousekeepingService } from "../housekeeping/housekeeping.service.js";
import type { InventoryService } from "../inventory/inventory.service.js";
import type { FolioPort } from "./ports/folio.port.js";
import type { StayQuoteService } from "./stay-quote.service.js";

const SECRET = "a-secret-at-least-thirty-two-characters-long";
const WEB_ORIGIN = "https://mariva.test";

const CHECK_IN = "2027-05-10";
const CHECK_OUT = "2027-05-13";

const REGISTERED = "already.registered@mariva.test";
const UNREGISTERED = "never.registered@mariva.test";

/** Better Auth's own shape for an id: 32 base-62 characters, not a UUID. */
const AN_ACCOUNT = "3Xk2p9QwR7tL1sVn4cB8dF6hJ0mZyU5e";

let pool: pg.Pool;
let db: Database;
let transactions: TransactionRunner;
let tokens: BookingTokenService;
let roomTypeId: string;
let referenceOrdinal = 0;

/** A mailer that must never be reached. The whole point of the queue is that
 *  this call does not happen on the callback's path. */
const mailerThatMustNotBeUsed = {
  send: () => {
    throw new Error(
      "the confirmation was sent inline. It must be queued: this runs inside " +
        "the transaction confirming a booking, on a payment gateway callback.",
    );
  },
} as unknown as MailerService;

const silentLogger = { error: vi.fn() } as unknown as PinoLogger;

/** The service under test, over a queue that records what it was handed. */
function confirmerOver(enqueue: MailQueue["enqueue"]): BookingService {
  return new BookingService(
    undefined as unknown as InventoryService,
    undefined as unknown as StayQuoteService,
    undefined as unknown as BusinessDateService,
    undefined as unknown as AssignmentService,
    undefined as unknown as GuestService,
    undefined as unknown as HousekeepingService,
    undefined as unknown as FolioPort,
    { WEB_ORIGIN } as Env,
    tokens,
    new BookingConfirmationService(
      mailerThatMustNotBeUsed,
      { enqueue } as MailQueue,
      silentLogger,
    ),
    // Unreached: no case here sells a stay, so no tier is derived.
    undefined as unknown as TierDerivationService,
    // Unreached: this file confirms stays and cancels none.
    undefined as unknown as BookingCancellationService,
  );
}

/** A held stay, optionally naming somebody to write to. */
async function aHold(
  contact: { email: string; name: string } | null,
): Promise<{ id: string; reference: string }> {
  referenceOrdinal += 1;

  const [row] = await db
    .insert(booking)
    .values({
      reference: `MRV-20270510-${String(referenceOrdinal).padStart(4, "0")}`,
      state: "HELD",
      roomTypeId,
      checkInDate: CHECK_IN,
      checkOutDate: CHECK_OUT,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 5_400_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
      holdExpiresAt: new Date(Date.now() + 900_000),
      contactEmail: contact?.email ?? null,
      contactName: contact?.name ?? null,
    })
    .returning({ id: booking.id, reference: booking.reference });

  return row!;
}

/**
 * The credential inside a URL this file's own code composed — read off the
 * fragment, which is where it has to be.
 *
 * A query string is part of the request line and the web tier writes it to an
 * access log; a fragment is never transmitted at all. So this reads `hash` and
 * nothing else, and a mint that moved the credential back into the query would
 * fail here rather than quietly start logging a live stay credential.
 */
function linkIn(url: string, parameter: string): string {
  const address = new URL(url);
  const value = new URLSearchParams(address.hash.replace(/^#/, "")).get(
    parameter,
  );

  if (!value) {
    throw new Error(`no ${parameter} in the fragment of ${address.pathname}`);
  }

  return value;
}

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });
  // The boundary the payment callback opens. The confirmation is only queued
  // once this commits, so a case that opened its own transaction here would be
  // asserting on a message the running system does not send at that moment.
  transactions = new TransactionRunner(db);
  tokens = new BookingTokenService({
    BETTER_AUTH_SECRET: SECRET,
    NODE_ENV: "test",
  } as Env);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await db.execute(
    sql`truncate booking_link, room_assignment, booking_night, booking, type_inventory, room, room_type, guest_session, guest_account, guest_user restart identity cascade`,
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
    name: "Trần Minh Anh",
    email: REGISTERED,
    emailVerified: true,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool?.end();
});

describe("the confirmation a paid hold sends", () => {
  it("says nothing when the transaction that confirmed the stay rolls back", async () => {
    const queued: OutgoingEmail[] = [];
    const stay = await aHold({ email: UNREGISTERED, name: "Nguyễn An" });

    const confirmer = confirmerOver(async (email) => {
      queued.push(email);
    });

    // The order `payment.service.ts` runs in: the hold is confirmed, and then
    // the money is posted to a folio. A posting that refuses is not an exotic
    // case — it is the live one, and it takes the confirmation with it.
    const postPaymentToFolio = async (_exec: DbExecutor): Promise<void> => {
      throw new Error("the folio would not take the posting");
    };

    await expect(
      transactions.run(async (exec) => {
        await confirmer.confirmPaidHold(exec, stay.id);
        await postPaymentToFolio(exec);
      }),
    ).rejects.toThrow("the folio would not take the posting");

    expect(
      queued,
      "The stay is still held and the two links the message advertises were " +
        "rolled back with it. A guest who receives it follows a link that is " +
        "already dead, about a booking nobody confirmed.",
    ).toHaveLength(0);

    const [row] = await db
      .select({ state: booking.state })
      .from(booking)
      .where(eq(booking.id, stay.id));

    expect(row!.state).toBe("HELD");

    const links = await db
      .select({ purpose: bookingLink.purpose })
      .from(bookingLink)
      .where(eq(bookingLink.bookingId, stay.id));

    expect(links).toHaveLength(0);
  });

  it("is handed to the queue and never to the mailer", async () => {
    const queued: OutgoingEmail[] = [];
    const stay = await aHold({ email: UNREGISTERED, name: "Nguyễn An" });

    await transactions.run((exec) =>
      confirmerOver(async (email) => {
        queued.push(email);
      }).confirmPaidHold(exec, stay.id),
    );

    expect(queued).toHaveLength(1);
    expect(queued[0]!.to).toBe(UNREGISTERED);
    expect(queued[0]!.subject).toContain(stay.reference);
    expect(queued[0]!.text).toContain(stay.reference);
  });

  it("leaves the booking confirmed when the queue refuses the message", async () => {
    const stay = await aHold({ email: UNREGISTERED, name: "Nguyễn An" });

    await transactions.run((exec) =>
      confirmerOver(() => {
        throw new Error("the queue is unavailable");
      }).confirmPaidHold(exec, stay.id),
    );

    const [row] = await db
      .select({ state: booking.state })
      .from(booking)
      .where(eq(booking.id, stay.id));

    // The guest has paid. A message the property could not hand over must not
    // take the stay it was about with it.
    expect(row!.state).toBe("CONFIRMED");
  });

  it("says nothing at all for a stay nobody named a contact on", async () => {
    const queued: OutgoingEmail[] = [];
    const walkIn = await aHold(null);

    await transactions.run((exec) =>
      confirmerOver(async (email) => {
        queued.push(email);
      }).confirmPaidHold(exec, walkIn.id),
    );

    expect(
      queued,
      "A booking with no contact address is a walk-in the desk took. There is " +
        "nowhere to send a confirmation, and inventing a recipient is worse " +
        "than sending nothing.",
    ).toHaveLength(0);
  });

  it("says nothing a second time, because only the first callback transitions", async () => {
    const queued: OutgoingEmail[] = [];
    const stay = await aHold({ email: UNREGISTERED, name: "Nguyễn An" });

    const confirmer = confirmerOver(async (email) => {
      queued.push(email);
    });

    await transactions.run((exec) => confirmer.confirmPaidHold(exec, stay.id));
    await transactions.run((exec) => confirmer.confirmPaidHold(exec, stay.id));

    // A redelivered callback is the transition that already happened, and a
    // second confirmation would be the guest told twice about one payment.
    expect(queued).toHaveLength(1);
  });
});

/**
 * The other door onto the same transition, and the reason the message hangs off
 * the transition rather than off the payment.
 *
 * A guest who pays by bank transfer completes the funnel, names an address and
 * waits; the money arrives out of band and a receptionist confirms the hold. No
 * gateway callback is involved anywhere in that, and the guest is owed exactly
 * what a card-paying guest is owed — most of all the stay link, which is the only
 * way back to a paid booking from a browser whose cookie is gone.
 */
describe("the confirmation the front desk's own confirm sends", () => {
  it("announces a hold a receptionist confirmed, with no callback involved", async () => {
    const queued: OutgoingEmail[] = [];
    const stay = await aHold({ email: UNREGISTERED, name: "Nguyễn An" });

    await transactions.run((exec) =>
      confirmerOver(async (email) => {
        queued.push(email);
      }).confirm(exec, stay.id),
    );

    expect(
      queued,
      "A guest who paid by transfer gave the property an address and got " +
        "nothing back. Their stay link is the only way into a paid booking " +
        "from a browser that lost its cookie, and it was never minted.",
    ).toHaveLength(1);
    expect(queued[0]!.to).toBe(UNREGISTERED);
    expect(queued[0]!.subject).toContain(stay.reference);

    // Real links, against the table they address.
    const links = await db
      .select({ purpose: bookingLink.purpose })
      .from(bookingLink)
      .where(eq(bookingLink.bookingId, stay.id));

    expect(links.map((link) => link.purpose).sort()).toEqual([
      "ACCOUNT_CREATE",
      "STAY_REISSUE",
    ]);
  });

  it("says nothing when the desk presses confirm on a stay a callback already confirmed", async () => {
    const queued: OutgoingEmail[] = [];
    const stay = await aHold({ email: UNREGISTERED, name: "Nguyễn An" });

    const confirmer = confirmerOver(async (email) => {
      queued.push(email);
    });

    await transactions.run((exec) => confirmer.confirmPaidHold(exec, stay.id));
    await transactions.run((exec) => confirmer.confirm(exec, stay.id));

    // Both doors make one transition, so the guest hears about it once. A
    // message per press would be the property mailing a guest every time a
    // receptionist opened their booking.
    expect(queued).toHaveLength(1);
  });

  it("says nothing when a callback lands on a stay the desk already confirmed", async () => {
    const queued: OutgoingEmail[] = [];
    const stay = await aHold({ email: UNREGISTERED, name: "Nguyễn An" });

    const confirmer = confirmerOver(async (email) => {
      queued.push(email);
    });

    await transactions.run((exec) => confirmer.confirm(exec, stay.id));
    await transactions.run((exec) => confirmer.confirmPaidHold(exec, stay.id));

    expect(queued).toHaveLength(1);
  });

  it("says nothing at all for a stay nobody named a contact on", async () => {
    const queued: OutgoingEmail[] = [];
    const walkIn = await aHold(null);

    await transactions.run((exec) =>
      confirmerOver(async (email) => {
        queued.push(email);
      }).confirm(exec, walkIn.id),
    );

    // The desk's own path is the one this matters on: a walk-in confirmed at
    // the counter has nowhere to write, and an assertion here would be a 500 on
    // the most ordinary booking the property takes.
    expect(queued).toHaveLength(0);

    const links = await db
      .select({ purpose: bookingLink.purpose })
      .from(bookingLink)
      .where(eq(bookingLink.bookingId, walkIn.id));

    expect(links).toHaveLength(0);
  });
});

describe("the account step the confirmation carries", () => {
  it("offers to create one when the address has no account", async () => {
    const queued: OutgoingEmail[] = [];
    const stay = await aHold({ email: UNREGISTERED, name: "Nguyễn An" });

    await transactions.run((exec) =>
      confirmerOver(async (email) => {
        queued.push(email);
      }).confirmPaidHold(exec, stay.id),
    );

    const message = queued[0]!;
    const invitation = message.text.match(/https:\S*#invitation=\S+/)?.[0];

    expect(invitation).toBeDefined();

    // Real, not a shape. The link is redeemed against the table it addresses.
    expect(
      await tokens.redeemAccountLink(db, linkIn(invitation!, "invitation")),
    ).toEqual({ bookingId: stay.id });
  });

  it("does not offer one when the address already has an account", async () => {
    const queued: OutgoingEmail[] = [];
    const stay = await aHold({ email: REGISTERED, name: "Trần Minh Anh" });

    await transactions.run((exec) =>
      confirmerOver(async (email) => {
        queued.push(email);
      }).confirmPaidHold(exec, stay.id),
    );

    expect(queued[0]!.text).not.toContain("invitation=");
    expect(queued[0]!.html).not.toContain("invitation=");

    // And no link was minted either, which is the half a body assertion would
    // miss: a create link written and then left out of the message would be an
    // hour-long standing credential nobody knows exists.
    const links = await db
      .select({ purpose: bookingLink.purpose })
      .from(bookingLink)
      .where(eq(bookingLink.bookingId, stay.id));

    expect(links.map((link) => link.purpose)).toEqual(["STAY_REISSUE"]);
  });

  it("matches an account whose address differs only in case", async () => {
    const queued: OutgoingEmail[] = [];
    const stay = await aHold({
      email: REGISTERED.toUpperCase(),
      name: "Trần Minh Anh",
    });

    await transactions.run((exec) =>
      confirmerOver(async (email) => {
        queued.push(email);
      }).confirmPaidHold(exec, stay.id),
    );

    // `guest_user` is unique on `lower(email)`, so an offer to create a second
    // account here would be an offer the unique index then refuses.
    expect(queued[0]!.text).not.toContain("invitation=");
  });
});

describe("the stay link the confirmation carries", () => {
  it("re-issues the credential for the booking it was sent about", async () => {
    const queued: OutgoingEmail[] = [];
    const stay = await aHold({ email: UNREGISTERED, name: "Nguyễn An" });

    await transactions.run((exec) =>
      confirmerOver(async (email) => {
        queued.push(email);
      }).confirmPaidHold(exec, stay.id),
    );

    const stayUrl = queued[0]!.text.match(/https:\S*#stay=\S+/)?.[0];

    expect(stayUrl).toBeDefined();
    expect(stayUrl).toContain(`${WEB_ORIGIN}/bookings/${stay.reference}`);

    const reissued = await tokens.redeemStayLink(db, linkIn(stayUrl!, "stay"));

    expect(reissued).toMatchObject({
      bookingId: stay.id,
      reference: stay.reference,
    });

    // Once. A mailbox is copied, forwarded and left open.
    expect(await tokens.redeemStayLink(db, linkIn(stayUrl!, "stay"))).toBeNull();
  });
});

/**
 * Where the credential sits in the address the guest's browser requests.
 *
 * The one property that is a deployment fact rather than a shape: everything
 * before the `#` is the request line, and the web tier writes the request line
 * to its access log. A stay credential is good for seven days past checkout and
 * opens a booking to read, to cancel and to pay against, so a copy of it in a
 * log is a copy in every place that log is shipped to. Nothing between the
 * mailbox and the page is trusted with it, and a fragment is how that is stated
 * to a browser.
 */
describe("where a mailed credential travels in the URL", () => {
  it("puts neither link anywhere a server would be sent", async () => {
    const queued: OutgoingEmail[] = [];
    const stay = await aHold({ email: UNREGISTERED, name: "Nguyễn An" });

    await transactions.run((exec) =>
      confirmerOver(async (email) => {
        queued.push(email);
      }).confirmPaidHold(exec, stay.id),
    );

    const message = queued[0]!;

    const mailed = [
      { url: message.text.match(/https:\S*#stay=\S+/)![0], param: "stay" },
      {
        url: message.text.match(/https:\S*#invitation=\S+/)![0],
        param: "invitation",
      },
    ];

    for (const { url, param } of mailed) {
      const address = new URL(url);
      const credential = linkIn(url, param);

      // The request line, in full: a browser sends the path and the query and
      // stops at the `#`. So this is everything a server on the way could log.
      expect(`${address.pathname}${address.search}`).not.toContain(credential);
      expect(address.search).toBe("");
      expect(address.hash).toContain(encodeURIComponent(credential));
    }
  });
});

/**
 * A stay can gain an owner before it is paid for: a guest who is already
 * registered signs in while the hold is open, attaches it, and pays through
 * their session. Attaching gives up the anonymous credential, so by the time
 * the confirmation is composed the booking has an owner and no cookie of its
 * own — and both of the links this message normally carries are wrong for it.
 */
describe("the confirmation for a stay that already has an owner", () => {
  it("mails no credential at all, and points at the page instead", async () => {
    const queued: OutgoingEmail[] = [];
    const stay = await aHold({ email: UNREGISTERED, name: "Nguyễn An" });

    // What `attachToAccount` leaves behind: an owner, and the instant the
    // anonymous credential was surrendered. Written in that order, because
    // `booking_revokes_anonymous_access_only_with_an_account` refuses the
    // reverse.
    await db
      .update(booking)
      .set({ userId: AN_ACCOUNT, anonAccessRevokedAt: sql`now()` })
      .where(eq(booking.id, stay.id));

    await transactions.run((exec) =>
      confirmerOver(async (email) => {
        queued.push(email);
      }).confirmPaidHold(exec, stay.id),
    );

    const message = queued[0]!;

    expect(
      message.text,
      "A re-issue link minted for a surrendered stay is refused by the same " +
        "column on every redemption, so the message would advertise a " +
        "credential that cannot be spent.",
    ).not.toContain("#stay=");
    expect(
      message.text,
      "The stay already belongs to an account, so an offer to create the one " +
        "that keeps it is an offer about something that has happened.",
    ).not.toContain("#invitation=");

    // The way in is still named — the page itself, which its owner reaches by
    // signing in.
    expect(message.text).toContain(
      `${WEB_ORIGIN}/bookings/${encodeURIComponent(stay.reference)}`,
    );

    // And nothing was written either, which is the half a body assertion would
    // miss: a link minted and left out of the message is a standing row nobody
    // knows exists.
    const links = await db
      .select({ purpose: bookingLink.purpose })
      .from(bookingLink)
      .where(eq(bookingLink.bookingId, stay.id));

    expect(links).toHaveLength(0);
  });
});
