// PayPal's two routes, against the answers PayPal's own delivery rules read.
//
// **What a webhook route can get wrong is not what a service can**, so the
// service is stood in for and every case here is a scripted answer. `FR-PAY-03`
// is enforced under the port — a conditional `UPDATE` and two partial unique
// indexes, proved against a real Postgres in `test/payment-service.e2e-spec.ts`
// — and this file's claim about a replay is the other half of it: that the
// controller adds no memory, no cache and no second opinion, so ten deliveries
// are ten identical calls and the row is what decides. A handler that quietly
// deduplicated would pass a database test and still be wrong here.
//
// So five claims, and each is a way this route could lose money or leak it:
//
// 1. **A delivery nothing verified posts nothing and is still answered 200.**
//    The route is on the public internet and unguarded; a `4xx` would tell
//    whoever posted it which of their guesses was closest, and PayPal would
//    spend three days retrying an event that can only ever fail the same way.
// 2. **The same webhook delivered ten times posts exactly once**, and the nine
//    redeliveries are answered rather than refused.
// 3. **The payer's return writes nothing at all** — no row, no account, no
//    attempt resolved, not so much as a question asked of the gateway. It is
//    reached with an order id a stranger can compose, and a route that acted on
//    one would let them mark a booking paid.
// 4. **A delivery with headers missing is refused without a throw**, because
//    that is most of what reaches an unguarded url and none of it is an
//    incident.
// 5. **A failure that is this property's own is answered as a non-2xx**, never
//    a 200 — a database away mid-callback, no credential configured for this
//    gateway, PayPal's own API unreachable. Those are exactly the failures a
//    retry fixes, and answering them 200 would be the one that gets a payment
//    lost: PayPal marks the delivery settled and never tries again.
//
// The status line is asserted on every path, which is the claim underneath all
// five: PayPal reads it and nothing else. What used to be true of both routes —
// that nothing thrown ever escaped — now holds only for the return and for the
// three refusals that are the caller's; a failure that is this property's own
// is rethrown on purpose, because that is the only way PayPal is told to bring
// the delivery back.

import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ORPCError } from "@orpc/nest";
import { getLoggerToken } from "nestjs-pino";
import request from "supertest";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { UNGUARDED_KEY } from "../../common/auth/access.decorators.js";
import { ENV, type Env, parseEnv } from "../../config/env.js";
import {
  type CallbackOutcome,
  disagreedAbout,
  PaymentService,
} from "./payment.service.js";
import { PaypalController } from "./paypal.controller.js";

const WEB_ORIGIN = "https://mariva.test";

/** Deliberately not the web origin, so a handler that reached for the wrong one
 *  builds a url this file can tell apart. */
const API_URL = "https://api.mariva.test";

const WEBHOOK_PATH = "/payments/paypal/webhook";
const RETURN_PATH = "/payments/paypal/return";

/**
 * The five headers PayPal signs a transmission with, as a real delivery
 * presents them.
 *
 * Written out in the capitals PayPal documents rather than in the lowercase the
 * handler matches, because that is what a real delivery puts on the wire and
 * because it is the assertion: HTTP header names are case-insensitive and a
 * controller comparing against the documentation verbatim would forward nothing
 * from any request Node ever parsed.
 */
const TRANSMISSION = {
  "PAYPAL-AUTH-ALGO": "SHA256withRSA",
  "PAYPAL-CERT-URL": "https://api.paypal.com/v1/notifications/certs/CERT-ABC",
  "PAYPAL-TRANSMISSION-ID": "d0a4d8e0-1c3b-11f0-8e7f-0a1b2c3d4e5f",
  "PAYPAL-TRANSMISSION-SIG": "not-checked-here",
  "PAYPAL-TRANSMISSION-TIME": "2027-11-02T09:12:00Z",
} as const;

