// The two routes VNPay calls, against the answers VNPay's specification says it
// reads.
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

const WEB_ORIGIN = "https://mariva.test";

/** A reference in the shape the service mints — 64 characters of hex. */
const REFERENCE = "0123456789abcdef".repeat(4);

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
let verifyCallback: Mock<PaymentGateway["verifyCallback"]>;

beforeEach(async () => {
  handleIpn = vi.fn<PaymentService["handleIpn"]>();
  verifyCallback = vi.fn<PaymentGateway["verifyCallback"]>();

  const moduleRef = await Test.createTestingModule({
    controllers: [PaymentController],
    providers: [
      { provide: PaymentService, useValue: { handleIpn } },
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
      expect(location.pathname).toBe("/booking");
      expect(location.searchParams.get("payment")).toBe(caption);
      expect(location.searchParams.get("reference")).toBe(REFERENCE);
    });
  }

  it("carries nothing onward from a redirect the gateway did not sign", async () => {
    // A link anybody can compose. Following it into a page that names an
    // attempt would be a stranger choosing which stay the browser talks about.
    verifyCallback.mockResolvedValue({ verified: false });

    const response = await payerReturn();

    expect(response.status).toBe(303);

    const location = new URL(response.headers.location);

    expect(location.searchParams.get("payment")).toBe("unverified");
    expect(location.searchParams.has("reference")).toBe(false);
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

describe("what the two routes declare about access", () => {
  // Asserted as metadata rather than by calling them without a session, because
  // the guard is global and this module does not install it — `rbac-matrix.md`
  // §2 makes a route that declares neither unreachable, and the declaration is
  // what this file owns. `test/payment-callbacks.e2e-spec.ts` boots the real
  // application and proves the guard honours it.
  const reflector = new Reflector();

  it("both are unguarded, and both say why", () => {
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

/** What the port answers for a redirect the gateway did sign. */
function signedAs(status: "SUCCESS" | "FAILED" | "PENDING"): CallbackVerification {
  if (status === "SUCCESS") {
    return {
      verified: true,
      transaction: {
        status,
        reference: REFERENCE,
        amount: 1_200_000n,
        gatewayTransactionId: "14528901",
        paidAt: new Date("2027-11-02T02:10:00Z"),
      },
    };
  }

  return {
    verified: true,
    transaction: { status, reference: REFERENCE, amount: 1_200_000n },
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
  });
}
