# Booking state machine

Authority for the transition table the code enforces, the illegal-transition
tests in P2, and the generated state diagram. Change this file first.

**Status:** proposed defaults. **Two** decisions are the owner's call, each
marked ⚑ at the guard it governs and listed in §7. §7 is the authority for the
number; the trailing note there is a pointer to `D3`, not a third decision.

## 1. States

Six, and no more. Variants that look like states are reason codes instead.

| State | Meaning | Inventory | Room assigned |
|---|---|---|---|
| `HELD` | Cart or tentative booking, TTL running | Consumed, all nights | No |
| `CONFIRMED` | Deposit taken or staff-confirmed | Consumed, all nights | Optional |
| `CHECKED_IN` | Guest in house | Consumed, remaining nights | **Yes** |
| `CHECKED_OUT` | Stay complete, folio closed | Consumed nights spent | Historical |
| `CANCELLED` | Terminal, did not occur | Released | No |
| `NO_SHOW` | Arrival night passed without check-in | Arrival night retained, rest released | Arrival night only |

**Why a no-show keeps a room.** The room follows the counter, and the counter
keeps the arrival night — it is the night the no-show charge is levied against,
and a night the property is charging for is not a night it has resold. Cutting
the hold back to that one night rather than dropping it keeps the two inventory
layers saying the same thing: a room shown occupied for the night being paid for,
sellable for every night after it. It is also what makes §2's "it fails if the
room was resold" a sentence the code can enforce — without a hold to collide
with, `room_assignment_no_double_booking` has nothing to refuse and a reinstated
guest walks into an occupied room.

**Why no `EXPIRED` state.** An abandoned hold and a guest cancellation differ in
*reason*, not in what the system must do. Both release inventory and end the
booking. `CANCELLED` carries a reason code — `HOLD_EXPIRED`, `GUEST_REQUEST`,
`STAFF_ERROR`, `PAYMENT_FAILED`, `OVERBOOK_WALK`, `FORCE_MAJEURE` — so the
distinction is recorded without a seventh state, which would buy nothing and
double the transition table.

**What the reason code is, and is not.** It is the audit record of *why* the stay
ended, and it prices nothing. `property-and-tariff.md` §4's grid is keyed on the
event — cancellation against its deadline, no-show, early departure — and the
rate plan, and it has no reason column; `cancellation-calculator.ts` mirrors that
exactly and takes no reason. Setting a cell aside is an authority rather than a
reason: waiving any cell is `MANAGER` or above (§4 again, and `rbac-matrix.md`
§5 decision 2), granted through `booking.cancel-waiver` and recorded on the
booking as `penalty_waived_at` and `penalty_waived_by`. The two are orthogonal on
purpose — a manager may waive a `GUEST_REQUEST`, and a `STAFF_ERROR` nobody
waived is still priced by the grid — because a reason code the guest supplies
would otherwise decide what the property charges.

The instant a cancellation arrived is `cancelled_at`, written by the database in
the transaction that ends the stay. §4's free window turns on it against an 18:00
deadline, so it is a column of its own rather than a reading of `updated_at`:
`CANCELLED` is terminal but the row is not, and any later touch would move a
cancellation across that deadline.

## 2. Transitions

`✔` legal, `✘` rejected with `409 IllegalTransition`.

| From ↓ To → | `HELD` | `CONFIRMED` | `CHECKED_IN` | `CHECKED_OUT` | `CANCELLED` | `NO_SHOW` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| *(new)* | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ |
| `HELD` | — | ✔ | ✘ | ✘ | ✔ | ✘ |
| `CONFIRMED` | ✘ | — | ✔ | ✘ | ✔ | ✔ |
| `CHECKED_IN` | ✘ | ✘ | — | ✔ | ✘ | ✘ |
| `CHECKED_OUT` | ✘ | ✘ | ✘ | — | ✘ | ✘ |
| `CANCELLED` | ✘ | ✘ | ✘ | ✘ | — | ✘ |
| `NO_SHOW` | ✘ | ✘ | ✔ | ✘ | ✘ | — |

Three entries deserve their reason:

- **`CHECKED_IN` → `CANCELLED` is illegal.** The guest is in the building; the
  stay happened. Shortening it is *early checkout*, which posts a policy charge
  and settles a folio. Allowing cancellation here would let someone erase a stay
  that consumed a room and produced revenue.
- **`NO_SHOW` → `CHECKED_IN` is legal.** A guest landing at 02:00 after the
  night audit ran is an ordinary event, not a data-entry error. `MANAGER` only,
  and it fails if the room was resold. The room may be named at the transition,
  and must be when the booking is holding none — §1 makes an assignment optional
  in `CONFIRMED`, and §5 makes assigning one legal from `CONFIRMED` and
  `CHECKED_IN` only, so a stay written off without a room has no other door to
  one. The same door takes a guest whose own room went out of order overnight.
