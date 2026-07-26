# RBAC matrix

Authority for the `@Roles()` guard, the role test in P0.03, and the use-case
diagram. Change this file first, then the code.

**Status:** proposed defaults. Derived from the advisory reports plus ordinary
hotel practice. **Six** decisions are the owner's call, not an engineering one.
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

- **Deny by default.** A route with no `@Roles()` is unreachable, not public.
  Public routes are marked explicitly.
- **`ADMIN` ⊇ `MANAGER`.** ⚑ §5 decision 6. Admin adds user management, system config and
  operational plumbing on top of every manager permission. At one property with
  one owner, forcing an account switch to void an invoice is friction that gets
  bypassed. The audit log records the actor, so attribution survives.
- **Money authority splits from operational authority.** A receptionist moves
  guests and takes payments; reversing a posting or waiving a penalty is a
  different role. This is the only place the matrix is deliberately strict.
- **Policy vs override are separate endpoints**, not one endpoint with an
  amount check. `refund.policy` and `refund.override` carry different
  `@Roles()`. Same for cancellation penalty and rate override.
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
| Cancel with waiver / override | — | — | — | — | ✅ | ✅ | ⚑ |
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
| Stay restrictions (min/max, CTA/CTD) | — | 👁 | — | — | ✅ | ✅ | |
| Rate override on a booking | — | — | — | — | ✅ | ✅ | ⚑ Beyond the plan's price |
| Overbooking limits (P6.5) | — | — | — | — | ✅ | ✅ | |

### Folio and money

| Capability | G | RCP | HK | ACC | MGR | ADM | Notes |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| Read folio | ⚠ | ✅ | — | ✅ | ✅ | ✅ | Guest: own, settled view |
| Post charge (room, service, minibar) | — | ✅ | — | ✅ | ✅ | ✅ | |
| Post payment | — | ✅ | — | ✅ | ✅ | ✅ | |
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
| View ID scan image | — | ⚠ | — | — ⚑ | ✅ | ✅ | Short-TTL signed URL, issuance audit-logged. RCP: in-house or within retention window. ⚑ `ACCOUNTANT` denied — §5 decision 5 |
| Upload ID scan | ⚠ | ✅ | — | — | ✅ | ✅ | Own, for guest |
| Delete ID scan | — | — | — | — | — | — | R2 lifecycle rule only — no manual path exists |

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
| System config (tax rates, retention `N`, business date, gateway credentials) | — | — | — | — | 👁 | ✅ | |
| Trigger night audit manually | — | — | — | — | ✅ | ✅ | |
| Job queue / dead-letter inspection | — | — | — | — | — | ✅ | |

## 4. Test obligation

P0.03 ships a test that, for **every** row above, asserts the allowed roles get
through and **at least one denied role gets a 403**. A row added here without a
test line is a gap; make the test data-driven off a single exported table so
they cannot drift.

Cross-realm assertions are separate and non-negotiable: guest token → staff
route → 403; staff token → guest route → 403.

## 5. Decisions still the owner's

**Six.** This list is the count every other document quotes. Each ⚑ mark above
points back to a number here; a decision that touches two rows still counts
once.

1. Can a receptionist issue any refund unsupervised, or does every refund need a
   manager? Assumed: policy-calculated refunds yes, discretionary no.
2. Can a receptionist waive a cancellation penalty? Assumed no.
3. Can a receptionist change a room rate below the plan? Assumed no.
4. Does the property want a separate night-auditor role? Assumed no — the job
   runs unattended; `MANAGER` covers manual reruns.
5. Should `ACCOUNTANT` see ID scan images? Assumed no — they carry the liability
   and answer none of the accounting questions.
6. Should `ADMIN` really inherit `MANAGER`? Assumed yes, for the reason in §2.
