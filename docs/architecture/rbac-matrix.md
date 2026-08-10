# RBAC matrix

Authority for the capability guard, the role test in P0.03, and the use-case
diagram. Change this file first, then the code.

**The code mirror.** §3 is mirrored, row for row and in the same order, by
`apps/api/src/modules/identity/rbac/matrix.ts`. A route declares which row
governs it — `@RequiresCapability("booking.check-in")` — and
`common/auth/access.guard.ts` is the only thing that reads a grant. The mirror
is not generated: it is typed by hand and checked by
`rbac/matrix.spec.ts` (unique keys, the `ADMIN ⊇ MANAGER` rule of §2, exactly
one public row) and exercised row by row by `common/auth/access.guard.spec.ts`,
which is §4's obligation.

Two things the implementation had to settle that this document did not say:

- **A guest session on a staff row is 403, an anonymous request is 401.** §1
  already required the first; the second is what "sign in" means when nobody
  has. A route with no declaration at all is 403 for everyone, including an
  administrator, because the refusal is about the route rather than the caller.
- **The public row is public.** Row 1 of §3 is marked *Public, unauthenticated*,
  and the guard lets anyone reach it — including a signed-in housekeeper, whose
  column says `—`. The role columns on that row describe what a screen should
  offer, not a wall; enforcing them would refuse a member of staff a page any
  stranger can load.

**Status:** proposed defaults. Derived from the advisory reports plus ordinary
hotel practice. **Five** decisions are the owner's call, not an engineering one.
Each is marked ⚑ wherever it bites — §1, §2 or a matrix row — so one decision
can mark two rows and the mark count is not the decision count. **§5 is the
authority for the number.** Everything else can stand as written.

## 1. Realms

Two authentication realms, no token opens both.

| Realm | Roles | Auth |
|---|---|---|
| Guest | `GUEST` | Better Auth |
| Staff | `RECEPTIONIST`, `HOUSEKEEPING`, `ACCOUNTANT`, `MANAGER`, `ADMIN` ⚑ | Passport-JWT |

⚑ No separate night-auditor role — §5 decision 4.

Asserted in both directions: a guest token on a staff route is 403, a staff
token on a guest route is 403. Not 401 — the token is valid, the realm is wrong.

## 2. Rules

- **Deny by default.** A route with no `@RequiresCapability()` is unreachable,
  not public. The one escape hatch is `@Unguarded("<reason>")`, which takes a
  written reason and is used by exactly two kinds of route: the ones that issue
  a session (staff sign-in, refresh, sign-out, and everything Better Auth
  mounts) and the liveness probe, which has no subject.
- **👁 is enforced, not documentation.** A row is wider than a route — "Rate
  plans, rate calendar, promotions" is one row a receptionist may look at and a
  manager may change — so a route declares which of the two it is:
  `@RequiresCapability("pricing.rate-plans", "read")` beside a bare
  `@RequiresCapability("pricing.rate-plans")`, which is a write. A 👁 grant
  reaching a write route is a 403. The second argument defaults to `write`
  because that is the safe half of forgetting it: a read route left at the
  default refuses a 👁 role and gets reported, where the other default would
  hand one a write path silently. ⚠ satisfies a write — it is a full grant whose
  scope the guard cannot see, and the handler still owes that check.
- **`ADMIN` ⊇ `MANAGER`.** ⚑ §5 decision 5. Admin adds user management, system config and
  operational plumbing on top of every manager permission. At one property with
  one owner, forcing an account switch to void an invoice is friction that gets
  bypassed. The audit log records the actor, so attribution survives.
- **Money authority splits from operational authority.** A receptionist moves
  guests and takes payments; reversing a posting or waiving a penalty is a
  different role. This is the only place the matrix is deliberately strict.
- **Policy vs override are separate endpoints**, not one endpoint with an
  amount check. `folio.refund-policy` and `folio.refund-override` carry
  different `@RequiresCapability()` declarations. Same for cancellation penalty
  and rate override.
- **Guest permissions are always scoped to the requester's own record.**
  Ownership is checked in the handler; the role alone never grants access.

Legend: ✅ full · 👁 read-only · ⚠ conditional, see notes · — denied

## 3. Matrix

### Public and guest realm

