// Delivers a correctly-signed VNPay IPN to a local API, for the half of the
// payment flow a developer's machine cannot otherwise reach.
//
// **Why this exists.** VNPay's return url is a browser redirect, so it works
// against `localhost` — a developer can pay on the sandbox and land back on the
// funnel. The IPN is not: it is a server-to-server call from VNPay's network to
// a public address, and it is the delivery this property actually acts on. So
// on a laptop the payer completes a payment, comes back to `confirming/`, and
// waits for a callback that can never arrive. This sends that callback.
//
// **It is a test client, not a test double.** Nothing here stands in for the
// API: the request goes over HTTP to the real route, is verified by the real
// adapter against the real merchant secret, and is acted on by the real service
// inside the real transaction. What it stands in for is VNPay's network
// position. The signature is computed by the same maintained `vnpay` package the
// API verifies with — `FR-PAY-02` forbids a hand-rolled HMAC on both sides of
// that conversation, and a script that rolled its own would prove the API agrees
// with this file rather than with VNPay.
//
// **It cannot invent a payment.** The reference names an attempt this property
// already opened, and `payment.service.ts` refuses one it did not mint, one
// whose amount disagrees with the row, and one contradicting an outcome already
// on file. Passing a reference from a real sandbox payment is the point: the
// same callback VNPay would have sent, delivered by hand.
//
// Usage, from `apps/api`:
//
//   node scripts/replay-vnpay-ipn.mjs --reference <64-hex> --amount <đồng>
//
//   --transaction <id>   VNPay's own id for the payment. Defaults to a fresh
//                        one, because a repeat of a *previous* id is a
//                        different test — that is the replay case, and it is
//                        the one to pass this flag for.
//   --status <code>      `00` takes the money, which is the default. `24` is
//                        the payer cancelling, and any other code is a refusal.
//   --paid-at <ts>       `yyyyMMddHHmmss` in the property's zone. Defaults to
//                        now, which is what the gateway would send.
//   --url <origin>       Where the API answers. Defaults to `API_URL`, then to
//                        `http://localhost:3001`.
//
// Answering `RspCode` `00` means the property received it and finished acting on
// it — including on a refusal, which is filed rather than ignored. `02` is the
// same callback delivered twice, and is a pass rather than a failure.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { argv, env, exit } from "node:process";
import { VNPay, ignoreLogger, HashAlgorithm, VNPAY_GATEWAY_SANDBOX_HOST } from "vnpay";

/** VNPay's "the payment completed". */
const PAID = "00";

/** Where the API's own route answers — `payment.controller.ts` owns the path. */
const IPN_PATH = "/payments/vnpay/ipn";

const flags = readFlags(argv.slice(2));

if (!flags.reference) {
  fail(
    "A reference is required — the 64 hex characters this property minted for the attempt.\n" +
      "It is in the payment url VNPay was given as `vnp_TxnRef`, in the `payment` table's\n" +
      "`attempt_reference` column, and on the `confirming` page as `?reference=`.",
  );
}

if (!flags.amount) {
  fail(
    "An amount is required, in whole đồng — the figure the attempt was opened for.\n" +
      "A callback naming anything else is refused and posts nothing, which is the\n" +
      "behaviour `payment.service.ts` is built to have.",
  );
}

const secrets = readEnvFile(".env");

const tmnCode = env.VNPAY_TMN_CODE ?? secrets.VNPAY_TMN_CODE;
const secureSecret = env.VNPAY_SECRET_KEY ?? secrets.VNPAY_SECRET_KEY;

if (!tmnCode || !secureSecret) {
  fail(
    "VNPAY_TMN_CODE and VNPAY_SECRET_KEY must be set, in the environment or in apps/api/.env.\n" +
      "Without the merchant secret this script cannot sign, and the API would refuse what it sent —\n" +
      "which is the correct behaviour and a useless test.",
  );
}

// The library, configured exactly as `vnpay.adapter.ts` configures it. The host
// is never reached — nothing here talks to VNPay — but the hash algorithm has to
// match or the signature this builds is not the one the API recomputes.
const gateway = new VNPay({
  tmnCode,
  secureSecret,
  vnpayHost: VNPAY_GATEWAY_SANDBOX_HOST,
  hashAlgorithm: HashAlgorithm.SHA512,
  enableLog: false,
  loggerFn: ignoreLogger,
});

const status = flags.status ?? PAID;

