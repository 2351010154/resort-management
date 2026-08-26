# Runbook — flipping PayPal to production credentials (gate `G2`)

The commit that switches PayPal from sandbox to live credentials is gate `G2`,
the same gate VNPay's flip is held to —
[`g2-production-payment.md`](g2-production-payment.md) is that runbook, and
this one does not repeat it. Its six items and the reasoning behind them are
stated once, in
[`../architecture/infrastructure.md`](../architecture/infrastructure.md)
§Payments, at the paragraph beginning "The trigger". Read that paragraph
first: the six items are the deployment's, ticked once, and are not re-ticked
for PayPal if VNPay has already flipped. What PayPal owes on top of them is
its own production transaction, below.

**The flip is manual.** Nothing in this repository performs it. It is a
credential change made by hand — in the PayPal developer dashboard and in the
deployment's secret store — after the checklist below passes. There is no
script, no migration and no deploy flag that turns real money on.

What the code does instead is refuse a half-finished flip.
[`../../apps/api/src/config/env.ts`](../../apps/api/src/config/env.ts) stops a
production boot in two cases relevant here:

- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_WEBHOOK_ID` set
  other than all three together or none of them, in any environment — a
  deployment holding the credentials but not the webhook id could open an
  order and never confirm what PayPal said about it.
- `PAYPAL_CLIENT_ID` set under `NODE_ENV=production` while `PAYPAL_SANDBOX` is
  true (the default) — a sandbox client signs and answers exactly as the live
  one does, so a booking would confirm against money that never moved.

**Until the three variables are set, PayPal is not a gateway this property
collects through.** `payment.module.ts` binds an adapter into the registry only
where the deployment can reach it, so before the flip the map holds VNPay alone:
a guest who chooses PayPal is refused by name, and the nightly reconciliation
sweeps VNPay's night exactly as it did before this gateway existed. It is bound
by the deploy at step 8 and by nothing else — there is no separate enable flag.

Variable names, and what each one is for, are in
[`../../apps/api/.env.example`](../../apps/api/.env.example). Never write a
value into this repository: deployed values live in `fly secrets`.

## Before the flip

1. **Confirm all six `G2` items are ticked**, in the infrastructure section
   linked above — or already ticked from VNPay's own flip, since they are the
   deployment's and not re-checked per gateway.
2. **Confirm the production PayPal app exists**, created in the PayPal
   developer dashboard against the **live** business account, distinct from
   the sandbox app used for staging — client id, secret and webhook id are all
   per-app.
3. **Confirm a webhook is subscribed on the live app** at
   `POST <production API_URL>/payments/paypal/webhook`, for the event types
   `paypal.adapter.ts` listens for. The webhook id in the deployment's secret
   store must be this subscription's id, not the sandbox app's — a mismatched
   id verifies nothing and every event is rejected as unsigned.
4. **Confirm `PAYPAL_WEBHOOK_ID` names that same subscription.** Verification
   is a call to PayPal's own
   `/v1/notifications/verify-webhook-signature`, naming this id
   (`FR-PAY-02` — the codebase computes no signature and checks no
   certificate chain); a webhook id from the wrong app or environment fails
   every verification silently rather than posting money.
5. **Confirm the on-call endpoint is live and routes to a person.** Send a
   test POST to whatever `OPS_ALERT_WEBHOOK_URL` holds and check that a phone
   rings — the same endpoint VNPay's reconciliation pages, since
   `reconciliation.job.ts` asks every bound gateway for its side of a night
   through the one alert path.
6. **Confirm the sandbox path still passes end to end** against the sandbox
   app: a hold, a PayPal attempt, an approval, a webhook delivery, a confirmed
   stay and a posted folio line at the frozen presentment. A developer's
   machine cannot receive a live PayPal webhook — it is a server-to-server
   call to a public address — so this has to run against a deployed staging
   environment PayPal can reach.
7. **Confirm `rate_vnd_per_usd` in `system_config` is a rate the property set
   on purpose**, not the migration's placeholder default. Set it from the
   admin console's Settings screen, under "Currency conversion" — the one
   `ADMIN`-only route this figure has (`PATCH /system/config`). It is frozen
   onto every PayPal payment the moment an attempt opens (`0045_a_gateway_that_
   cannot_charge_dong_says_what_it_charged.sql`), so a stale or default rate
   is not caught at boot — it is caught the first time a guest is charged at
   it. Postgres refuses zero or a negative figure outright
   (`system_config_fx_rate_is_positive`,
   `0046_a_rate_of_nothing_converts_nothing.sql`), but it cannot refuse a
   plausible-looking rate nobody actually chose — that is this step's job.

## The flip

8. **Set the production app credentials** — `PAYPAL_CLIENT_ID`,
   `PAYPAL_CLIENT_SECRET` and `PAYPAL_WEBHOOK_ID` — in the API's secret store,
   all three together; any subset is refused at boot.
9. **Set `PAYPAL_SANDBOX=false`** in the same change. Omitting it is not
   neutral: the variable defaults to sandbox, and a production boot with a
   client id and no explicit `false` is refused.
10. **Deploy and watch the boot.** A refusal prints `Invalid environment:`
    followed by the variable at fault. Any refusal here means the flip is
    incomplete — fix the variable, do not work around the check.

## After the flip

11. **Take one real PayPal payment of the smallest amount the property is
    willing to lose**, through the live funnel, choosing PayPal at the
    payment step. Confirm the stay reaches `CONFIRMED` from the webhook and
    that the folio carries the payment in whole đồng, at the rate the
    attempt froze.
12. **Refund that payment in the PayPal business dashboard**, which is where a
    refund is made today — `paypal.adapter.ts` implements `refund` and proves
    it against a mocked client, the same standing `vnpay.adapter.ts` gives:
    handing money back is a staff act through the folio's refund paths,
    performed out of band, and nothing in this codebase calls the gateway's
    refund method.
13. **Wait for one reconciliation cycle to close a trading day** and confirm
    the `payment_reconciliation_run` row for it carries no discrepancy for
    PayPal's side. `PaypalAdapter.settledBetween` answers the sweep directly —
    unlike VNPay, PayPal reports a window rather than being asked attempt by
    attempt.

## Rolling back

Set `PAYPAL_SANDBOX=true` and replace the credentials with the sandbox app's,
in one change; deploy. This stops new PayPal attempts reaching the live
gateway. It does **not** reverse money already taken — payments already at the
live gateway are refunded through the PayPal dashboard, not by a deploy — and
it does not undo a confirmed stay. Treat any window between the flip and the
rollback as real bookings that need reconciling by hand against PayPal's own
transaction history.

## Open question this runbook does not answer

Whether the operating entity holds a licence to collect foreign currency
governs how a PayPal-paid folio is invoiced under `ASM-03`'s tax-agent answer,
not whether the flip above may proceed — the ledger posts VND either way. See
[`../product-requirements.md`](../product-requirements.md) `ASM-03` and
[`../architecture/infrastructure.md`](../architecture/infrastructure.md)
§Payments.
