// Three of the five routes this controller answers: the two VNPay calls,
// against the answers VNPay's specification says it reads, and the one the desk
// calls, on what it hands the service. The two reconciliation reads are proved
// against real rows in `test/payment-reconciliation-api.e2e-spec.ts`, because
// what they answer is a question about a database and nothing about them has a
// failure mode a stand-in could stage — only their declarations are asserted
// here, beside the other three.
//
// `test/payment-callbacks.e2e-spec.ts` drives the same two routes with real
// signatures, the real adapter, a real Postgres and the real guard, and that is
// where "a signed callback becomes money on an account" is proved. What cannot
// be proved there is the half of this handler that only runs when something has
// gone wrong: a database that went away mid-callback, a refusal the service does
// not raise yet, a disagreement of each of the three kinds. Those are the
// gateway's whole experience of a bad afternoon, and provoking them from a real
// database means breaking one on cue.
//
// So the service and the port are both stood in for here, and every case is a
// scripted answer. The claim under test is the mapping and nothing else: which
// pair each outcome and each refusal produces, that the status line is 200
// whatever happened, and that a payer's return decides nothing.
//
// **The expected codes are written out as digits.** Importing the library's
// constants to assert against the library's constants would pass whatever they
// said, including the day one of them changed. `00`, `01`, `02`, `04`, `97` and
// `99` are VNPay's published IPN table, and this file is where they are pinned.
//
// The third route is here for the two arguments the *caller* never supplies —
// the address the payer is handed back to, and the address the payer is calling
// from. Both are read off this process rather than off the body, and a body that
// could set either is the whole failure this file's last block guards against.
// `test/payment-api.e2e-spec.ts` proves the rest of it: the capability, the two
// realms, and an attempt that actually reaches the table.

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
import {
  CAPABILITY_KEY,
  type CapabilityRequirement,
  UNGUARDED_KEY,
} from "../../common/auth/access.decorators.js";
import { ENV, type Env, parseEnv } from "../../config/env.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { PaymentController } from "./payment.controller.js";
import {
  type CallbackDisagreement,
  type CallbackOutcome,
  disagreedAbout,
  PaymentService,
} from "./payment.service.js";
import type {
  CallbackVerification,
  PaymentGateway,
} from "./ports/payment-gateway.port.js";
import { PAYMENT_GATEWAY } from "./ports/payment-gateway.port.js";
import { ReconciliationService } from "./reconciliation.service.js";

const WEB_ORIGIN = "https://mariva.test";

/** Deliberately not the web origin, so a handler that reached for the wrong one
 *  builds a url this file can tell apart. */
const API_URL = "https://api.mariva.test";

/** The stay the desk is collecting against. */
const A_BOOKING = "9f1d4e2a-1c3b-4a5d-8e7f-0a1b2c3d4e5f";

/** A reference in the shape the service mints — 64 characters of hex. */
const REFERENCE = "0123456789abcdef".repeat(4);

/**
 * The stay {@link REFERENCE} was minted for: its first thirty-two characters,
 * written back into the hyphens a uuid carries.
 *
 * Spelled out rather than computed from `REFERENCE`, so the test states the
 * answer independently of the arithmetic the handler does to reach it.
 */
const STAY_IN_REFERENCE = "01234567-89ab-cdef-0123-456789abcdef";
const SAFE_BOOKING = "01234567-89ab-4def-8123-456789abcdef";

/** What the gateway says it moved, in đồng. */
const AN_AMOUNT = 1_200_000n;

/**
 * A callback as it comes off the wire: every value a string, because a query
 * string has no other kind. Nothing here is signed — the port is stood in for,
 * and what it is asked is asserted rather than what it makes of it.
 */
const A_CALLBACK = {
  vnp_Amount: "120000000",
  vnp_ResponseCode: "00",
  vnp_TransactionNo: "14528901",
  vnp_TransactionStatus: "00",
  vnp_TxnRef: REFERENCE,
  vnp_SecureHash: "not-checked-here",
} as const;

