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
| `NO_SHOW` | Arrival night passed without check-in | Arrival night retained, rest released | No |

**Why no `EXPIRED` state.** An abandoned hold and a guest cancellation differ in
*reason*, not in what the system must do. Both release inventory and end the
booking. `CANCELLED` carries a reason code — `HOLD_EXPIRED`, `GUEST_REQUEST`,
`STAFF_ERROR`, `PAYMENT_FAILED`, `OVERBOOK_WALK`, `FORCE_MAJEURE` — and the
reason drives the penalty, not the state. Adding a seventh state buys nothing
and doubles the transition table.

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
  and it fails if the room was resold.
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
| `CONFIRMED` → `NO_SHOW` | Release nights **after** the arrival night | No-show charge per policy | Written by the night audit |
| `CHECKED_IN` → `CHECKED_OUT` | Release unspent nights | Folio must balance; invoice job enqueued | Room → `DIRTY` |
| `NO_SHOW` → `CHECKED_IN` | Re-consume remaining nights, fail if unavailable | Reverse the no-show charge | `MANAGER` only |

## 4. Guards

Rejections that are not about the state pair.

| Guard | Applies to | Rejects when |
|---|---|---|
| Arrival window | → `CHECKED_IN` | Business date < arrival date and early check-in disabled ⚑, or business date > departure date |
| Room required | → `CHECKED_IN` | No assignment, or assignment violates the `EXCLUDE USING gist` constraint |
| Room ready | → `CHECKED_IN` | Housekeeping status is not `CLEAN` or `INSPECTED` ⚑ |
| Folio settled | → `CHECKED_OUT` | Balance ≠ 0 and no approved deferred settlement |
| Inventory available | → `HELD`, → `CONFIRMED`, extend, reinstate | `sold_rooms > total_rooms` — enforced by the `CHECK`, surfaced as `409` |
| Idempotency | every transition | Same transition already applied; return the current state, do not error |

## 5. Operations that do not change state

These are where most real front-desk work happens. Legality is per state, and
each is a separate endpoint with its own `@RequiresCapability()` declaration.

| Operation | Legal in | Notes |
|---|---|---|
| Assign / reassign room | `CONFIRMED`, `CHECKED_IN` | Never moves a different checked-in guest |
| Room move | `CHECKED_IN` | New assignment row; old one closed at today's date |
| Extend stay | `CONFIRMED`, `CHECKED_IN` | Needs inventory for the added nights; fails cleanly |
| Shorten stay / early departure | `CHECKED_IN` | Releases nights, posts the early-departure charge |
| Change room type (upgrade) | `CONFIRMED`, `CHECKED_IN` | Inventory moves between types atomically |
| Change rate | `CONFIRMED`, `CHECKED_IN` | Below the plan price is `MANAGER` only |
| Post charge / payment | `CHECKED_IN`, `CONFIRMED` | Deposits post pre-arrival |
| Add or edit guest details | all but `CANCELLED` | |

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
   Assumed blocked, config flag ready.
2. **Check-in into a `DIRTY` room** — some properties permit it with a manager
   override. Assumed blocked outright.

Not a decision here: the no-show charge amount and the cancellation deadline
grid. They are not state-machine questions, but the transitions above cannot be
tested without them — tracked as `D3` in `plans/backlog.md` §1.
