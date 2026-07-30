# Advise — Layer 3 (Infrastructure) & Layer 4 (VN money rails)

- Date: 2026-07-26
- Repo: `C:/Users/tamla/Downloads/khach-san` (branch `chore/web-react19-next16`)
- Predecessors: `advise-260726-0939-resort-pms.md` (architecture, phases, §7 retention), `advise-260726-1119-stack-selection.md` (§3.8 deferred list — this report closes it)
- Mode: advisory only. No code changed.

---

## 1. Interview outcomes (user decisions, binding)

| # | Question | Decision |
|---|---|---|
| 1 | Outage at the property | Initially chose on-site server; reversed after challenge → **decision rule instead** (§4) |
| 2 | Line quality | **Unknown — ISP not contracted.** Property not open. Cloud-first now, rule decides later |
| 3 | Data residency | **Offshore Singapore is fine.** ID scans included. Legal risk accepted, to be closed with a lawyer before opening |
| 4 | Online payment scope | **Full online payment, domestic cards + wallets** |
| 5 | Infra budget | **Start minimal, step up at a named trigger** |
| 6 | E-invoice | **No provider yet — recommend one** |

Non-goals confirmed: offline-capable front desk, multi-region, VN-resident storage at launch.

---

## 2. Verdict

Layer 3 is easy and you should spend almost nothing on it. Layer 4 is where the actual risk sits, and it is **not technical risk — it is paperwork and procurement lead time**. VNPay merchant onboarding and the e-invoice certificate are things you buy, weeks before you can write the code against them, and both have gotchas that are decided at purchase time and expensive to unwind.

Two findings changed the shape of this advice:

1. **Nghị định 70/2025/NĐ-CP** (effective 01/06/2025) names **khách sạn** explicitly among businesses selling directly to consumers that must use *hóa đơn điện tử khởi tạo từ máy tính tiền* — invoice created, signed and transmitted to the tax authority **at the point of sale**. This is a different product from ordinary HĐĐT and it means your **checkout screen is the máy tính tiền**. It is not a nightly batch.
2. Automatic server-side signing requires **chữ ký số HSM / ký số từ xa**, not a USB token. Buy the wrong certificate and your invoice issuance cannot be automated at all — someone plugs a dongle into a PC for every checkout.

Both are procurement decisions. Neither is discoverable by writing code.

The infra half is close to a non-decision at 40 rooms: one Postgres, one API process, one bucket, one region, ~$0/mo until real money arrives and ~$50/mo after. Resist making it interesting.

---

## 3. Layer 3 — the picks

Region: **AWS `ap-southeast-1` Singapore** everywhere it is selectable. Nearest mature region to VN. No Neon/Fly/Vercel region exists in Vietnam.

| Concern | Pick | Why |
|---|---|---|
| Postgres (deployed) | **Neon**, `aws-ap-southeast-1` | PITR is **included** (7d on Launch, billed $0.20/GB-mo of change history). Branching gives per-PR ephemeral databases. See §3.1 for the pg-boss caveat |
| Postgres (dev) | **Local Docker** | Testcontainers already requires Docker Desktop. Do not burn Neon compute on development |
| API host | **Fly.io**, region `sin` | Docker, persistent VM. pg-boss needs a long-running process — this rules out serverless functions outright. Render Singapore ($7/mo Starter) is the predictable-billing alternative |
| Web + admin | **Vercel** | Next 16 zero-friction. ⚠ **Hobby is non-commercial** — a resort booking site is commercial. Pro ($20/mo) at the trigger, or move Next onto Fly |
| Object storage | **Cloudflare R2** | $0.015/GB-mo, **$0 egress**, 10 GB free forever, presigned URLs, SSE, and **object lifecycle rules** |
| Email | **Resend** | 3,000/mo free (100/day cap), DKIM/SPF/DMARC, React Email. Pro $20 at 50k |
| Errors | **Better Stack** free (100k exceptions/mo) or **Sentry** Developer (5k errors/mo) | Better Stack's free tier is 20× larger and bundles uptime + incident management |
| Uptime + heartbeat | Better Stack monitors | `/health` probe **and** a heartbeat the night audit checks into |
| Secrets | Fly secrets + Vercel env vars | Never committed. Config already parsed by zod at boot (stack report §3.2) |
| Backup | Neon PITR **+ weekly `pg_dump` → R2** | See §3.2 |