| Capability | G | RCP | HK | ACC | MGR | ADM | Notes |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| Availability + rate search | ✅ | ✅ | — | 👁 | ✅ | ✅ | Public, unauthenticated |
| Create own booking | ✅ | ✅ | — | — | ✅ | ✅ | Staff create on behalf |
| Read own booking / stay history | ⚠ | — | — | — | — | — | Own records only |
| Cancel own booking | ⚠ | — | — | — | — | — | Own, penalty per policy |
| Own profile, loyalty, VIP tier | ⚠ | 👁 | — | — | 👁 | 👁 | |
| Upload own ID scan | ⚠ | — | — | — | — | — | |
| Post-stay feedback | ⚠ | — | — | — | 👁 | 👁 | Tied to a `CHECKED_OUT` booking |

### Bookings and front desk

| Capability | G | RCP | HK | ACC | MGR | ADM | Notes |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| Read any booking | — | ✅ | — | 👁 | ✅ | ✅ | |
| Create / modify booking | — | ✅ | — | — | ✅ | ✅ | |
| Cancel with policy penalty | — | ✅ | — | — | ✅ | ✅ | |
| Cancel with waiver / override | — | — | — | — | ✅ | ✅ | ⚑ Waives any cell of `property-and-tariff.md` §4, not only a cancellation |
| Check-in | — | ✅ | — | — | ✅ | ✅ | Requires assigned room |
| Check-out | — | ✅ | — | — | ✅ | ✅ | Requires settled folio |
| Assign room / room move | — | ✅ | — | — | ✅ | ✅ | |
| Extend stay | — | ✅ | — | — | ✅ | ✅ | Fails without inventory |
| Early checkout (policy charge) | — | ✅ | — | — | ✅ | ✅ | |
| Mark `NO_SHOW` manually | — | — | — | — | ✅ | ✅ | Night audit does it automatically |
| Reinstate `NO_SHOW` → `CHECKED_IN` | — | — | — | — | ✅ | ✅ | Late arrival; needs inventory |
| Search rooms / guests / bookings | — | ✅ | ⚠ | 👁 | ✅ | ✅ | HK: rooms only |

### Housekeeping and room state

| Capability | G | RCP | HK | ACC | MGR | ADM | Notes |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| Set `CLEAN` / `DIRTY` / `INSPECTED` | — | ✅ | ✅ | — | ✅ | ✅ | |
| Set `OUT_OF_ORDER` status | — | ✅ | ✅ | — | ✅ | ✅ | Room state only |
| Room closure reducing sellable inventory | — | — | — | — | ✅ | ✅ | Changes `total_rooms` — a commercial act, not a cleaning one |
| Housekeeping board | — | ✅ | ✅ | — | ✅ | ✅ | |

### Rooms, rates, inventory

| Capability | G | RCP | HK | ACC | MGR | ADM | Notes |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| Room type + room CRUD | — | — | — | — | ✅ | ✅ | |
| Rate plans, rate calendar, promotions | — | 👁 | — | 👁 | ✅ | ✅ | |
| Read the service catalog | — | 👁 | — | 👁 | 👁 | 👁 | What is for sale; posting one is a folio row |
| Stay restrictions (min/max, CTA/CTD) | — | 👁 | — | — | ✅ | ✅ | |
| Rate override on a booking | — | — | — | — | ✅ | ✅ | ⚑ Beyond the plan's price |
| Overbooking limits (P6.5) | — | — | — | — | ✅ | ✅ | |

### Folio and money

| Capability | G | RCP | HK | ACC | MGR | ADM | Notes |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| Read folio | ⚠ | ✅ | — | ✅ | ✅ | ✅ | Guest: own, settled view |
| Post charge (room, service, minibar) | — | ✅ | — | ✅ | ✅ | ✅ | |
| Post payment | — | ✅ | — | ✅ | ✅ | ✅ | |
| Open a gateway payment attempt | — | ✅ | — | ✅ | ✅ | ✅ | Staff open it; the guest funnel is M7 |
| Refund within policy | — | ✅ | — | ✅ | ✅ | ✅ | ⚑ |
| Refund override / discretionary | — | — | — | — | ✅ | ✅ | ⚑ |
| Reverse a posting | — | — | — | ✅ | ✅ | ✅ | Never a delete |
| Close folio, issue invoice | — | ✅ | — | ✅ | ✅ | ✅ | |
| Invoice adjust / replace | — | — | — | ✅ | ✅ | ✅ | *điều chỉnh / thay thế* |
| Gateway reconciliation | — | — | — | ✅ | ✅ | ✅ | |
| Income / expense (thu chi) | — | — | — | ✅ | ✅ | ✅ | |
| Cash drawer open / close / count | — | ⚠ | — | 👁 | ✅ | ✅ | RCP: own shift |
| Shift handover notes | — | ⚠ | — | 👁 | ✅ | ✅ | RCP: own shift |