const callback = {
  // In đồng, not in the gateway's hundredths. The library scales it by a
  // hundred when it builds the query — `vnpay.adapter.ts` says so where it
  // hands `createPayment` the same unscaled figure — so pre-scaling here would
  // send a hundred times the money and the API would refuse it as an amount the
  // attempt was not opened for. Which it did, the first time this was written.
  vnp_Amount: Number(flags.amount),
  vnp_BankCode: "NCB",
  vnp_CardType: "ATM",
  vnp_OrderInfo: `Replayed callback for ${flags.reference}`,
  vnp_PayDate: Number(flags.paidAt ?? stamp(new Date())),
  // Both, because `vnpay.adapter.ts` reads both and only the pair reading `00`
  // is money that moved: the first reports the result of the request and the
  // second the state of the payment.
  vnp_ResponseCode: status,
  vnp_TransactionStatus: status,
  vnp_TransactionNo: Number(flags.transaction ?? freshTransactionId()),
  vnp_TmnCode: tmnCode,
  vnp_TxnRef: flags.reference,
};

// The library builds the query string and the hash over it together, in the
// order and encoding VNPay specifies. Composing the url by hand here is what
// would make this a test of this file's idea of that specification.
const signed = gateway.buildPaymentUrl(
  { ...callback, vnp_IpAddr: "127.0.0.1", vnp_ReturnUrl: "http://localhost:3000" },
  { logger: { loggerFn: ignoreLogger } },
);

const origin = flags.url ?? env.API_URL ?? "http://localhost:3001";
const query = new URL(signed).search;
const target = new URL(`${IPN_PATH}${query}`, origin);

console.log(`Delivering to ${target.origin}${IPN_PATH}`);
console.log(`  reference   ${flags.reference}`);
console.log(`  amount      ${flags.amount} đồng`);
console.log(`  transaction ${callback.vnp_TransactionNo}`);
console.log(`  status      ${status}${status === PAID ? " (paid)" : " (not paid)"}`);

let answer;

try {
  answer = await fetch(target);
} catch (cause) {
  fail(
    `The API at ${origin} could not be reached — is it running?\n${String(cause)}`,
  );
}

const body = await answer.json().catch(() => undefined);

console.log(`\n${answer.status} ${JSON.stringify(body)}`);

// The route answers 200 whatever it decides, because VNPay reads the verdict out
// of `RspCode` and a merchant returning a 500 has told it nothing it can act on.
// So the exit code is read off that field rather than off the status.
if (body?.RspCode === "00") {
  console.log("\nReceived and acted on. A paid callback has posted the payment,");
  console.log("confirmed the stay if it was still held, and written the folio line.");
  exit(0);
}

if (body?.RspCode === "02") {
  console.log("\nAlready on file — this is the replay answering idempotently.");
  exit(0);
}

console.log("\nThe property would not act on that callback. The message above says why.");
exit(1);

/** `--flag value` pairs, in the shape the checks above read. */
function readFlags(args) {
  const named = {};

  for (let at = 0; at < args.length; at += 2) {
    const flag = args[at]?.replace(/^--/, "");

    if (flag) {
      named[flag] = args[at + 1];
    }
  }

  return {
    reference: named.reference,
    amount: named.amount,
    transaction: named.transaction,
    status: named.status,
    paidAt: named["paid-at"],
    url: named.url,
  };
}

/**
 * The credentials, off the file the API itself boots from.
 *
 * Read rather than required, so a developer who has exported them into their
 * shell is not made to duplicate them, and one who has not is not made to. The
 * values are used to sign and are never printed.
 */
function readEnvFile(path) {
  try {
    const found = {};

    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);

      if (match?.[1]) {
        found[match[1]] = match[2]?.trim().replace(/^["']|["']$/g, "") ?? "";
      }
    }

    return found;
  } catch {
    return {};
  }
}

/** `yyyyMMddHHmmss`, which is how VNPay stamps a payment. */
function stamp(instant) {
  const local = new Date(instant.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));

  return [
    local.getFullYear(),
    String(local.getMonth() + 1).padStart(2, "0"),
    String(local.getDate()).padStart(2, "0"),
    String(local.getHours()).padStart(2, "0"),
    String(local.getMinutes()).padStart(2, "0"),
    String(local.getSeconds()).padStart(2, "0"),
  ].join("");
}

/**
 * An id in the shape VNPay numbers transactions with.
 *
 * Fresh by default, because the unique index on `gateway_transaction_id` is what
 * makes one transaction one payment — so reusing an id from an earlier run tests
 * the replay path rather than the payment path, and that is what `--transaction`
 * is for.
 */
function freshTransactionId() {
  // Seven hex digits read as the number they are — under 2^28, so it stays a
  // plain integer of the width VNPay's own ids are, and wide enough that two
  // runs in the same second do not collide.
  return Number.parseInt(
    createHash("sha256")
      .update(`${Date.now()}${Math.random()}`)
      .digest("hex")
      .slice(0, 7),
    16,
  );
}
