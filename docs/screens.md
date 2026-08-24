# Screen intent

This document records why each user-facing surface exists and how the intended
journeys fit together. It does not report whether a screen is implemented.

Inspect [`apps/web/app`](../apps/web/app/) for current public routes and
[`apps/admin`](../apps/admin/) for the current staff surface. Use the
[GitHub issues](https://github.com/2351010154/resort-management/issues)
for status, assignment, labels, milestones and blockers.

## Guest surfaces

The public application has two visual modes: the marketing arrival sells the
resort; identity, booking and account work stay transactional and must not
inherit the marketing WebGL bundle.

### Arrival

`/` introduces the property through the marketing experience and leads into
booking.

### Identity

The guest identity journey needs distinct locations for sign-in, sign-up, email
verification, requesting a password reset and completing that reset. The
current route evidence is the `(booking)` route group under
[`apps/web/app`](../apps/web/app/).

Identity is never an interruption the funnel raises: a guest seeks out sign-in
themselves, at any time, from a menu at the top right of the guest surfaces,
which is how a returning guest reaches their account and stays without touching
the funnel.

Two intents about where identity leaves the guest, and both are waiting on the
same thing. A deliberate sign-in should never navigate: the guest returns to the
page they were on, everywhere — on the marketing arrival that means the page does
not change at all, the guest's name simply replacing the log-in message, and a
guest who wanted their stays opens the now-signed-in menu. Password reset is the
one identity flow that ends somewhere fixed, because the guest arrives from an
email link with no prior context; completing it should sign them in
automatically — they proved email ownership and set the password seconds ago —
and land them in the account area. Neither is built, and neither can be until the
account area is: with no authenticated surface to return to, sign-in lands
everyone on the arrival and a completed reset ends on the log-in screen.

Identity does not gate the booking funnel, and its absence there is a decision
rather than a gap. There is no separate search screen: everyone arrives through
`/booking` and finds their room from there, and the hold's door asks for nothing
at all — taking a hold is the application's first unauthenticated write
([`architecture/rbac-matrix.md`](architecture/rbac-matrix.md) §3, "Create own
booking"). A sign-in wall there would stand in front of the only thing a stranger
came to the site to do, and an account demanded before a room is held buys that
guest nothing. So the guest is first asked for anything at details, where a name
and an address are needed because that is where the confirmation goes, and the
account is offered afterwards, once the stay it would keep exists and is paid
for: from a link in the confirmation email, on `/bookings/<reference>/account`.
Guests are able to come back to earlier steps but are never forced to.

Email verification therefore never blocks the booking funnel — there is no
address in it to have proved. The typo risk is handled on screen instead: the
address is shown prominently at details and on confirmation, and the confirmation
screen gives the guest their reference regardless of email. What verification does
gate is sign-in itself. An account opened with a password cannot sign in until its
address is confirmed, because a booking confirmation sent to an address nobody
owns is a guest arriving to no reservation, so the address is proven before an
account can hold one.

Google sign-in behaves identically to email sign-in everywhere identity
appears — same menu, same return rules. Its one difference is that a Google
identity arrives with an email Google has already verified, so those guests are
never held at that gate.

### Booking journey

The intended journey has **five walked steps across five URL patterns**, and the
two numbers agree because two locations are unusual in opposite directions.
Search and room choice share `/booking`, told apart by a search param rather than
by a path segment because both are views of the same stateless query — see
[`architecture/repository-structure.md`](architecture/repository-structure.md)
§`(booking)`. The payment page holds a pattern of its own that the funnel never
walks through. The remaining steps each have their own location. Keeping the
asynchronous gateway return separate from confirmation prevents a browser
redirect from being mistaken for the payment result.

| Step | URL pattern | Guest intent |
|---|---|---|
| Search | `/booking` | Choose stay dates and confirm the stay |
| Room choice | `/booking?…&step=rooms` | Compare available room types and choose one |
| Details | `/booking/<hold>/details` | Review the stay as the property priced it, give a name and an address, and choose how to pay |
| Payment | `/booking/<hold>/payment` | Initiate payment — reached by a bookmark or a browser back, not by the funnel |
| Gateway return | `/booking/<hold>/confirming` | Wait for the authoritative payment notification |
| Confirmation and stay detail | `/bookings/<reference>` | View the resulting booking, return to it later, and act on the stay — cancel, provide the identity document, leave feedback — as its state allows |

The hold identifier appears only after inventory has been reserved. Confirmation
and later stay detail share one URL because they are the same guest-owned
resource, shown at different moments.

One guest surface sits outside the journey rather than in it.
`/bookings/<reference>/account` is where the confirmation email's second link
lands: it offers the guest an account that keeps this stay, which is the offer
the funnel deliberately did not make before taking their money.

Details is where the guest is first asked anything about themselves. The steps
before it are about rooms and nights, and the hold's door requires no name — a
hold that expires unpaid is inventory coming back, and the property has nothing
to send anybody about it. So the name and the email address are collected on the
review screen, beside the total and one press from the gateway, and that press
writes them and leaves for the provider in the same action. Payment keeps its own
URL because the guest still has to be able to come back to one — a browser back
out of the gateway, or a bookmark — but the funnel no longer walks through it.

### Account

The account area holds what a guest owns outside any single stay: `/account` is
the profile — personal data, VIP tier, loyalty — and `/account/stays` is stay
history, where each stay leads back to the same `/bookings/<reference>` surface
the funnel's confirmation ended on. Route placement and boundary rationale
belong in
[`architecture/repository-structure.md`](architecture/repository-structure.md).

The profile lets the guest edit the fields the next stay will consume: name,
phone, date of birth and nationality. The identity-document number is not among
them — the profile carries it masked and takes no new value, because that number
is confirmed against the physical document at the desk rather than asserted by
its subject. Profile edits feed forward
only: they prefill the guest's next booking and next check-in, and never
rewrite a past registration record, booking, folio or invoice — those are
point-in-time snapshots. The front desk remains the point of truth, confirming
the data against the physical document at check-in, so a guest-entered value is
a convenience claim rather than verified identity.

`/account` is also where the guest manages how they sign in. A guest with a
password changes it in place by proving the current one. The sign-in email can
be changed, but only through re-verification — the new address proves itself by
link before it becomes the identifier, reusing the verification machinery the
identity journey already has. A Google-only guest sees neither form: they have
no password to change, and their address belongs to Google. VIP tier and loyalty points appear as display-only facts:
no role can adjust them and no redemption path exists anywhere in the product,
so the screen states them and promises nothing more.

`/account/stays` lists upcoming stays first — they are the ones a guest can
still act on — then past stays in reverse order. The list only navigates:
cancelling an upcoming stay and leaving post-stay feedback both happen on
`/bookings/<reference>`, the one surface that
owns a stay's full context. This places the guest's cancel and feedback
capabilities ([`architecture/rbac-matrix.md`](architecture/rbac-matrix.md) §3):
each appears on the stay detail only when the booking's state allows it —
cancellation while the policy window is open, feedback once the stay is
checked out.

Identity documents get no guest surface at all — not an account screen, and not
a panel on the stay detail either. Two reasons, and the second is the load
bearing one. There is nothing to show: a scan is read once to fill in the
declaration and then discarded, never stored
([`architecture/rbac-matrix.md`](architecture/rbac-matrix.md) §3, `FR-GST-02`),
so anything the guest sent would be write-only in the literal sense — upload,
and nothing comes back. And there is nothing owed: recording the particulars
before the room changes hands is the property's obligation, discharged at the
desk, where check-in transcribes the document into the registration record by
keyboard. A pre-arrival panel would have been a convenience rather than a
second route to compliance, and it would have bought that convenience by
opening a second surface where document bytes arrive. So the guest is asked for
their document once, in person, and the account area says nothing about one.

## Staff surfaces

Every staff surface except login lives inside one authenticated shell — nav,
command palette, global hotkeys — because the console is keyboard-first; login
stands alone with no shell and no nav
([`architecture/repository-structure.md`](architecture/repository-structure.md)
§`apps/admin`).

### Console presentation

The staff console draws the brand's palette. Its semantic tokens live in
[`apps/admin/app/console-tokens.css`](../apps/admin/app/console-tokens.css), and
the colours behind them are the ivory, sand, stone, umber and dusk-amber of
[`packages/tokens/tokens.css`](../packages/tokens/tokens.css) — restated there
rather than imported, because that package also carries a type ramp the console
overrides. What the console adds on top is vocabulary the brand has no opinion
about: a card that sits above the ground, a border weight that is a real
boundary, and four status colours. Every pair a screen can draw is checked
against WCAG AA and the ratio is recorded beside the value. Dusk-amber is a
marker, a fill and a tint rather than a button or a focus ring: it is 2.7:1 on
ivory, so the ring and the strong text are darker ambers.

Figtree is the console's only typeface. UI copy has a 14px minimum,
regular-or-heavier weight, and no tracked or monospace body treatment.

The signed-in shell has a light ivory-warm rail grouped as **Today**,
**Reservations**, **Property**, **Money**, and **Management**. It collapses to
an icon rail before the content becomes cramped. The top bar keeps the hotel
business date, drawer state, handover action, and command-palette trigger in
reach. Navigation chords, screen hotkeys, roving focus, and the command registry
remain the shared interaction layer; visible shortcuts use key chips.

Screens compose the console kit rather than defining another local shell:
`PageHeader`, `FilterBar`, `DataTableFrame`, `DetailSheet`, `FormSection`,
`StatusChip`, `StatCard`, `EmptyState`, and the shadcn/Radix primitives. Queues
and ledgers use list-plus-detail layouts, Rooms uses a persistent split view,
Housekeeping uses touch-sized room keys, Rates keeps its two-axis calendar, and
reports place their range, metrics, chart, and table in separate surfaces.

Landing after login is role-aware: a receptionist, manager or admin lands on
the dashboard; housekeeping lands directly on the housekeeping board, the one
screen their day happens on; the accountant lands on payments. Each role
starts where its work starts instead of clicking through a screen meant for
someone else.

The dashboard is a launchpad, not a report: today's arrivals awaiting
check-in, departures awaiting checkout, rooms not yet ready and unsettled
folios, each count leading into its family screen. KPIs deliberately stay in
Reports — the dashboard's main user, the receptionist, is denied occupancy,
ADR and RevPAR by the RBAC matrix, and one screen must not serve two
audiences.

Under the four counts it carries what the same three answers already contain:
every room by state as a tally and a proportion bar, the first few stays behind
the arrivals and departures figures by name and room, and the operator's own
drawer with the handover items the last shift left outstanding. None of it adds
a request and none of it is a rate — room counts are facts about the building,
where occupancy as a percentage is the KPI that stays in Reports. The drawer
acts open the same surfaces the command palette opens, so the shift still never
owns a screen visit.

Arrivals is a worked queue, not a report. Picking a row opens a keyboard-driven
check-in sequence in place — confirm the guest and their identity document
(the desk scanner emulates a keyboard, so the form accepts typed input first
and an image second), assign a ready room, post the deposit if one is due,
check in — and returns to the list for the next arrival. The sequence exists
because check-in happens in bursts: the screen is optimised for ten guests at
two o'clock, not one.

Departures mirrors arrivals: picking a row opens the checkout sequence —
review the folio's charges, collect any balance, close the folio and issue the
legal e-invoice, check out — and returns to the queue. The receptionist never
leaves the screen during the morning rush; the Folios and Payments families
exist for work *outside* a checkout — corrections, reconciliation and the
accountant's read — not as detours inside one.

Shifts frame the receptionist's day but never own a screen visit. The current
shift lives in the shell's top bar, and opening, counting, closing and handing
over are command-palette actions available from any screen; the Shifts family
screen is the history — past shifts, variances, handover notes — read by
managers and the accountant. Cash is what couples shifts to everything else:
every cash payment belongs to an open shift, or drawer variance means nothing.
The console enforces this without blocking the queue — a cash payment with no
open shift prompts the receptionist to open one in place, count the drawer and
continue. Gateway payments need no shift; they reconcile against the gateway's
own report.

The same coupling runs the other way, and it is the one thing a receptionist
sees of Finance. A cash income or expense also names the drawer it moved
through, so what a shift is expected to hold is its float, plus the cash guests
paid in, less what the property spent from the till. Only the accountant and
management may record one — the desk holds the money and does not book what left
it — so from the receptionist's side that figure moves without them, and the
count they sign has to agree with it. A drawer already counted out takes no
further entry: its variance stands on the count that closed it.

Bookings opens anchored on today — arriving, in-house and departing stays —
with the full search (room number, type, status, date range, guest name and
phone) one keystroke away; the common case is a guest calling about a current
stay, and it should need zero typing. Creation serves two callers the funnel
cannot: the phone booking stops at `CONFIRMED` and surfaces in arrivals on its
date, while the walk-in — whose booking and check-in are one conversation at
the desk — flows straight from creation into the same check-in sequence
arrivals uses. A guest standing at the desk is never parked in a queue.

The housekeeping board is the console's one deliberate exception to
keyboard-first: housekeepers walk the floors with a phone, so the board is a
touch-first grid of rooms by floor with large targets for advancing a room's
state. It shows readiness, occupied/vacant, the room's type and who last
touched it — and nothing beyond that, because housekeeping sees no money and no
guest names. A room is assignable at `CLEAN`;
`INSPECTED` is an optional quality pass a manager or receptionist records,
because at a property this size a mandatory inspection would make one person a
bottleneck for every check-in.

Guests shows the record with its identity number masked; the number carries a
reveal control that shows the value in place, writes one audit entry, and
re-masks when the staff member leaves the record. Revealing is per field and
per visit so an audit entry means exactly "this person looked at this number
once" — the strongest story the audit log can tell. There is no scan image
beside it to open: the document is checked at the desk and its particulars go on
the registration, so the masked number and its reveal control are the whole of
what this screen holds about an identity document.

Rooms keeps its two kinds of "unavailable" on the room's detail, framed so
they cannot be confused: *mark out of order* is immediate and touches room
state only, while *schedule closure* is manager-only, takes a date range and
previews its hit to sellable inventory before confirming — because reducing
`total_rooms` is a commercial act, not a cleaning one. One place answers "why
is this room not sellable?", and permissions plus framing keep the acts apart.

Rates is a grid — days across, room types down — showing price and
restrictions per cell, with range selection so a weekend uplift or a Tết
season is one edit rather than fourteen. The grid is the industry's mental
model for rate management; per-plan forms would hide what a given week
actually costs across types.

Folios never hides the ledger: staff always see every posting, reversals
paired with what they reversed, under a pinned settled summary. Append-only is
the product's integrity story, and the folio screen exists to make corrections
reviewable — a net view that hid them would hide the screen's purpose. The
guest's own read of the same folio stays the settled summary.

Payments is organised around the reconciliation day: it opens on today's
gateway transactions matched against ledger postings, discrepancies first,
yesterday's reconciliation status in view. Refunds act from the payment row
and split by role — policy-computed for the desk, discretionary for
management — as the matrix requires.

Finance is strictly the money the folio system does not capture — categorised
income and expense such as supplies, utilities and salaries. Stay revenue
lives in Reports, computed from night-audit snapshots; showing it here too
would invite double-counting the hotel's main income.

Audit is reached from the record, not only from the menu: every booking,
folio, invoice and guest record carries a history link that opens the audit
view pre-filtered to that record, and the standalone screen with actor, action
and date filters remains for sweeps. Whoever opens an audit log arrives with a
question about a thing, so the thing carries the door.

Settings separates staff access from property configuration. Tax values — the
standard and the reduced VAT rate, the window that divides them, the VAT-base
rule — are one mutable row an `ADMIN` edits and every posting reads
([`architecture/property-and-tariff.md`](architecture/property-and-tariff.md)
§8), because the alternative is a rate that takes a deploy to change and an
invoice a third party has already issued in law. The dates belong to the reduced
rate and are two fields of that same row, not a history of it: what is asked for
is configuration editable without a deploy, not a dated ledger of every rate the
property has charged. The business-date rollover is another field of the row;
gateway credentials stay in the environment rather than in it. The audit log owns
the history of all of them.

Reports is a short menu of named reports — revenue, room status, occupancy,
ADR and RevPAR — each a page with a range picker, a chart and an Excel
export. Every page is stamped with the last business date the night audit has
closed, and that stamp is a boundary rather than a statement of source: what
it promises is that no page ever shows a day the audit has not closed, not
that every figure on it was read from a frozen row. Room status has no frozen
row to read — it is a live count over `room_condition`, because a housekeeping
status is where a room stands now and is never a fact about a night that has
ended, and a frozen copy of it would be exactly that confusion. The revenue
page's cancellation and no-show penalties are summed from the folio ledger
rather than from a snapshot column, still cut at the last closed business
date: a penalty is posted to the trading day it was taken on and the ledger is
append-only, so a closed day's total cannot move afterwards. There is no
report builder; the requirements enumerate exactly what is needed.

The console is organised around property work rather than the guest journey.
The families, as an index:

| Family | Staff intent |
|---|---|
| Login | Enter the staff authentication realm |
| Dashboard | See the operating day at a glance |
| Arrivals | Assign rooms and check guests in |
| Departures | Settle folios, check guests out and initiate the legal invoice flow |
| Bookings | Find, create, change and cancel bookings |
| Rooms | Manage rooms, room types and maintenance closures |
| Housekeeping | Move rooms through readiness states independently of occupancy |
| Guests | Work with guest records while protecting sensitive identity data |
| Rates | Manage date-based prices, restrictions and promotions |
| Folios | Review append-only stay charges and corrections |
| Payments | Handle payments, refunds and reconciliation |
| Shifts | Open, close and hand over an operating shift |
| Finance | Record categorised income and expense |
| Audit | Review who changed protected state and when |
| Settings | Manage staff access and property-wide configuration |
| Reports | Review revenue, occupancy, ADR and RevPAR |

Exact permissions belong in
[`architecture/rbac-matrix.md`](architecture/rbac-matrix.md). Product outcomes
and acceptance criteria belong in
[`product-requirements.md`](product-requirements.md).