### Guest personal data

| Capability | G | RCP | HK | ACC | MGR | ADM | Notes |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| Read guest record, CCCD masked | — | ✅ | — | ✅ | ✅ | ✅ | |
| Unmask CCCD number | — | ⚠ | — | — | ✅ | ✅ | Audit-logged per call |
| Upload ID scan | ⚠ | ✅ | — | — | ✅ | ✅ | Own, for guest. Transcribe-and-discard — the image is never stored (`FR-GST-02`) |

No row views a scan image and no row deletes one. Neither is a permission this
matrix withholds; both are permissions over an object that does not exist,
because `FR-GST-02` checks the document, records its particulars on the
registration and keeps no picture. A row granting `MANAGER` a look at a file
nothing writes would read as an oversight the first time somebody built the
screen.

### Reports and audit

| Capability | G | RCP | HK | ACC | MGR | ADM | Notes |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| Operational reports (arrivals, in-house) | — | ✅ | ⚠ | — | ✅ | ✅ | HK: own board |
| Occupancy / ADR / RevPAR | — | — | — | 👁 | ✅ | ✅ | |
| Revenue and financial reports | — | — | — | ✅ | ✅ | ✅ | |
| Excel export | — | ⚠ | — | ✅ | ✅ | ✅ | RCP: operational lists only |
| Audit log viewer | — | — | — | ⚠ | ✅ | ✅ | ACC: financial entries only |

### System

| Capability | G | RCP | HK | ACC | MGR | ADM | Notes |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| Staff accounts + role assignment | — | — | — | — | — | ✅ | |
| System config (tax rates, business date, gateway credentials) | — | — | — | — | 👁 | ✅ | |
| Trigger night audit manually | — | — | — | — | ✅ | ✅ | |
| Job queue / dead-letter inspection | — | — | — | — | — | ✅ | |

## 4. Test obligation

P0.03 ships a test that, for **every** row above, asserts the allowed roles get
through and **at least one denied role gets a 403**. A row added here without a
test line is a gap; make the test data-driven off a single exported table so
they cannot drift.

Cross-realm assertions are separate and non-negotiable: guest token → staff
route → 403; staff token → guest route → 403.

**Discharged**, and more strictly than written: `access.guard.spec.ts` asserts
*every* denied role on every row, not one of them, because the table names them
all and checking one of six is a choice with nothing to recommend it. Every row
is also put to the guard twice, as a route that reads it and as a route that
writes it, so each 👁 in §3 is asserted to pass the first and be refused the
second. Both cross-realm directions are asserted over the full set of rows that
admit only one realm. The subject of that suite is the guard with the two realms stubbed at
the point where they produce a principal; `test/auth.e2e-spec.ts` covers the
other half — real passwords, real tokens, real cookies, real Postgres — over
the routes that exist so far.

## 5. Decisions still the owner's

**Five.** This list is the count every other document quotes. Each ⚑ mark above
points back to a number here; a decision that touches two rows still counts
once. It was six until `FR-GST-02` stopped storing identity-document images:
"should `ACCOUNTANT` see ID scan images?" is not answered, it is dissolved, and
a question with no subject left is not a decision anybody is owed.

1. Can a receptionist issue any refund unsupervised, or does every refund need a
   manager? Assumed: policy-calculated refunds yes, discretionary no.
2. Can a receptionist waive a penalty from `property-and-tariff.md` §4's grid?
   Assumed no — for every cell, not only the two cancellation rows. A no-show
   and an early departure are waivable by `MANAGER`+ on the same authority; see
   §4 for why the waiver rides on the booking rather than on the grid, and for
   the ⚑ route that does not exist yet.
3. Can a receptionist change a room rate below the plan? Assumed no.
4. Does the property want a separate night-auditor role? Assumed no — the job
   runs unattended; `MANAGER` covers manual reruns.
5. Should `ADMIN` really inherit `MANAGER`? Assumed yes, for the reason in §2.