/**
 * An event body as PayPal posts one — JSON over `POST`, not VNPay's query
 * string.
 *
 * The payer's own details are on it because they are on a real one, and because
 * a case below asserts they do not reach the log. Nothing here is signed: the
 * service is stood in for, and what it is *asked* is asserted rather than what
 * it makes of it.
 */
const AN_EVENT = {
  id: "WH-2WR32451HC0233532-67976317FL4543714",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: {
    id: "8JK92831HS4471912",
    custom_id: `${"0123456789abcdef".repeat(4)}@26150.5`,
    amount: { currency_code: "USD", value: "45.89" },
    payer: { email_address: "guest@example.invalid", payer_id: "QYR995RATS2SE" },
  },
} as const;

let app: INestApplication;
let handleIpn: Mock<PaymentService["handleIpn"]>;
let logged: { level: string; fields: unknown; message: unknown }[];

beforeEach(async () => {
  handleIpn = vi.fn<PaymentService["handleIpn"]>();
  logged = [];

  const moduleRef = await Test.createTestingModule({
    controllers: [PaypalController],
    providers: [
      { provide: PaymentService, useValue: { handleIpn } },
      { provide: ENV, useValue: environment() },
      // Captured rather than discarded, unlike `payment.controller.spec.ts`'s
      // sink. This route logs a header and must never log the body, and that is
      // a claim only a reader of what was written can make.
      {
        provide: getLoggerToken(PaypalController.name),
        useValue: {
          info: (fields: unknown, message: unknown) =>
            logged.push({ level: "info", fields, message }),
          warn: (fields: unknown, message: unknown) =>
            logged.push({ level: "warn", fields, message }),
          error: (fields: unknown, message: unknown) =>
            logged.push({ level: "error", fields, message }),
        },
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
});

afterEach(async () => {
  await app?.close();
});

describe("a webhook the property could act on", () => {
  const ANSWERS: readonly CallbackOutcome[] = [
    "RECORDED",
    "ALREADY_RECORDED",
    "REFUSED",
    "STILL_OPEN",
  ];

  for (const outcome of ANSWERS) {
    it(`answers 200 when the callback was ${outcome}`, async () => {
      // One status line for all four, unlike VNPay's three `RspCode` pairs.
      // PayPal reads the code and nothing in the body, so what a merchant can
      // say is "delivered" or "bring it again" — and every one of these was
      // understood and filed.
      handleIpn.mockResolvedValue(outcome);

      const response = await webhook();

      expect(response.status).toBe(200);
    });
  }

  it("hands the transmission headers and the event over as one record, nested", async () => {
    // The signature is computed over the five headers *and* the body as sent, so
    // neither half means anything without the other. Nested rather than merged
    // because the halves come from different places and only one of them is the
    // sender's: a body field named `paypal-transmission-sig` merged alongside
    // the real header would be a forger supplying the very value the check is
    // meant to test.
    //
    // The gateway travels beside it because this route is the only thing in the
    // request that knows which one is speaking.
    handleIpn.mockResolvedValue("RECORDED");

    await webhook();

    expect(handleIpn).toHaveBeenCalledWith(
      {
        headers: {
          "paypal-auth-algo": TRANSMISSION["PAYPAL-AUTH-ALGO"],
          "paypal-cert-url": TRANSMISSION["PAYPAL-CERT-URL"],
          "paypal-transmission-id": TRANSMISSION["PAYPAL-TRANSMISSION-ID"],
          "paypal-transmission-sig": TRANSMISSION["PAYPAL-TRANSMISSION-SIG"],
          "paypal-transmission-time": TRANSMISSION["PAYPAL-TRANSMISSION-TIME"],
        },
        event: AN_EVENT,
      },
      "PAYPAL",
    );
  });

  it("hands the event over exactly as it was parsed", async () => {
    // PayPal re-serialises the body to check the signature over it, so an event
    // this handler rebuilt — dropping an unknown field, reordering a key,
    // coercing a number — would verify against nothing, and the failure would
    // look identical to a forgery.
    handleIpn.mockResolvedValue("RECORDED");

    await webhook();

    const delivered = handleIpn.mock.calls[0]?.[0] as { event: unknown };

    expect(delivered.event).toEqual(AN_EVENT);
  });

  it("forwards none of the request's other headers", async () => {
    // What reaches the adapter is a request from the public internet, and
    // everything about it except those five is either irrelevant to the
    // signature or somebody else's business. A cookie a misdirected client
    // attached is the case worth naming: it is a credential, it is not part of
    // any signature, and it has no reason to travel further into this process.
    handleIpn.mockResolvedValue("RECORDED");

    await request(app.getHttpServer())
      .post(WEBHOOK_PATH)
      .set(TRANSMISSION)
      .set("cookie", "session=a-credential-that-is-not-paypals")
      .set("authorization", "Bearer not-paypals-either")
      .send(AN_EVENT);

    const delivered = handleIpn.mock.calls[0]?.[0] as {
      headers: Record<string, string>;
    };

    expect(Object.keys(delivered.headers).sort()).toEqual([
      "paypal-auth-algo",
      "paypal-cert-url",
      "paypal-transmission-id",
      "paypal-transmission-sig",
      "paypal-transmission-time",
    ]);
  });
});

describe("a webhook nothing verified", () => {
  beforeEach(() => {
    handleIpn.mockRejectedValue(
      new ORPCError("UNAUTHORIZED", {
        message: "that callback does not carry the gateway's signature",
      }),
    );
  });

  it("posts nothing and is still answered 200", async () => {
    // A forgery, a crawler, a scan, somebody's misconfigured sandbox. There is
    // nobody to report it to and nothing to write down about it beyond a log
    // line — and a `401` would be this property telling whoever posted it that
    // the signature was the part that failed.
    const response = await webhook();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({});
  });

  it("is not asked for again, because a redelivery could only fail the same way", async () => {
    // The claim behind the status line. PayPal retries on a non-2xx over three
    // days, and a delivery refused for its signature carries the same signature
    // every time. Asserted as the absence of a retryable code rather than as an
    // implementation detail: anything outside 2xx buys those three days.
    expect((await webhook()).status).toBeLessThan(300);
    expect((await webhook()).status).toBeGreaterThanOrEqual(200);
  });

  it("names the delivery in the log and nothing the sender wrote", async () => {
    // The body carries the payer's email address and their PayPal account id and
    // arrives on a route anyone may post to. What is written down is the
    // transmission id — a header, searchable in PayPal's own dashboard, stable
    // across a delivery's retries, and readable before verification precisely
    // because the sender did not choose it.
    await webhook();

    const written = JSON.stringify(logged);

    expect(logged[0]?.fields).toEqual({
      transmissionId: TRANSMISSION["PAYPAL-TRANSMISSION-ID"],
    });
    expect(written).not.toContain("guest@example.invalid");
    expect(written).not.toContain("QYR995RATS2SE");
    expect(written).not.toContain("PAYMENT.CAPTURE.COMPLETED");
  });
});

describe("a webhook PayPal delivers again", () => {
  it("posts exactly once however many times it arrives", async () => {
    // `FR-PAY-03`. The first delivery resolves the attempt and the nine after it
    // find a row that already records the same capture — the service says so,
    // and this file's claim is that the controller adds nothing of its own: no
    // memory between requests, no cache, no second opinion. Ten identical calls
    // reach the service, and the row is what decides.
    //
    // A controller that deduplicated would pass a database test and still be
    // wrong: it would not survive a second process, and it would be the answer
    // consulted when the two disagreed.
    // The stand-in keeps the one rule `FR-PAY-03` states — a posting per gateway
    // transaction id, and never a second — so the count below is the rule
    // applied to what this route actually delivered, rather than a script
    // agreeing with itself. Postgres holds the real one under two partial unique
    // indexes; this is the key it holds it on.
    const posted = new Set<string>();

    handleIpn.mockImplementation(async (callback) => {
      const capture = captureIn(callback);

      if (posted.has(capture)) {
        return "ALREADY_RECORDED";
      }

      posted.add(capture);

      return "RECORDED";
    });

    const answered: number[] = [];

    for (let attempt = 0; attempt < 10; attempt += 1) {
      answered.push((await webhook()).status);
    }

    expect(answered).toEqual(Array.from({ length: 10 }, () => 200));
    expect(handleIpn).toHaveBeenCalledTimes(10);
    expect(posted.size).toBe(1);

    // Ten identical hand-offs, which is the controller's whole part in this: it
    // remembers nothing between requests, so the tenth delivery is put to the
    // service exactly as the first was and the row is what tells them apart.
    const delivered = handleIpn.mock.calls.map(([callback]) => callback);

    expect(delivered).toEqual(
      Array.from({ length: 10 }, () => delivered[0]),
    );
  });
});

describe("a webhook the property would not act on", () => {
  const REFUSALS: readonly { readonly what: string; readonly error: unknown }[] = [
    {
      what: "names an attempt this property never opened",
      error: new ORPCError("NOT_FOUND", { message: "no such attempt" }),
    },
    {
      what: "contradicts what is already on file",
      error: new ORPCError("CONFLICT", {
        data: disagreedAbout("AMOUNT"),
        message: "nothing has been posted",
      }),
    },
  ];

  for (const { what, error } of REFUSALS) {
    it(`answers 200 to a callback that ${what}, without a throw`, async () => {
      // These two are the caller's, never this property's: a redelivery would
      // carry the same event and be refused the same way, so a retry buys
      // nothing and the route answers calmly instead of raising.
      handleIpn.mockRejectedValue(error);

      expect((await webhook()).status).toBe(200);
    });
  }

  it("writes down the disagreement the service named", async () => {
    // Loud on every reading of it: nothing was posted, and the attempt is
    // sitting in a state a person has to resolve. The transmission id is what
    // they will search PayPal's dashboard by.
    handleIpn.mockRejectedValue(
      new ORPCError("CONFLICT", {
        data: disagreedAbout("AMOUNT"),
        message: "the gateway reports an amount this property did not ask for",
      }),
    );

    await webhook();

    expect(logged[0]?.level).toBe("error");
    expect(logged[0]?.fields).toMatchObject({
      transmissionId: TRANSMISSION["PAYPAL-TRANSMISSION-ID"],
      disagreement: "AMOUNT",
    });
  });
});

describe("a failure that is this property's own", () => {
  // Every one of these is the property not yet being in a position to record a
  // payment, never a decision against one — a database away mid-callback, no
  // credential configured for this gateway, PayPal's own API refusing to say
  // whether a transmission is its own. A redelivery is the one thing that
  // fixes each of them, which is why none of them may be answered 200.
  const FAILURES: readonly { readonly what: string; readonly error: unknown }[] = [
    {
      what: "arrives at a deployment holding no PayPal credentials",
      error: new ORPCError("SERVICE_UNAVAILABLE", {
        status: 503,
        message: "PayPal is not configured",
      }),
    },
    {
      what: "arrives while PayPal's own API cannot be reached to check a signature",
      error: new ORPCError("BAD_GATEWAY", {
        status: 502,
        message: "PayPal could not be reached to say whether that event is its own",
      }),
    },
    {
      what: "arrives while this property's own database is away",
      error: new Error("connection terminated unexpectedly"),
    },
  ];

  for (const { what, error } of FAILURES) {
    it(`asks PayPal to redeliver a callback that ${what}`, async () => {
      // The point of the change: this property's own trouble must not be
      // answered as though the delivery were understood and settled. A `2xx`
      // here is exactly the failure mode that let a lost webhook go
      // unreported before this route rethrew.
      handleIpn.mockRejectedValue(error);

      const response = await webhook();

      expect(response.status).toBeGreaterThanOrEqual(300);
    });
  }

  it("tells PayPal nothing about what failed", async () => {
    // The route is unguarded, so the caller may be anyone. A message or a
    // stack in the body would be this property describing its internals to
    // whoever asked — and PayPal reads only the status line in any case.
    handleIpn.mockRejectedValue(
      new Error('relation "payment" does not exist at character 13'),
    );

    const response = await webhook();

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(JSON.stringify(response.body)).not.toContain("payment");
  });

  it("logs the transmission id before asking PayPal to try again", async () => {
    // A person triaging tomorrow searches PayPal's dashboard by this id and
    // requests the redelivery by hand once whatever failed has been fixed —
    // though PayPal's own three-day backoff will have already tried again by
    // then, which is the point.
    handleIpn.mockRejectedValue(new Error("connection terminated unexpectedly"));

    await webhook();

    expect(logged[0]?.level).toBe("error");
    expect(logged[0]?.fields).toMatchObject({
      transmissionId: TRANSMISSION["PAYPAL-TRANSMISSION-ID"],
    });
  });
});

describe("a delivery that does not look like PayPal's", () => {
  it("is refused without a throw when the transmission headers are missing", async () => {
    // Most of what reaches an unguarded url on the public internet. The handler
    // forwards the headers it found — none — the adapter finds a delivery it
    // cannot verify, and the answer is a log line rather than an exception. What
    // must not happen is a 500, which would be three days of PayPal retrying a
    // scan.
    handleIpn.mockRejectedValue(
      new ORPCError("UNAUTHORIZED", { message: "not the gateway speaking" }),
    );

    const response = await request(app.getHttpServer())
      .post(WEBHOOK_PATH)
      .send(AN_EVENT);

    expect(response.status).toBe(200);
    expect(handleIpn).toHaveBeenCalledWith(
      { headers: {}, event: AN_EVENT },
      "PAYPAL",
    );
  });

  it("is refused without a throw when only some of them arrived", async () => {
    // A partial transmission is not a signature over anything. Forwarded as what
    // it is rather than completed or rejected here: what a delivery consists of
    // is the adapter's business, and it answers `{ verified: false }` to one it
    // cannot find a header for.
    handleIpn.mockRejectedValue(
      new ORPCError("UNAUTHORIZED", { message: "not the gateway speaking" }),
    );

    const response = await request(app.getHttpServer())
      .post(WEBHOOK_PATH)
      .set("PAYPAL-TRANSMISSION-ID", TRANSMISSION["PAYPAL-TRANSMISSION-ID"])
      .send(AN_EVENT);

    expect(response.status).toBe(200);

    const delivered = handleIpn.mock.calls[0]?.[0] as {
      headers: Record<string, string>;
    };

    expect(Object.keys(delivered.headers)).toEqual(["paypal-transmission-id"]);
  });

  it("is refused without a throw when nothing at all was posted", async () => {
    // A bare scan: no headers, no body. It costs a refusal and a log line built
    // out of fields that are all absent — not an exception on the way to reading
    // one of them.
    handleIpn.mockRejectedValue(
      new ORPCError("UNAUTHORIZED", { message: "not the gateway speaking" }),
    );

    const response = await request(app.getHttpServer()).post(WEBHOOK_PATH);

    expect(response.status).toBe(200);
    expect(logged[0]?.fields).toEqual({ transmissionId: undefined });
  });
});

describe("where the payer's browser is sent", () => {
  it("writes nothing and resolves no attempt", async () => {
    // The claim this route exists to make. The webhook is the authority: it is
    // the delivery PayPal retries, it arrives whether or not the payer's browser
    // survived the round trip, and it is the only one carrying a signature. This
    // one reads a query parameter and redirects.
    const response = await payerReturn();

    expect(response.status).toBe(303);
    expect(handleIpn).not.toHaveBeenCalled();
  });

  it("carries nothing onward from an order id nobody signed", async () => {
    // `token` is PayPal's order id, on a url the payer can bookmark, edit or
    // send to somebody else, with no signature over it of any kind. Put on this
    // property's own page it would be a stranger choosing what the page talks
    // about — so it is read, and it goes no further.
    const location = new URL((await payerReturn()).headers.location);

    expect(location.origin).toBe(WEB_ORIGIN);
    // The funnel's door, and not a confirming screen: without a reference there
    // is no stay to open a page about, and this route has none it may trust.
    expect(location.pathname).toBe("/booking");
    expect(location.searchParams.get("payment")).toBe("confirming");
    expect(location.search).not.toContain("5O190127TN364715T");
    expect([...location.searchParams.keys()]).toEqual(["payment"]);
  });

  it("sends the payer to the same place when they cancelled instead", async () => {
    // PayPal gives an order's `returnUrl` and its `cancelUrl` the same value —
    // `paypal.adapter.ts` says why — so an approving payer and a cancelling one
    // arrive identically, and nothing on this path could tell them apart. The
    // caption is a caption, and the stay's own page tells them what happened.
    const response = await request(app.getHttpServer()).get(RETURN_PATH);

    expect(response.status).toBe(303);
    expect(new URL(response.headers.location).searchParams.get("payment")).toBe(
      "confirming",
    );
  });
});

describe("what stands in for a session on each route", () => {
  const ROUTES: readonly { readonly route: string; readonly says: RegExp }[] = [
    // The webhook's credential is the signature, verified by asking PayPal
    // itself — `FR-PAY-02`, and the reason an unsigned delivery is refused
    // rather than filed as a failed payment.
    { route: "webhook", says: /signature/i },
    // The return's is nothing at all, and the sentence has to say so: that is
    // precisely why the route decides nothing.
    { route: "payerReturn", says: /nothing stands in for a session/i },
  ];

  for (const { route, says } of ROUTES) {
    it(`says what admits a caller to the ${route}`, () => {
      // `rbac-matrix.md` §2 is deny-by-default, so a route outside it owes a
      // sentence a reviewer can disagree with. Read off the metadata rather than
      // off the source, because the decorator is what the guard reads.
      const reason = new Reflector().get<string>(
        UNGUARDED_KEY,
        PaypalController.prototype[route as keyof PaypalController],
      );

      expect(reason).toMatch(says);
    });
  }
});

/**
 * The capture a delivery names, as the stand-in above keys its one posting on.
 *
 * `FR-PAY-03`'s key is the gateway's transaction id, and on this gateway that is
 * the capture's — an order id names an intention, and a capture is the money
 * moving. Read out of the record the route handed over rather than off
 * {@link AN_EVENT}, so a controller that reshaped the event on the way through
 * would key on something else and the count would rise.
 */
function captureIn(callback: Record<string, unknown>): string {
  const event = callback.event as { resource?: { id?: string } } | undefined;

  return event?.resource?.id ?? "no capture in that delivery";
}

/** A webhook, as PayPal delivers one: JSON over `POST` under five headers. */
function webhook(): request.Test {
  return request(app.getHttpServer())
    .post(WEBHOOK_PATH)
    .set(TRANSMISSION)
    .send(AN_EVENT);
}

/** The payer's browser, redirected back by PayPal with the order id it minted. */
function payerReturn(): request.Test {
  return request(app.getHttpServer())
    .get(RETURN_PATH)
    .query({ token: "5O190127TN364715T", PayerID: "QYR995RATS2SE" });
}

/** Everything a boot needs, with the origin the payer is handed back to. */
function environment(): Env {
  return parseEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://mariva@localhost:5432/mariva",
    BETTER_AUTH_SECRET: "guest-realm-secret-of-quite-sufficient-length",
    STAFF_JWT_SECRET: "staff-realm-secret-that-differs-and-is-long",
    WEB_ORIGIN,
    API_URL,
  });
}