### 3.1 The one non-obvious interaction: pg-boss defeats Neon's scale-to-zero

Neon's cost model assumes the compute suspends when idle (default 5 min). **pg-boss polls continuously.** Every poll resets the timer, so the compute never suspends and you pay for it 24/7 regardless of traffic.

This is not a reason to drop either. It is a reason to stop treating Neon as free:

- **Production**: budget an always-on 0.25 CU ≈ **$19/mo**. Accept it. Predictable.
- **Staging**: run it with **pg-boss workers disabled**. Then it genuinely suspends and costs ~nothing.
- **Development**: local Docker Postgres. Neon is for deployed environments only.

The mistake to avoid is planning on the free tier and discovering pg-boss ate the compute allowance in week two.

### 3.2 Backup — PITR is not a backup

Neon PITR lives inside Neon. Account lockout, billing failure, or an accidental project delete takes the recovery with it. For a system holding money you want one copy outside the vendor:

- Weekly `pg_dump` from a pg-boss scheduled job → R2 bucket, encrypted, 8-week lifecycle rule.
- **One restore drill, executed and timed**, against a scratch Neon branch. Report 1 metric #10 is *"full restore <1 hour, verified"* — verified means you did it, not that the vendor claims it.

### 3.3 ID scans — R2 lifecycle rules do the retention work

Report 1 §7 sets 30 days post-checkout for the scan image. R2 supports object lifecycle expiration natively, so the retention rule is **bucket configuration, not a cron job you can forget to deploy**.

Design:

- **Separate bucket** for ID scans. Room photos and marketing assets never share it — different access path, different lifecycle, different audit expectations.
- Object key carries the checkout date; lifecycle rule expires at N days. `N` stays a config value (report 1 §7: statutory floor may override).
- Access only via short-TTL presigned GET, issued by the API after the role check, and the issuance is what gets audit-logged — not the fetch.
- The **registration record** (name, DOB, CCCD number, stay dates) stays in Postgres under the statutory retention. Only the image expires.

### 3.4 Cost

| Phase | Monthly |
|---|---|
| P0–P2 (synthetic data only) | **$0–5** — local Postgres, Neon free for staging, Fly ~$3, everything else free tier |
| Post-trigger (real bookings) | **≈ $50–55** — Neon Launch ~$24, Fly ~$7, Vercel Pro $20, R2 $0, Resend $0, Better Stack $0 |

Resend's free tier almost certainly holds at 40 rooms; the 100/day cap is the one that could bite during a full-house arrival day, not the 3,000/mo.

### 3.5 The trigger, defined so it cannot be missed

> **Trigger = the commit that switches VNPay from sandbox credentials to production credentials.**

Not "when we open", not "when it feels real". It is a deliberate config change you make with your own hands, so attach the checklist to it:

- [ ] Neon Free → Launch; confirm 7-day history and no idle suspend
- [ ] Vercel Hobby → Pro (commercial use)
- [ ] Uptime monitor on `/health`; heartbeat monitor on the night audit; both alert to your phone
- [ ] Weekly `pg_dump` → R2 job live, and **one restore drill completed and timed**
- [ ] R2 ID-scan lifecycle rule verified on a real object
- [ ] Sentry/Better Stack release tracking wired to deploys

If any box is unticked, the credentials do not flip. That is the whole mechanism.

---

## 4. The connectivity decision rule (as requested)

Evaluate **after the ISP is contracted, before P7 hardening**. Do not decide from intuition — instrument it: put a free Better Stack probe on a device at the property from the day the line is installed and let it collect **60 days** of data.