- **Direct creation as `CONFIRMED`** is how the front desk books a walk-in or a
  phone reservation. Only the public funnel starts at `HELD`.

## 3. Transition effects

| Transition | Inventory | Money | Other |
|---|---|---|---|
| → `HELD` | `sold_rooms += 1` per night | None | TTL timer starts |
| `HELD` → `CONFIRMED` | Unchanged | Deposit posted if taken | Confirmation email |
| `HELD` → `CANCELLED` | Release all nights | Refund deposit if any | Reason `HOLD_EXPIRED` when the TTL job fires |
| `CONFIRMED` → `CANCELLED` | Release all nights | Penalty per policy, refund remainder | Reason code required, always |
| `CONFIRMED` → `CHECKED_IN` | Unchanged | First room-night posted by night audit, not at check-in | Room assignment mandatory; registration record written |
| `CONFIRMED` → `NO_SHOW` | Release nights **after** the arrival night | No-show charge per policy | Room hold cut back to the arrival night; written by the night audit |
| `CHECKED_IN` → `CHECKED_OUT` | Release unspent nights | Folio must balance; invoice job enqueued | Room → `DIRTY`, unless it is `OUT_OF_ORDER` |
| `NO_SHOW` → `CHECKED_IN` | Re-consume remaining nights, fail if unavailable | Reverse the no-show charge | `MANAGER` only; room may be named, and must be when none is held |

**Who makes `HELD` → `CONFIRMED`.** Two callers, and the funnel's is not the
desk's. The desk confirms by hand under `booking.write`. A guest paying online
never touches that route — no guest holds the capability — so the transition is
made by the gateway callback that takes the money, in the same commit as the
payment and the folio line (`payment.service.ts`). That is what the caption
"deposit taken" means in practice, and it is not optional: a paid stay left
`HELD` is one the TTL sweep above cancels within two minutes, releasing a room
the guest has paid for.

Only a hold moves. Money reaching a stay that is already `CONFIRMED` or
`CHECKED_IN` is a balance rather than a deposit, and a callback against one
posts the payment and changes no state — a refusal there would roll back money
the gateway has already taken. The same is true of a callback that arrives after
the sweep has cancelled the hold: the payment posts, the cancellation stands, and
the nightly reconciliation is what surfaces the pair.

## 4. Guards

Rejections that are not about the state pair.

| Guard | Applies to | Rejects when |
|---|---|---|
| Arrival window | → `CHECKED_IN` | Business date < arrival date and early check-in disabled ⚑, or business date > departure date |
| Room required | → `CHECKED_IN` | No assignment, or assignment violates the `EXCLUDE USING gist` constraint |
| Room ready | → `CHECKED_IN` | Housekeeping status is not `CLEAN` or `INSPECTED` ⚑ |
| Folio settled | → `CHECKED_OUT` | Balance ≠ 0 and no approved deferred settlement |
| Arrival reached | → `NO_SHOW` | Business date < arrival date — §1 defines the state as an arrival night that passed, and a guest cannot have failed to arrive for a night the property has not got to. On the arrival date it passes: the 04:00 rollover means the audit closing the night of `D` reads business date `D` |
| Inventory available | → `HELD`, → `CONFIRMED`, extend, reinstate | `sold_rooms > total_rooms` — enforced by the `CHECK`, surfaced as `409` |
| Idempotency | every transition | Same transition already applied; return the current state, do not error |

## 5. Operations that do not change state

These are where most real front-desk work happens. Legality is per state, and
each is a separate endpoint with its own `@RequiresCapability()` declaration.

| Operation | Legal in | Notes |
|---|---|---|
| Assign / reassign room | `CONFIRMED`, `CHECKED_IN` | Never moves a different checked-in guest |
| Room move | `CHECKED_IN` | New assignment row; old one closed at today's date; the vacated room goes to `DIRTY` |
| Extend stay | `CONFIRMED`, `CHECKED_IN` | Needs inventory for the added nights; fails cleanly |
| Shorten stay / early departure | `CHECKED_IN` | Releases nights, posts the early-departure charge |
| Change room type (upgrade) | `CONFIRMED`, `CHECKED_IN` | Inventory moves between types atomically; a checked-in guest's old room goes to `DIRTY` |
| Change rate | `CONFIRMED`, `CHECKED_IN` | Below the plan price is `MANAGER` only |
| Post charge / payment | `CHECKED_IN`, `CONFIRMED` | Deposits post pre-arrival |
| Add or edit guest details | all but `CANCELLED` | |