let app: INestApplication;
let handleIpn: Mock<PaymentService["handleIpn"]>;
let createPaymentRequest: Mock<PaymentService["createPaymentRequest"]>;
let listRefundCandidates: Mock<PaymentService["listRefundCandidates"]>;
let verifyCallback: Mock<PaymentGateway["verifyCallback"]>;

beforeEach(async () => {
  handleIpn = vi.fn<PaymentService["handleIpn"]>();
  createPaymentRequest = vi.fn<PaymentService["createPaymentRequest"]>();
  listRefundCandidates = vi.fn<PaymentService["listRefundCandidates"]>();
  verifyCallback = vi.fn<PaymentGateway["verifyCallback"]>();

  const moduleRef = await Test.createTestingModule({
    controllers: [PaymentController],
    providers: [
      {
        provide: PaymentService,
        useValue: { handleIpn, createPaymentRequest, listRefundCandidates },
      },
      {
        provide: PAYMENT_GATEWAY,
        useValue: {
          verifyCallback,
          // The port has four methods and the routes here reach one. The other
          // three are present rather than cast away, so a handler that grew a
          // call to the gateway fails loudly instead of on `undefined`.
          createPayment: unreached("opens an attempt"),
          refund: unreached("sends money back"),
          queryTransaction: unreached("asks the gateway about an attempt"),
        } satisfies PaymentGateway,
      },
      // Neither the comparison nor a transaction is reachable from the three
      // routes this file drives, so both are present as things that throw if one
      // ever becomes reachable — the arrangement the port's other methods are in
      // above, and for the same reason.
      {
        provide: ReconciliationService,
        useValue: {
          reconcile: unreached("reconciles a day"),
          runs: unreached("lists reconciled days"),
          reconciledDay: unreached("reads one reconciled day"),
        },
      },
      {
        provide: TransactionRunner,
        useValue: {
          run: async (work: (exec: never) => Promise<unknown>) => work(undefined as never),
        },
      },
      { provide: ENV, useValue: environment() },
      // The handler logs on every path; the assertions are about what it
      // answers, so the sink is a no-op rather than a spy.
      {
        provide: getLoggerToken(PaymentController.name),
        useValue: { info: () => {}, warn: () => {}, error: () => {} },
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
});

afterEach(async () => {
  await app?.close();
});

describe("what the gateway is told about a callback the property acted on", () => {
  const ANSWERS: readonly {
    readonly outcome: CallbackOutcome;
    readonly code: string;
  }[] = [
    { outcome: "RECORDED", code: "00" },
    // The redelivery, and the reason it is not `00`: both codes end the
    // conversation, and `02` is the protocol's own word for a notification
    // about an order this merchant has already confirmed. It must not read as
    // a failure, and it does not — VNPay stops retrying on it.
    { outcome: "ALREADY_RECORDED", code: "02" },
    // A payment the gateway refused, acknowledged as received. `RspCode`
    // reports whether the merchant processed the notification, not whether the
    // money moved, and the refusal is on file.
    { outcome: "REFUSED", code: "00" },
    { outcome: "STILL_OPEN", code: "00" },
  ];

  for (const { outcome, code } of ANSWERS) {
    it(`answers ${code} when the callback was ${outcome}`, async () => {
      handleIpn.mockResolvedValue(outcome);

      const response = await ipn();

      expect(response.status).toBe(200);
      expect(response.body.RspCode).toBe(code);
      // The pair, and only the pair — VNPay reads two fields and a merchant
      // that returns a third is answering a shape nobody documented.
      expect(Object.keys(response.body).sort()).toEqual(["Message", "RspCode"]);
    });
  }

  it("hands the callback to the service exactly as it arrived", async () => {
    // The signature is computed over the parameters as sent, so a handler that
    // renamed, dropped or coerced one first would produce a payload that
    // verifies against nothing — and the failure would look like a forged
    // callback rather than like this route.
    handleIpn.mockResolvedValue("RECORDED");

    await ipn();

    expect(handleIpn).toHaveBeenCalledWith(A_CALLBACK);
  });
});

describe("what the gateway is told about a callback the property refused", () => {
  it("answers 97 when nothing signed it", async () => {
    handleIpn.mockRejectedValue(
      new ORPCError("UNAUTHORIZED", { message: "not the gateway speaking" }),
    );

    const response = await ipn();

    expect(response.status).toBe(200);
    expect(response.body.RspCode).toBe("97");
  });

  it("answers 01 when the reference names no attempt", async () => {
    handleIpn.mockRejectedValue(
      new ORPCError("NOT_FOUND", { message: "no such attempt" }),
    );

    expect((await ipn()).body.RspCode).toBe("01");
  });

  const DISAGREEMENTS: readonly {
    readonly about: CallbackDisagreement;
    readonly code: string;
  }[] = [
    // The one disagreement VNPay has a word for, and the reason the service
    // names which of the three it raised. Told `04`, a merchant screen says
    // what actually happened; told `99`, it says nothing at all.
    { about: "AMOUNT", code: "04" },
    // `Invalid amount` would be a diagnosis this property has not established
    // for either of these — one is a success reported over a refusal already
    // on file, the other a transaction already recorded against a different
    // attempt. Neither is about the figure.
    { about: "OUTCOME", code: "99" },
    { about: "TRANSACTION", code: "99" },
  ];

  for (const { about, code } of DISAGREEMENTS) {
    it(`answers ${code} when the callback disagrees about the ${about.toLowerCase()}`, async () => {
      handleIpn.mockRejectedValue(
        new ORPCError("CONFLICT", {
          data: disagreedAbout(about),
          message: "nothing has been posted",
        }),
      );

      const response = await ipn();

      expect(response.status).toBe(200);
      expect(response.body.RspCode).toBe(code);
    });
  }

  it("answers 99 to a disagreement that does not say what it is about", async () => {
    // The safe half of a refusal added to the service without a line in this
    // file. `04` claims something; `99` claims only that the notification could
    // not be acted on.
    handleIpn.mockRejectedValue(new ORPCError("CONFLICT", { message: "no data" }));

    expect((await ipn()).body.RspCode).toBe("99");
  });

  it("answers 97 to a request carrying nothing at all", async () => {
    // The route is a url on the public internet and it is unguarded, so a scan
    // reaches it with an empty query and no signature. It costs a refusal and a
    // log line built out of fields that are all absent — not an exception on the
    // way to reading one of them.
    handleIpn.mockRejectedValue(
      new ORPCError("UNAUTHORIZED", { message: "not the gateway speaking" }),
    );

    const response = await request(app.getHttpServer()).get(
      "/payments/vnpay/ipn",
    );

    expect(response.status).toBe(200);
    expect(response.body.RspCode).toBe("97");
  });

  it("answers 99 when this property has no terminal configured", async () => {
    // `env.ts` leaves the VNPay credentials optional so that a developer and CI
    // without a merchant account can boot the API, and the adapter fails at the
    // call rather than at the boot. That failure reaches here as a refusal with
    // a code this handler has no VNPay word for — and `99` is right: the
    // notification could not be acted on, and VNPay should bring it again once
    // somebody has set the two variables.
    handleIpn.mockRejectedValue(
      new ORPCError("SERVICE_UNAVAILABLE", {
        message: "Card payment is not configured",
      }),
    );

    expect((await ipn()).body.RspCode).toBe("99");
  });

  it("answers 99, not a 500, when the property's own side failed", async () => {
    // A database that went away mid-callback. VNPay reads `RspCode` out of a
    // 200 body and a 500 tells it nothing it can act on — while `99` asks for
    // the notification again, which is exactly the recovery an outage wants.
    handleIpn.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const response = await ipn();

    expect(response.status).toBe(200);
    expect(response.body.RspCode).toBe("99");
  });

  it("tells the gateway nothing about what failed", async () => {
    // The route is unguarded, so the caller may be anyone. What VNPay needs is
    // two documented fields; a message or a stack in the body would be this
    // property describing its internals to whoever asked.
    handleIpn.mockRejectedValue(
      new Error("relation \"payment\" does not exist at character 13"),
    );

    const body = JSON.stringify((await ipn()).body);

    expect(body).not.toContain("payment");
    expect(body).not.toContain("character");
    expect(Object.keys((await ipn()).body).sort()).toEqual([
      "Message",
      "RspCode",
    ]);
  });
});

describe("where the payer's browser is sent", () => {
  const CAPTIONS: readonly {
    readonly status: "SUCCESS" | "FAILED" | "PENDING";
    readonly caption: string;
  }[] = [
    // `confirming` and not `paid`. The redirect and the IPN are independent
    // deliveries of the same claim and the browser can arrive first, so a page
    // told "paid" here would be issuing a receipt on the gateway's word before
    // this property had agreed.
    { status: "SUCCESS", caption: "confirming" },
    { status: "FAILED", caption: "refused" },
    { status: "PENDING", caption: "unfinished" },
  ];

  for (const { status, caption } of CAPTIONS) {
    it(`redirects with ${caption} when the gateway signed a ${status} redirect`, async () => {
      verifyCallback.mockResolvedValue(signedAs(status));

      const response = await payerReturn();

      expect(response.status).toBe(303);

      const location = new URL(response.headers.location);

      expect(location.origin).toBe(WEB_ORIGIN);
      // The funnel's own landing for a gateway return, named by
      // `repository-structure.md` §`(booking)` — and the stay in it is the
      // booking half of the reference the gateway signed, written back as the
      // uuid the route is addressed by.
      expect(location.pathname).toBe(`/booking/${STAY_IN_REFERENCE}/confirming`);
      expect(location.searchParams.get("payment")).toBe(caption);
      expect(location.searchParams.get("reference")).toBe(REFERENCE);
    });
  }

  it("hands a payer back to the funnel's door when the reference names no stay", async () => {
    // Signed, and still not a reference this property mints — the booking half
    // is not hex. There is no stay to open a page about, and composing the url
    // anyway would be this property building its own 404.
    verifyCallback.mockResolvedValue({
      verified: true,
      transaction: {
        status: "FAILED" as const,
        reference: "not-a-reference-this-property-would-ever-have-minted",
        amount: AN_AMOUNT,
      },
    });

    const response = await payerReturn();

    const location = new URL(response.headers.location);

    expect(location.pathname).toBe("/booking");
    expect(location.searchParams.get("payment")).toBe("refused");
  });

  it("carries nothing onward from a redirect the gateway did not sign", async () => {
    // A link anybody can compose. Following it into a page that names an
    // attempt would be a stranger choosing which stay the browser talks about.
    verifyCallback.mockResolvedValue({ verified: false });

    const response = await payerReturn();

    expect(response.status).toBe(303);

    const location = new URL(response.headers.location);

    expect(location.searchParams.get("payment")).toBe("unverified");
    expect(location.searchParams.has("reference")).toBe(false);
    // No reference is no stay, so there is no confirming screen to land on
    // either — the stay in that url would have come from the same unsigned
    // string everything else here is being withheld from.
    expect(location.pathname).toBe("/booking");
  });

  it("decides nothing about money", async () => {
    // The claim this route exists to make. The IPN is the authority: it is the
    // delivery the gateway retries, it arrives whether or not the payer's
    // browser survived, and it is the only one that posts. This one reads a
    // signature and redirects.
    verifyCallback.mockResolvedValue(signedAs("SUCCESS"));

    await payerReturn();

    expect(handleIpn).not.toHaveBeenCalled();
    expect(verifyCallback).toHaveBeenCalledWith(A_CALLBACK);
  });
});

describe("the attempt the desk opens", () => {
  beforeEach(() => {
    createPaymentRequest.mockResolvedValue({
      paymentUrl: "https://sandbox.vnpayment.invalid/pay?vnp_TxnRef=abc",
      reference: REFERENCE,
    });
  });

  it("answers with where to send the payer and what the attempt is called", async () => {
    const response = await openAttempt();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      paymentUrl: "https://sandbox.vnpayment.invalid/pay?vnp_TxnRef=abc",
      reference: REFERENCE,
    });
  });

  it("sends the gateway back to the route that receives the payer", async () => {
    // Built from `API_URL` and not from `WEB_ORIGIN`: what goes to VNPay is the
    // address of a route in this process, and handing it the web origin would
    // send every payer to a page the site has never had.
    await openAttempt();

    expect(createPaymentRequest.mock.calls[0]?.[0].returnUrl).toBe(
      `${API_URL}/payments/vnpay/return`,
    );
  });

  it("takes the payer's address off the connection, never off the body", async () => {
    // The address is a fraud signal the gateway screens on, so a caller that
    // could state its own would be choosing what it is screened for. Supertest
    // calls over loopback, which is what the connection honestly reports.
    await openAttempt({ payerIpAddress: "203.0.113.9" });

    const opened = createPaymentRequest.mock.calls[0]?.[0];

    expect(opened?.payerIpAddress).not.toBe("203.0.113.9");
    expect(opened?.payerIpAddress).toMatch(/127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/);
  });

  it("ignores a caller trying to choose where the payer is handed back to", async () => {
    // Not a check in the handler. The contract has no such field, so the
    // parsed input never carries one and the handler has nothing to read it
    // from — which is why the answer is an ordinary 200 against this property's
    // own address rather than a refusal. Asserted because the failure it
    // forecloses is an open redirect carrying the gateway's own signed
    // parameters onward to whoever asked for it.
    await openAttempt({ returnUrl: "https://phishing.invalid/paid" });

    expect(createPaymentRequest.mock.calls[0]?.[0].returnUrl).toBe(
      `${API_URL}/payments/vnpay/return`,
    );
  });

  it("hands the service the đồng as an amount and not as text", async () => {
    // `money.ts` carries an amount over the wire as decimal text and decodes it
    // at the contract. A handler that passed the string through would have the
    // adapter scale a `string` by a hundred.
    await openAttempt();

    expect(createPaymentRequest.mock.calls[0]?.[0].amount).toBe(1_200_000n);
  });

  it("lets the service's own refusal travel as the answer", async () => {
    // The two refusals `createPaymentRequest` makes are written for the person
    // who typed the figure, and this route adds no check that would pre-empt
    // them. What it must not do is turn one into a 500.
    createPaymentRequest.mockRejectedValue(
      new ORPCError("BAD_REQUEST", {
        message: "the amount has to be more than nothing",
      }),
    );

    const response = await openAttempt({ amount: "0" });

    expect(response.status).toBe(400);
  });
});

describe("what the five routes declare about access", () => {
  // Asserted as metadata rather than by calling them without a session, because
  // the guard is global and this module does not install it — `rbac-matrix.md`
  // §2 makes a route that declares neither unreachable, and the declaration is
  // what this file owns. `test/payment-callbacks.e2e-spec.ts` and
  // `test/payment-api.e2e-spec.ts` boot the real application and prove the guard
  // honours all three.
  const reflector = new Reflector();

  it("the gateway's two are unguarded, and both say why", () => {
    const reasons = [
      reflector.get<string>(UNGUARDED_KEY, PaymentController.prototype.ipn),
      reflector.get<string>(
        UNGUARDED_KEY,
        PaymentController.prototype.payerReturn,
      ),
    ];

    // The signature is what stands in for a session on both, and the sentence
    // is the thing a reviewer gets to disagree with — `access.decorators.ts`
    // requires one rather than accepting a bare marker.
    for (const reason of reasons) {
      expect(reason).toMatch(/signature/i);
    }
  });

  it("the desk's names a capability, and is not unguarded", () => {
    const requirement = reflector.get<CapabilityRequirement>(
      CAPABILITY_KEY,
      PaymentController.prototype.openAttempt,
    );

    expect(requirement).toEqual({ key: "payment.open-attempt", action: "write" });

    // Both would be a contradiction the guard has to break a tie on. Opening an
    // attempt writes a row and asks a gateway for money; nothing about it is
    // reachable without a session.
    expect(
      reflector.get(UNGUARDED_KEY, PaymentController.prototype.openAttempt),
    ).toBeUndefined();
  });

  it("the accountant's two name the reconciliation row, and name it as reads", () => {
    // The action is the half worth pinning. Both routes only look — the table is
    // append-only and nothing here writes to it — so a role the matrix later
    // hands a 👁 over gateway reconciliation must reach them, and `write` is the
    // declaration that would quietly refuse them.
    for (const route of [
      PaymentController.prototype.listReconciliations,
      PaymentController.prototype.readReconciliation,
    ]) {
      expect(
        reflector.get<CapabilityRequirement>(CAPABILITY_KEY, route),
      ).toEqual({ key: "payment.reconcile", action: "read" });

      expect(reflector.get(UNGUARDED_KEY, route)).toBeUndefined();
    }
  });

  it("the refund worklist names policy refund, not reconciliation", () => {
    expect(
      reflector.get<CapabilityRequirement>(
        CAPABILITY_KEY,
        PaymentController.prototype.listRefundCandidates,
      ),
    ).toEqual({ key: "folio.refund-policy", action: "read" });
  });
});

describe("the policy-refund worklist", () => {
  it("returns only the safe row and passes paging filters to the service", async () => {
    listRefundCandidates.mockResolvedValue({
      payments: [
        {
          paymentId: A_BOOKING,
          bookingId: SAFE_BOOKING,
          bookingReference: "MRV-20271102-0001",
          method: "VNPAY",
          amount: AN_AMOUNT,
          paidAt: new Date("2027-11-02T02:10:00Z"),
          businessDate: "2027-11-01",
        },
      ],
      total: 1,
    });

    const response = await request(app.getHttpServer())
      .get("/payments/refund-candidates")
      .query({ method: "VNPAY", businessDate: "2027-11-01", limit: 1, offset: 2 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      payments: [
        {
          paymentId: A_BOOKING,
          bookingId: SAFE_BOOKING,
          bookingReference: "MRV-20271102-0001",
          method: "VNPAY",
          amount: AN_AMOUNT.toString(),
          paidAt: "2027-11-02T02:10:00.000Z",
          businessDate: "2027-11-01",
        },
      ],
      total: 1,
    });
    expect(listRefundCandidates).toHaveBeenCalledWith(undefined, {
      method: "VNPAY",
      businessDate: expect.objectContaining({ year: 2027, month: 11, day: 1 }),
      limit: 1,
      offset: 2,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /folioId|gatewayTransactionId|discrepancyId|observation/i,
    );
  });
});

/** The IPN, as VNPay calls it: a `GET` carrying the transaction in the query. */
function ipn(): request.Test {
  return request(app.getHttpServer())
    .get("/payments/vnpay/ipn")
    .query(A_CALLBACK);
}

/** The payer's browser, redirected back by the gateway with the same parameters. */
function payerReturn(): request.Test {
  return request(app.getHttpServer())
    .get("/payments/vnpay/return")
    .query(A_CALLBACK);
}

/** The desk opening an attempt. The amount travels as text, which is the only
 *  way `money.ts` lets a đồng cross the wire. */
function openAttempt(overrides: Record<string, unknown> = {}): request.Test {
  return request(app.getHttpServer())
    .post(`/bookings/${A_BOOKING}/payment-attempts`)
    .send({
      amount: "1200000",
      description: "Deposit against the stay",
      ...overrides,
    });
}

/** What the port answers for a redirect the gateway did sign. */
function signedAs(status: "SUCCESS" | "FAILED" | "PENDING"): CallbackVerification {
  if (status === "SUCCESS") {
    return {
      verified: true,
      transaction: {
        status,
        reference: REFERENCE,
        amount: AN_AMOUNT,
        gatewayTransactionId: "14528901",
        paidAt: new Date("2027-11-02T02:10:00Z"),
      },
    };
  }

  return {
    verified: true,
    transaction: { status, reference: REFERENCE, amount: AN_AMOUNT },
  };
}

/** A port method no case here reaches. */
function unreached(what: string): () => Promise<never> {
  return async () => {
    throw new Error(`nothing in this file ${what}`);
  };
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