| Measured condition | Do |
|---|---|
| Business fibre **+ automatic 4G/5G failover**, unplanned outages >30 min occur **<2×/year** | **Nothing.** Cloud-only, paper fallback per P7 runbook. This is the expected outcome and it is fine |
| Single line, no failover, or outages ≥ **monthly** | Add an **on-site read replica** as P7 scope: mini-PC, Postgres streaming replica, read-only LAN board showing today's arrivals / departures / room status / folio balances. ~1 week. Writes still stop |
| Genuinely remote — mobile-only, no fibre available | **Fix connectivity, do not architect around it.** Starlink or a second carrier is cheaper than any software answer |

**Never build offline writes.** The entire correctness thesis of report 1 is that double-booking is made *impossible by database constraints* (§6.1 `CHECK` + `EXCLUDE USING gist`). Those constraints cannot be enforced across a partitioned database. An offline check-in path is not a feature with a cost — it is abandoning G1 and rebuilding it as conflict resolution, which is the thing hotels actually get wrong.

Also worth noting: a read replica helps the front desk read. It does not help it *sell*. If the line is bad enough to matter, the public booking funnel and the payment webhooks are already down, and that is the more expensive outage.

---

## 5. Layer 4 — payments

### 5.1 VNPay first, MoMo second (sequencing, not removal)

You chose VNPay + MoMo. Both stay in scope; the recommendation is **order**, not exclusion.