**Handing a vacated room back.** A move and a checked-in upgrade both leave a
slept-in room nobody is returning to, so both set it `DIRTY` — the same effect §3
gives check-out, and for the same reason: the property is not judging how dirty
the room is, it is recording that somebody was in it. Two rooms are left alone.
One the guest is already in, since a move naming it vacates nothing. And one that
is `OUT_OF_ORDER`: writing `DIRTY` clears the note with it, so a guest moved out
*because* the shower failed would take the reason for the withdrawal with them
and leave a room nobody has repaired one cleaning round from the next arrival.

## 6. Diagram

Source for the academic deliverable. Generate from the table in §2 rather than
maintaining it by hand.

```mermaid
stateDiagram-v2
    [*] --> HELD: public funnel
    [*] --> CONFIRMED: walk-in / phone
    HELD --> CONFIRMED: deposit taken
    HELD --> CANCELLED: TTL expiry / guest
    CONFIRMED --> CHECKED_IN: arrival + room assigned
    CONFIRMED --> CANCELLED: policy penalty
    CONFIRMED --> NO_SHOW: night audit
    CHECKED_IN --> CHECKED_OUT: folio settled
    NO_SHOW --> CHECKED_IN: late arrival (MANAGER)
    CHECKED_OUT --> [*]
    CANCELLED --> [*]
```

## 7. Decisions still the owner's

**Two.** This list is the count every other document quotes.

1. **Early check-in** — allowed before the arrival date, or hard-blocked?
   Assumed blocked. `BOOKING_EARLY_CHECK_IN_ENABLED`, default off.
2. **Check-in into a `DIRTY` room** — some properties permit it, one check-in at
   a time, on a manager's override. Assumed blocked outright.
   `BOOKING_DIRTY_ROOM_CHECK_IN_ENABLED`, default off.

Both flags exist as of the check-in guard and are declared in `config/env.ts`.
They are the switch, not the decision: the defaults above are still what this
document assumes and not what an owner has chosen, and the flag is what makes
choosing otherwise a line rather than a guard.

The second flag is a **stand-in, not the mechanism**. An override is granted per
check-in, to a person, and recorded: `booking.check-in.override`, `MANAGER` and
above, a capability separate from `booking.check-in` because `rbac-matrix.md` §2
makes policy and override separate endpoints rather than one endpoint with a
check inside it. A property-wide environment variable is none of those things —
it says yes to every check-in at once and records nobody. `M4` ships it anyway
because the capability has no row in that matrix's §3 and no table exists to
write the approval into, which is the same missing pair that keeps §4's "no
approved deferred settlement" clause out of the check-out guard. Both land when
the audit record does.

Whichever grants it, it relaxes `DIRTY` and **only** `DIRTY`. `OUT_OF_ORDER` is
refused whatever it says, because `housekeeping-status.ts` files that status as a
room that cannot be occupied at all rather than one that is not ready yet — a
different question from the one asked here, and admitting a guest into a room
with a fault in it is not an answer to this one. The guard refuses the two with
different codes, `ROOM_NOT_READY` and `ROOM_OUT_OF_ORDER`, so the desk can call
housekeeping about the first and move the guest out of the second.

Not a decision here: the no-show charge amount and the cancellation deadline
grid. They are not state-machine questions, but the transitions above cannot be
tested without them — tracked as `D3` in `plans/backlog.md` §1.

## 8. What a booking stores about its price

**Settled.** A booking freezes the price it was quoted; it never re-derives one.

The inputs a price is computed from — the rate calendar, a plan's percentage,
its breakfast figure, the property's extra-person rate — are all rows the RBAC
matrix lets a manager edit. A booking recording only its dates, type and plan
code would hold a *recipe*, and re-running that recipe after any of those moved
answers with a number the guest never agreed to: a folio that contradicts the
confirmation, a refund against a rate nobody saw, and `M9`'s ADR computed off
today's tariff rather than the one that was sold.

So `booking` carries the agreed stay total and the three inputs that produced
it, and `booking_night` carries one row per night at the calendar price it was
sold at. Two consequences worth stating:

- The nights hold the **calendar** price, before the plan's percentage. §5 of
  [`property-and-tariff.md`](property-and-tariff.md) forbids rounding inside a
  calculation, and the pricing path honours it by summing the nights and
  dividing once over the whole stay. A stored per-night *adjusted* figure would
  divide per night, and the stored nights would then fail to sum to the stored
  total by a few đồng.
- A per-night figure is required rather than convenient. §4's grid charges "the
  first night" and refunds "the remaining nights at 50%", and neither may be
  approximated by dividing a total by a count when a weekend night costs more
  than a Tuesday.

Nothing above is a charge. `M4` computes cancellation, no-show and early-
departure amounts and persists none of them; the folio that posts them is `M6`.
