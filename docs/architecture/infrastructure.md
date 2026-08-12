# Infrastructure and money rails

Where the system runs and how money moves through it. Full rationale, costs and
evidence:
[`plans/reports/archive/advise-260726-1401-infra-money-rails.md`](../../plans/reports/archive/advise-260726-1401-infra-money-rails.md)
(R3), frozen 2026-07-26.

Region is **AWS `ap-southeast-1` (Singapore)** wherever a region is selectable —
the nearest mature region to Vietnam. No vendor here has a Vietnam region.

**Offshore is permitted; the paperwork is the obligation.** No identity-document
image is stored anywhere — that is `FR-GST-02`, and it removes the sharpest
piece of this question — but Postgres still holds guest names, CCCD numbers and
stay records, and Luật 91/2025/QH15 with Nghị định 356/2025/NĐ-CP Điều 20 reaches
data held in Vietnam and moved to a storage system outside it. That is Neon, Fly
and R2 in `ap-southeast-1`, described exactly. What it takes is a filed
transfer-impact dossier, not a change of region: Decree 53/2022 localisation
binds a domestic enterprise only on both a listed service category *and* a
written Minister of Public Security decision, neither of which this system
attracts. The dossier is the lawyer's, and it gates **opening** rather than any
milestone that builds this
(`M0-05`; [#31](https://github.com/2351010154/resort-management/issues/31)).

## Hosting

| Concern | Choice | Why |
|---|---|---|
| Postgres (deployed) | Neon, `aws-ap-southeast-1`, separate `production` and `staging` branches | PITR included; branching gives per-PR databases |
| Postgres (development) | Local Docker | Testcontainers already requires Docker; Neon is for deployed environments only |
| API host | Fly.io, region `sin` | pg-boss needs a long-running process — this rules serverless out |
| Web + admin | Vercel, function region `sin1` | ⚠ Hobby is non-commercial; a booking site is commercial use |
| Object storage | Cloudflare R2 | $0 egress, and **object lifecycle rules** — the encrypted weekly dump expires by bucket configuration, not by a cron |
| Email | Resend | 3,000/mo free; SPF, DKIM and DMARC on all tiers |
| Errors, uptime, heartbeat | Better Stack | `/health` probe **and** a heartbeat the night audit checks into |
| Secrets | `fly secrets` + Vercel env vars | Never committed; parsed by a zod schema at boot |

**pg-boss defeats Neon's scale-to-zero.** Continuous polling resets the idle
timer, so production compute never suspends — budget an always-on instance
rather than planning on the free tier. Staging runs with pg-boss workers
disabled, so it genuinely suspends.

## Backup and retention

- **Neon PITR is not a backup.** It lives inside Neon; an account or billing
  problem takes the recovery with it. Weekly `pg_dump` → R2, encrypted, 8-week
  lifecycle, plus **one restore drill executed and timed**. Verified means done,
  not claimed.
- **One R2 bucket**: `mariva-assets`, room photos and the encrypted dumps above.
  There is no second bucket, because there is no identity-document image to put
  in one — `FR-GST-02` checks the card, records the particulars and discards the
  picture, so the private bucket, its lifecycle rule, the presigned-GET view path
  and the issuance audit log all describe an object that never exists. The
  cheapest retention policy is the one with nothing to retain.
- **The registration record is what survives, and nothing deletes it.** It lives
  in Postgres, append-only. A statutory floor may oblige keeping it for some
  years — reportedly 36 months under Nghị định 96/2016/NĐ-CP Điều 44, a figure
  this repository has only from secondary sources and has not checked against the
  primary text — but a floor forbids an early delete rather than scheduling a
  late one. Nothing here deletes it, so the floor is already met by doing
  nothing, and no job, column or config row is owed to it.

## Payments

One internal `PaymentGateway` port — `createPayment` / `verifyCallback` /
`refund` / `queryTransaction`. Two implementations at most, one folio.

- **VNPay first** (P3), using the maintained `vnpay` library — never a
  hand-rolled HMAC-SHA512. It already covers domestic cards, international
  cards and QR.
- **VNPay may send the same IPN more than once.** A unique constraint on the
  gateway transaction id is mandatory, not defensive.
- **Refunds are restricted in the VNPay sandbox** and must be requested during
  merchant onboarding (`M0-04`;
  [#32](https://github.com/2351010154/resort-management/issues/32)),
  not discovered at P3.
- IPN URLs are configured per terminal in the merchant admin, so staging and
  production need separate terminals. Both addresses are the same two paths
  under each environment's own `API_URL`: `GET /payments/vnpay/ipn` for the
  gateway's report, `GET /payments/vnpay/return` for the payer's browser. Only
  the first is acted on — the return redirect confirms nothing about money.
- **A paid callback confirms the stay**, in the commit that writes the payment
  and the folio line. `booking.confirm` is behind `booking.write` and no guest
  holds it, so the callback is the only thing that can make `HELD → CONFIRMED`
  for a guest paying online — and a paid stay left `HELD` is one the TTL sweep
  cancels minutes later. Only a hold moves; see
  [`booking-state-machine.md`](booking-state-machine.md) §3.
- **The payer's browser lands on the funnel, not on a confirmation.** The return
  route sends it to `/booking/<hold>/confirming` under `WEB_ORIGIN`, carrying a
  caption and the attempt's reference. The redirect and the IPN are independent
  deliveries of one claim and either may arrive first, so that screen resolves
  against the property's own record rather than reporting what the gateway told
  the browser. A redirect the gateway did not sign carries nothing onward.
- **A developer's machine cannot receive an IPN**, because it is a
  server-to-server call to a public address while the return url is only a
  browser redirect. `apps/api/scripts/replay-vnpay-ipn.mjs` delivers a correctly
  signed one to a local API so the confirm path is exercised for real; a tunnel
  and a terminal pointed at it is the other way.
- **There is no daily report to fetch.** VNPay answers about one transaction at
  a time (`queryDr`); a day's totals live in a settlement file drawn from the
  merchant portal by hand. So the nightly reconciliation reconstructs the
  gateway's side by asking about every attempt the property opened — which works
  because the property mints every reference and writes a row before the payer
  is sent anywhere. A bulk feed, if one is ever granted, replaces that assembly
  without touching the comparison.
- **Only a closed trading day is reconciled.** A payment whose IPN is still in
  flight is money the gateway holds and this property does not, so reconciling
  the current day would file it as missing and page somebody about a payment
  that lands seconds later. `payment_reconciliation_run` records which days have
  been looked at; the sweep takes the closed ones it has no row for, up to a week
  back, and never today.
- **A discrepancy pages an endpoint, not a vendor.** `OPS_ALERT_WEBHOOK_URL`
  takes a POST of JSON — PagerDuty behind a transform, a Slack incoming webhook,
  ntfy, whatever the property's on-call tooling exposes — so escalation policy
  and who is on call this week stay outside this tree. Unset, a page is logged
  instead of sent; it is required at boot once a terminal is configured under
  `NODE_ENV=production`. Delivery never fails a reconciliation: the discrepancy
  rows are the durable record and an alerter that threw would roll them back.
- **MoMo is conditional** (P3.5), gated on measured VNPay-only abandonment. It
  costs a second signature scheme, IPN shape, refund API and reconciliation job.
  Its IPN must be answered within 15 seconds — the handler ACKs and the work
  happens in pg-boss.

**The trigger** is the commit that switches VNPay from sandbox to production
credentials. Its six-item checklist — paid tiers, monitoring, backups plus a
restore drill, lifecycle verification, release tracking — is gate `G2` in
[`../../plans/backlog.md`](../../plans/backlog.md) §0. Nothing merges past it
with a box unticked.

## E-invoice

**Nghị định 70/2025/NĐ-CP** (Decree 70/2025, in force since 2025-06-01) names
*khách sạn* (hotels) in its point-of-sale e-invoice provisions. Whether those
provisions bind Mariva's operating entity and registered activity is still
unresolved; the tax agent's written answer is the authority (`M0-06`).
The provider/accountant decision shares the same execution record:
[#29](https://github.com/2351010154/resort-management/issues/29).

If applicability is confirmed, the target is **hóa đơn điện tử khởi tạo từ máy
tính tiền** and the following constraints shape the build. If it is not
confirmed, the required invoice subtype and provider workflow must be replaced
from the written ruling before implementation or procurement:

- Buy the *máy tính tiền* SKU, not the ordinary e-invoice product — same
  vendors, different SKU and different API (`M0-03`).
- **The checkout screen is the máy tính tiền.** Issuance happens when the folio
  closes, not in the night audit.
- Not synchronously inside the HTTP request: folio close enqueues an idempotent
  pg-boss job keyed on the folio id. A provider timeout must never roll back a
  completed checkout.
- **The invoice number is the provider's**, stored alongside the folio id and
  treated as the legal reference on every report.
- *Hóa đơn điều chỉnh / thay thế* (adjustment / replacement invoices) map onto
  the append-only folio reversal model. No new concept needed.
- **Buy a chữ ký số HSM / ký số từ xa** (HSM-held / remote digital signature
  certificate), never a USB token (`M0-02`). A token makes automated issuance
  impossible — someone plugs a dongle into a PC for every checkout.
- Default provider: **Viettel S-Invoice** (public REST docs, English document,
  Postman guide, documented HSM signing). Switch to **MISA meInvoice** if the
  accountant works in MISA AMIS — their reconciliation workload outweighs API
  polish (`M0-01`).

## Connectivity

Cloud-first. **Never build offline writes**: the correctness thesis is that
double-booking is impossible by database constraint, and those constraints
cannot be enforced across a partitioned database.

The replica decision is made from data, not intuition — a probe at the property
from the day the ISP line goes live (`M0-07`), evaluated after 60 days at P7: no
failover or monthly outages buys an on-site read replica; anything better buys
nothing but the paper-fallback runbook.

## Not decided here

Everything gated on someone else's process — VNPay onboarding documents and
timeline, whether Nghị định 70/2025 binds this entity's activity codes, the
registration record's statutory retention floor, the cross-border transfer
dossier for guest personal data held in Singapore — lives in milestone `M0` of
[`../../plans/backlog.md`](../../plans/backlog.md).