VNPay alone already covers ATM/nội địa cards via Napas, domestic Visa/Master, and QR. MoMo adds one thing: guests who pay from the MoMo wallet balance. It costs you a second signature scheme (RSA key pair vs VNPay's HMAC-SHA512), a second IPN shape, a second refund API, and a second reconciliation job.

**Ship VNPay at P3. Add MoMo at P3.5 once you can see, from real data, how many guests abandon at a VNPay-only payment step.** If that number is small, you saved a fortnight; if it is large, you have the evidence and MoMo slots into an interface that already exists.

Whichever ships, the payment layer stays behind one internal port (`PaymentGateway`) with `createPayment / verifyCallback / refund / queryTransaction`. Two implementations, one folio.

### 5.2 Verified integration facts (2026-07-26)

| Fact | Consequence |
|---|---|
| VNPay sandbox: `https://sandbox.vnpayment.vn/`, API base `/merchant_webapi/`, docs `/apis/docs/gioi-thieu/` | Real sandbox exists; start against it at P0 |
| **VNPay refund is restricted in the sandbox — requires contacting VNPay** | ⚠ Your refund path is **untestable by default**. Request refund sandbox access at onboarding, not at P3 |
| VNPay IPN URL is configured in the merchant terminal admin, not in code | Environment-specific config; staging and prod need separate terminals |
| **VNPay may send the same IPN multiple times** | Confirms report 1 req 21. Unique constraint on gateway txn id is mandatory, not defensive |
| VNPay signature verification via `verifyIpnCall` / `verifyReturnUrl` | Use the maintained Node library (`lehuygiang28/vnpay`, docs at vnpay.js.org). Do **not** hand-roll param sorting + HMAC-SHA512 — that is where everyone's signature bugs live |
| MoMo: RESTful JSON, requests signed with merchant private key, responses with MoMo's public key | Key management is real work; keys go in Fly secrets |
| **MoMo IPN must be answered within 15 seconds** | The webhook handler must ACK immediately and do the work in pg-boss. This is exactly why pg-boss was chosen — the architectures line up |
| MoMo supports refund including partial refund | Matches the folio reversal model |

### 5.3 The long pole is paperwork — start it in P0

VNPay merchant onboarding needs the business registration, a company bank account, and a live website with published terms, cancellation and refund policy — and a review pass. This takes **weeks**, runs entirely in parallel with development, and blocks nothing until it blocks everything.

Start the application in P0. The marketing site already exists, which is most of what the review wants to see.

*(Exact document list and review timeline: not verified this session. Confirm directly with VNPay.)*

---

## 6. Layer 4 — e-invoice (hóa đơn điện tử)

### 6.1 The regulation changes the design

**Nghị định 70/2025/NĐ-CP**, effective **01/06/2025**, requires businesses selling goods/services **directly to consumers** — the enumerated list names **khách sạn** — to use **hóa đơn điện tử khởi tạo từ máy tính tiền**, connected and transmitting data to the tax authority. The invoice is created, digitally signed and issued **immediately at the point of sale**.

Consequences for your build:

1. **Buy the "từ máy tính tiền" product**, not the ordinary HĐĐT product. Same vendors, different SKU and different API.
2. **Your checkout screen is the máy tính tiền.** Invoice issuance happens when the folio closes, in front of the guest — not in the night audit.
3. That does **not** mean issuing it synchronously inside the HTTP request. Correct shape: folio close enqueues an idempotent pg-boss job keyed on the folio id, the job issues and signs, the checkout screen subscribes and shows the result within seconds. Provider timeout must never roll back a completed checkout.
4. **The invoice number is the provider's, not yours.** Store their number alongside your folio id and treat theirs as the legal reference on every report.
5. Adjust/replace (*hóa đơn điều chỉnh / thay thế*) maps cleanly onto the append-only reversal model already decided in report 1 §6.2. No new concept needed.

### 6.2 ⚠ Buy chữ ký số **HSM / ký số từ xa** — never a USB token

Automated issuance from a cloud server requires the signing key to live in an HSM reachable by API (JWT-authenticated remote signing), not on a dongle. Viettel publishes an HSM signing solution for S-Invoice specifically; MISA, BKAV and others sell remote-signing certificates.

If you buy a USB-token certificate — the default thing a vendor sells a new company — **automated invoice issuance is impossible**. Someone plugs a dongle into a specific Windows PC for every checkout, and your PMS becomes a data-entry front-end for a portal. This decision is made months before the code and is annoying to reverse mid-certificate-term.

### 6.3 Provider recommendation

| Provider | Developer surface | Note |
|---|---|---|
| **Viettel S-Invoice** | RESTful, XML **and** JSON; public API documentation including an **English** document and a **Postman** integration guide; documented HSM signing solution | **Recommended default.** For a solo integrator who cannot get a vendor engineer on the phone, public docs + a Postman collection is the single biggest determinant of how long this takes |
| **MISA meInvoice** | Documented Open API covering templates, issue, sign, view, download, adjust/replace, email; integrates with 80+ systems including MISA AMIS accounting | **Pick this if your accountant works in MISA AMIS** — it removes a manual reconciliation step from their week, which is worth more than API polish |
| **VNPT Invoice** | Widely integrated, but the thinnest public developer documentation of the three | No reason to choose it over the other two unless a bank or partner requires it |

**Decision rule: ask the accountant first.** If they have a preference, take it — their reconciliation workload is a real cost and you are not the one carrying it. If they have no preference, **Viettel S-Invoice**.

---

## 7. What NOT to do

- ❌ **Don't run the API on Vercel/serverless functions.** pg-boss needs a long-running process; MoMo's 15s IPN deadline and Postgres connection pooling both punish cold starts.
- ❌ **Don't self-host Postgres on a VPS.** Report 1 §8.2 already said it; it is still true, and it is the single largest ops tax available to a solo dev.
- ❌ **Don't plan around Neon's scale-to-zero.** pg-boss cancels it (§3.1).
- ❌ **Don't use Vercel Hobby for a booking site.** Non-commercial terms.
- ❌ **Don't build the offline write path.** Ever. §4.
- ❌ **Don't buy a USB-token digital certificate.** §6.2.
- ❌ **Don't issue e-invoices in the night audit.** Nghị định 70/2025 wants point-of-sale issuance. §6.1.
- ❌ **Don't hand-roll VNPay signature generation.** Use the maintained Node library.
- ❌ **Don't start gateway onboarding at P3.** It is weeks of someone else's process. §5.3.
- ❌ **Don't put ID scans in the same bucket as room photos.** §3.3.
- ❌ **Don't share one database between staging and production.** Neon branching makes separation nearly free.
- ❌ **Don't add a CDN, a WAF, Redis, Kubernetes, or a second region.** At 40 rooms none of them have a problem to solve.

---

## 8. Efficiency wins (ranked, effort → impact)

| Instead of | Do | Saves |
|---|---|---|
| A scheduled job deleting expired ID scans | **R2 object lifecycle rule** | The retention guarantee stops depending on your cron working |
| Neon for local development | Docker Postgres (already required by Testcontainers) | Most of the Neon bill, and local/CI parity you already wanted |
| Hand-rolled VNPay HMAC + param sorting | `vnpay` Node library | The signature bug everyone ships once |
| Discovering the refund sandbox is locked at P3 | Request refund sandbox access during onboarding | A blocked fortnight at the worst point in the schedule |
| Ordinary HĐĐT + a migration later | Buy the *máy tính tiền* product now | A second integration against the same vendor |
| USB token, then re-procurement | HSM / remote signing certificate | The entire automation premise |
| Deciding on-site hosting from intuition | 60 days of uptime data from a free probe | An on-prem server you did not need, or an outage you did not plan for |
| Trusting Neon PITR as the backup | Weekly `pg_dump` → R2 + one drill | The recovery surviving a vendor account problem |
| MoMo at P3 alongside VNPay | MoMo at P3.5, gated on abandonment data | ~2 weeks, possibly permanently |

---

## 9. Trade-offs — including what your decisions cost

- **Offshore storage of VN citizen ID data** *(your decision)*: the legal question is open, not closed. Cost of being wrong is a migration under time pressure plus whatever the regulator says. Mitigation is cheap and you should take it anyway: one bucket, one code path, one config value — so relocating is a migration, not a rewrite. **Get a lawyer's answer before opening**, not before coding.
- **Single region, single instance** *(implied)*: a Singapore AZ event takes the whole system down. Correct trade at this scale; revisit never, unless the property grows.
- **Full online payment via VNPay** *(your decision)*: 1.1–2.2% of every booking forever, plus chargeback exposure and merchant onboarding, where VietQR bank transfer would have cost a flat monthly fee. You get conversion and a real refund API in exchange. Defensible — just know the fee is a permanent line item, not a setup cost.
- **Cloud-first with paper fallback** *(resolved)*: the front desk will, one day, run on paper for a few hours. That runbook (P7) is now load-bearing, not a formality. Write it as if it will be used, because it will.
- **Neon over a fixed-price managed Postgres**: usage-based billing means a runaway query or a connection leak shows up as money. Set a spend alert on day one.
- **Vercel Pro + Fly + Neon = three vendors** to keep credentials and billing for, solo. The alternative (everything on Fly) is one vendor and a worse Next.js experience. Three is the right number here, but it is three.
- **Deferring MoMo** *(my recommendation, against your stated scope)*: if wallet-only guests turn out to be a meaningful share, you launched with a gap and found out from lost bookings. The counter is that you will *see* it in the funnel data, and adding MoMo behind the existing port is ~2 weeks whenever you decide.

---

## 10. Work checklist

### Immediate — paperwork, runs in parallel with all code
- [ ] Ask the accountant: is there an e-invoice provider already, and do they work in MISA AMIS?
- [ ] Buy **chữ ký số HSM / ký số từ xa** — explicitly *not* a USB token
- [ ] Buy the **hóa đơn điện tử khởi tạo từ máy tính tiền** product (Viettel S-Invoice by default)
- [ ] Start VNPay merchant onboarding; **request refund sandbox access in the same application**
- [ ] Ask a lawyer: offshore storage of CCCD scans + registration records, and the statutory retention floor (closes report 1 §18 Q2)
- [ ] Confirm with the tax agent that Nghị định 70/2025 applies to this entity's activity codes

### P0 — infrastructure skeleton
- [ ] Neon project, `aws-ap-southeast-1`; `production` and `staging` branches; spend alert set
- [ ] Local Docker Postgres for development; Neon reserved for deployed environments
- [ ] Fly.io app in `sin`; Dockerfile for the Nest API; secrets via `fly secrets`
- [ ] Deploy hello-world API to production (report 1 §8.1 — do it in P0, not later)
- [ ] Vercel project for `apps/web`, function region `sin1`
- [ ] R2: **two buckets** — `mariva-assets` (public-ish) and `mariva-id-scans` (private, lifecycle rule)
- [ ] Resend domain verified: SPF, DKIM, DMARC
- [ ] Better Stack: `/health` uptime monitor + error tracking wired into the Nest exception filter
- [ ] Better Stack probe installed at the property the day the ISP line goes live — start the 60-day clock
- [ ] VNPay sandbox integration behind a `PaymentGateway` port; IPN idempotency test replaying the same callback 10×

### P3 — money paths
- [ ] VNPay production terminal; separate IPN URL from staging
- [ ] Refund flow tested against whatever sandbox access VNPay granted
- [ ] E-invoice issuance as an idempotent pg-boss job keyed on folio id; provider invoice number stored alongside folio id
- [ ] Adjust/replace invoice mapped onto folio reversal entries
- [ ] Daily gateway reconciliation job; discrepancy alerts to phone

### P3.5 — conditional
- [ ] Measure VNPay-only payment-step abandonment; add MoMo only if it is material

### P7 — hardening
- [ ] Weekly `pg_dump` → R2, encrypted, 8-week lifecycle
- [ ] **Restore drill executed and timed** against a scratch Neon branch
- [ ] Night-audit heartbeat monitor that pages when the audit does not check in
- [ ] Evaluate the 60 days of uptime data against the §4 rule; decide replica / no replica; **write the decision down**
- [ ] Paper fallback runbook, written as though it will be used

---

## 11. Success metrics

| # | Metric | Target |
|---|---|---|
| 1 | Pre-trigger monthly infra spend | **≤ $5** |
| 2 | Post-trigger monthly infra spend | **≤ $60**, alert configured above it |
| 3 | Trigger discipline | VNPay production credentials **not committed** until every §3.5 box is ticked |
| 4 | Restore drill | Full restore **< 1 hour**, executed and timed, **before** the first real booking |
| 5 | Backup independence | ≥1 restorable copy **outside** Neon, verified by drill |
| 6 | ID-scan retention | **0** objects older than N days post-checkout, enforced by R2 lifecycle and verified against a real object |
| 7 | ID-scan blast radius | ID scans in **1** bucket, reachable by **1** code path; `grep` for the bucket name outside that module → **0 hits** |
| 8 | VNPay IPN replayed 10× | **1** payment posted (report 1 metric #6) |
| 9 | MoMo IPN ACK latency (if built) | **< 15s** at p100; work happens in pg-boss, never inline |
| 10 | E-invoice issuance | **100%** of closed folios have a provider invoice number; failures retried and alerted, never silently dropped |
| 11 | E-invoice signing | **0** manual dongle steps in the checkout path |
| 12 | Night audit alerting | Missed audit pages you **within 30 min** |
| 13 | Neon staging cost | Suspends when idle — pg-boss workers disabled there, provable from the compute-hours graph |
| 14 | Connectivity decision | Made from **≥60 days** of measured uptime data, written down with the number that drove it |
| 15 | Gateway onboarding | VNPay application submitted in **P0**, not P3 |

---

## 12. Evidence separation

**Verified this session** (web sources, 2026-07-26):

- Neon regions: `aws-ap-southeast-1` Singapore available; **no Vietnam region**; Azure regions deprecated to new projects
- Neon PITR: Free 6h/1GB, Launch 7d, Scale 30d; history billed $0.20/GB-mo; compute $0.106/CU-h (Launch), storage $0.35/GB-mo
- Neon scale-to-zero is reset by any connection; background jobs/polling prevent suspension (Neon docs + maintainer discussion)
- Supabase PITR is a **$100/mo add-on** per 7-day window, requires ≥Small compute; Pro $25 includes a $10 compute credit
- Fly.io has region `sin`; Render has Singapore (Starter $7/mo); Railway has an Asia-Southeast region
- Cloudflare R2: $0.015/GB-mo, **$0 egress**, free tier 10 GB + 1M Class A + 10M Class B, non-expiring; supports presigned URLs, SSE, and **object lifecycle expiration** (GA)
- Resend: 3,000 emails/mo free capped at 100/day, one domain; Pro $20/mo at 50k; DKIM/SPF/DMARC all tiers; no dedicated IP below Scale
- Sentry Developer free: 5k errors/mo, 1 user. Better Stack free: 100k exceptions/mo, Sentry-SDK compatible, bundles uptime + incident management
- VNPay: sandbox at `sandbox.vnpayment.vn`, API base `/merchant_webapi/`, docs `/apis/docs/gioi-thieu/`; IPN URL set in terminal admin; **IPN may be sent multiple times**; **refund is restricted in sandbox and requires contacting VNPay**; `verifyIpnCall`/`verifyReturnUrl` signature verification; maintained Node library at vnpay.js.org
- MoMo: RESTful JSON, merchant-private-key signing / MoMo-public-key verification, **IPN must be answered within 15 seconds**, refund incl. partial refund
- **Nghị định 70/2025/NĐ-CP**, effective 01/06/2025: businesses selling directly to consumers — list explicitly includes **khách sạn** — must use hóa đơn điện tử khởi tạo từ máy tính tiền with data transmitted to the tax authority; invoice created, signed and issued immediately from the POS device
- Chữ ký số HSM / ký số từ xa: keys in FIPS 140-2 L3 HSM, JWT-authenticated remote signing API, enables automated server-side invoice signing without USB token; Viettel publishes an HSM signing solution for S-Invoice
- Viettel S-Invoice: RESTful, XML + JSON, public API docs incl. an English document and a Postman integration guide
- MISA meInvoice: documented Open API (templates, issue, sign, view, download, adjust/replace, email), 80+ system integrations incl. MISA AMIS

**High confidence, standard practice, not verified here:**

- Vercel Hobby's non-commercial restriction (long-standing, but **read the current terms before relying on it**)
- Neon branching as staging/preview isolation
- R2 lifecycle rules applying to the ID-scan expiry pattern as described

**NOT verified — check before relying on:**

- Whether Nghị định 70/2025 applies to *this entity's* registered activity codes and form (much published guidance addresses hộ kinh doanh ≥1 tỷ; the doanh nghiệp obligation is stated separately). **Confirm with the tax agent.**
- VNPay's exact onboarding document list, fee schedule, and review timeline
- Whether VNPay grants refund sandbox access on request, and how long it takes
- Vietnamese data-residency obligations for CCCD scans held offshore (Nghị định 53/2022, Nghị định 13/2023) — **still open from report 1 §17, still needs a lawyer**
- Statutory retention floor for the registration record (report 1 §18 Q2)
- Current Neon/Fly/Vercel/Resend pricing at *your* signup date — these move

---

## 13. Unresolved questions

1. **Does Nghị định 70/2025's máy-tính-tiền obligation bind this entity?** Determines which e-invoice SKU to buy. Blocks the purchase, not the code. → tax agent.
2. **Accountant's existing e-invoice/accounting platform** — if MISA AMIS, switch the recommendation to meInvoice.
3. **Offshore residency of CCCD data** — carried over from report 1. Answer needed before opening, not before building.
4. **VNPay refund sandbox access** — if refused, the refund path can only be exercised in production against real money. Changes P3 test strategy materially.
5. **Property ISP and its measured uptime** — the §4 rule cannot execute until this exists.
6. **Vercel Hobby terms** — confirm before assuming Pro is required; $20/mo either way, but worth 5 minutes.
7. Carried over unresolved from predecessors: `@orpc/nest` compile-time contract enforcement spike (stack §13 Q2), Bklit accessibility (Q4), exceljs replacement (Q5), OTA channel manager (report 1 §18 Q4).
