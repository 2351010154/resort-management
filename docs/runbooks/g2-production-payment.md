# Runbook — flipping VNPay to production credentials (gate `G2`)

PayPal is the second gateway behind the same gate — see
[`g2-production-paypal.md`](g2-production-paypal.md) for its own flip; the two
runbooks do not repeat each other.

The commit that switches VNPay from sandbox to live credentials is gate `G2`.
Its six items and the reasoning behind them are stated once, in
[`../architecture/infrastructure.md`](../architecture/infrastructure.md)
§Payments, at the paragraph beginning "The trigger". Read that paragraph before
working through this file; this runbook is the order of operations, not a second
copy of the gate.

**The flip is manual.** Nothing in this repository performs it, and nothing is
meant to. It is a credential change made by hand — in the VNPay merchant admin
and in the deployment's secret store — after the checklist below passes. There
is no script, no migration and no deploy flag that turns real money on, and a
future one would move the decision away from the person accountable for it.

What the code does instead is refuse a half-finished flip.
[`../../apps/api/src/config/env.ts`](../../apps/api/src/config/env.ts) stops a
production boot in three cases relevant here, so an incomplete step below fails
at start-up rather than in front of a guest:

- `VNPAY_TMN_CODE` without `VNPAY_SECRET_KEY`, or the reverse, in any
  environment.
- `VNPAY_TMN_CODE` set under `NODE_ENV=production` while `VNPAY_SANDBOX` is
  true — a sandbox terminal signs and answers exactly as the live one does, so
  a booking would confirm against money that never moved.
- `VNPAY_TMN_CODE` set under `NODE_ENV=production` with no
  `OPS_ALERT_WEBHOOK_URL` — from that moment gateway money is swept hourly and
  a discrepancy nobody is paged about is one nobody finds.

Variable names, and what each one is for, are in
[`../../apps/api/.env.example`](../../apps/api/.env.example). Never write a
value into this repository: deployed values live in `fly secrets` (API) and the
Vercel project environment (web, admin).

## Before the flip

1. **Confirm all six `G2` items are ticked**, in the infrastructure section
   linked above. Paid tiers, monitoring, backups, the restore drill,
   lifecycle verification and release tracking. "Verified" there means executed
   and timed, not planned — the restore drill in particular.
2. **Confirm the production merchant terminal exists.** It comes from VNPay
   merchant onboarding and it is a *different* terminal from staging's: the IPN
   URL is configured per terminal in the merchant admin, so one terminal cannot
   serve two environments.
3. **Confirm refunds are enabled on the production merchant account.** They are
   restricted in the sandbox and must be requested during onboarding, so a
   property that skipped this discovers it on the first refund request.
4. **Confirm the terminal's IPN and return URLs point at production's own
   `API_URL`**: `GET /payments/vnpay/ipn` and `GET /payments/vnpay/return`.
   Only the IPN is acted on. A wrong IPN URL is silent — payments succeed at the
   gateway and no folio is ever posted.
5. **Confirm the on-call endpoint is live and routes to a person.** Send a test
   POST to whatever `OPS_ALERT_WEBHOOK_URL` will hold and check that a phone
   rings. The boot check verifies a URL is present, not that anybody answers it.
6. **Confirm the sandbox path still passes end to end**, against the staging
   terminal: a hold, a payment, an IPN, a confirmed stay and a posted folio
   line. `apps/api/scripts/replay-vnpay-ipn.mjs` delivers a correctly signed IPN
   to an API that cannot receive a real one.

## The flip

7. **Set the production terminal credentials** — `VNPAY_TMN_CODE` and
   `VNPAY_SECRET_KEY` — in the API's secret store. Both together; either alone
   is refused at boot.
8. **Set `VNPAY_SANDBOX=false`** in the same change. Omitting it is not
   neutral: the variable defaults to sandbox, and a production boot with a
   terminal and no explicit `false` is refused.
9. **Set `OPS_ALERT_WEBHOOK_URL`** if it is not already set, to the endpoint
   verified in step 5.
10. **Deploy and watch the boot.** A refusal prints `Invalid environment:`
    followed by the variable at fault. Any refusal here means the flip is
    incomplete — fix the variable, do not work around the check.

## After the flip

11. **Take one real payment of the smallest amount the property is willing to
    lose**, through the live funnel, on a real card. Confirm the stay reaches
    `CONFIRMED` from the IPN and that the folio carries the payment.
12. **Refund that payment in the VNPay merchant admin**, which is where a refund
    is made today — `payment.service.ts` treats it as a person's act on the
    gateway's own screen. This is also the first proof that step 3 was true.
13. **Wait for one reconciliation cycle to close a trading day** and confirm a
    `payment_reconciliation_run` row exists for it with no discrepancy. The
    sweep runs hourly and never reconciles today.

## Rolling back

Set `VNPAY_SANDBOX=true` and replace the terminal credentials with the sandbox
pair, in one change; deploy. This stops new payments reaching the live gateway.
It does **not** reverse money already taken — payments already at the live
gateway are refunded through the gateway, not by a deploy — and it does not
undo a confirmed stay. Treat any window between the flip and the rollback as
real bookings that need reconciling by hand against the merchant portal's
settlement file.
