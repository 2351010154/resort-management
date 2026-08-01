# Infrastructure and money rails

Where the system runs and how money moves through it. Full rationale, costs and
evidence:
[`plans/reports/archive/advise-260726-1401-infra-money-rails.md`](../../plans/reports/archive/advise-260726-1401-infra-money-rails.md)
(R3), frozen 2026-07-26.

Region is **AWS `ap-southeast-1` (Singapore)** wherever a region is selectable —
the nearest mature region to Vietnam. No vendor here has a Vietnam region.
Offshore storage of guest ID data is a provisional design choice, not an
accepted legal conclusion. It requires written legal advice before opening
(`M0-05`; [SCRUM-13](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-13)).

## Hosting

| Concern | Choice | Why |
|---|---|---|
| Postgres (deployed) | Neon, `aws-ap-southeast-1`, separate `production` and `staging` branches | PITR included; branching gives per-PR databases |
| Postgres (development) | Local Docker | Testcontainers already requires Docker; Neon is for deployed environments only |
| API host | Fly.io, region `sin` | pg-boss needs a long-running process — this rules serverless out |
| Web + admin | Vercel, function region `sin1` | ⚠ Hobby is non-commercial; a booking site is commercial use |
| Object storage | Cloudflare R2 | $0 egress, presigned URLs, and **object lifecycle rules** |
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
- **Two R2 buckets**: `mariva-assets` and `mariva-id-scans`. ID scans never
  share a bucket with room photos — different access path, different lifecycle,
  different audit expectations.
- **The R2 lifecycle rule enforces ID-scan retention; a job only verifies it.**
  Retention becomes bucket configuration rather than a cron that can fail
  silently. The object key carries the checkout date; `N` stays a config value
  and must not be seeded as a legal fact until written advice establishes the
  applicable floor.
- Access to a scan is a short-TTL presigned GET issued by the API after the role
  check. **Issuance** is what gets audit-logged, not the fetch. The registration
  record itself stays in Postgres under statutory retention — only the image
  expires.

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
  [SCRUM-14](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-14)),
  not discovered at P3.
- IPN URLs are configured per terminal in the merchant admin, so staging and
  production need separate terminals.
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
[SCRUM-12](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-12).

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
statutory retention floor, offshore residency of CCCD scans — lives in
milestone `M0` of [`../../plans/backlog.md`](../../plans/backlog.md).
