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

Identity is not only an interruption the funnel raises: a guest can seek out
sign-in at any time from a menu at the top right of the guest surfaces, which
is how a returning guest reaches their account and stays without touching the
funnel.

A deliberate sign-in never navigates: the guest returns to the page they were
on, everywhere. On the marketing arrival this means the page does not change
at all — the guest's name simply replaces the log-in message — and a guest who
wanted their stays opens the now-signed-in menu. Password reset is the one
identity flow that ends somewhere fixed: the guest arrives from an email link
with no prior context, so completing the reset signs them in automatically —
they proved email ownership and set the password seconds ago — and lands them
in the account area.

Identity gates the booking funnel at the hold boundary. There is no separate
search screen: everyone arrives through `/booking` and finds their room from
there. An anonymous guest can search and compare rooms freely, but identity is
required before a hold is created, so the sign-in wall appears when the guest
continues from room choice toward details. A guest without an account can
register from that same wall — the purpose is convenience, so the funnel never
hands the guest off to a separate journey. Completing sign-in moves the guest
forward to the next screen, not back: details is a single flow from the booking
workflow, and the guest just continues building up the booking till the end.
Guests are able to come back to earlier steps but are never forced to.

Email verification never blocks the booking funnel. A guest who registers at
the sign-in wall continues to details with an unverified address: the hold TTL
releases inventory on expiry, so sending the guest to their inbox mid-booking
risks losing the room they chose. The typo risk is handled on screen instead —
the address is shown prominently at details and on confirmation, and the
confirmation screen gives the guest their reference regardless of email.
Verification is nudged after booking and required only for account-area
actions, where no hold is ticking.

Google sign-in behaves identically to email sign-in everywhere identity
appears — same wall, same menu, same return rules. Its one difference is that
a Google identity arrives with an email Google has already verified, so those
guests never see the verification nudge.

### Booking journey

The intended journey has **six steps across five URL patterns**. Search and room
choice share `/booking`, told apart by a search param rather than by a path
segment because both are views of the same stateless query — see
[`architecture/repository-structure.md`](architecture/repository-structure.md)
§`(booking)`. The remaining steps each have their own location. Keeping the
asynchronous gateway return separate from confirmation prevents a browser
redirect from being mistaken for the payment result.

| Step | URL pattern | Guest intent |
|---|---|---|
| Search | `/booking` | Choose stay dates and confirm the stay |
| Room choice | `/booking?…&step=rooms` | Compare available room types and choose one |
| Details | `/booking/<hold>/details` | Provide occupants, rate plan and stay options |
| Payment | `/booking/<hold>/payment` | Choose and initiate payment |
| Gateway return | `/booking/<hold>/confirming` | Wait for the authoritative payment notification |
| Confirmation and stay detail | `/bookings/<reference>` | View the resulting booking, return to it later, and act on the stay — cancel, provide the identity document, leave feedback — as its state allows |

The hold identifier appears only after inventory has been reserved. Confirmation
and later stay detail share one URL because they are the same guest-owned
resource, shown at different moments.

### Account

The account area holds what a guest owns outside any single stay: `/account` is
the profile — personal data, VIP tier, loyalty — and `/account/stays` is stay
history, where each stay leads back to the same `/bookings/<reference>` surface
the funnel's confirmation ended on. Route placement and boundary rationale
belong in
[`architecture/repository-structure.md`](architecture/repository-structure.md).

The profile lets the guest edit the fields the next stay will consume: name,
phone, date of birth, nationality and identity-document number — the same set
the legal registration record needs at check-in. Profile edits feed forward
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
cancelling an upcoming stay, providing the identity document and leaving
post-stay feedback all happen on `/bookings/<reference>`, the one surface that
owns a stay's full context. This places the guest's cancel and feedback
capabilities ([`architecture/rbac-matrix.md`](architecture/rbac-matrix.md) §3):
each appears on the stay detail only when the booking's state allows it —
cancellation while the policy window is open, feedback once the stay is
checked out.

Identity documents deliberately do not get an account screen, and the reason is
stronger than layout: there is nothing to show. A scan is read once to fill in
the declaration and then discarded, never stored
([`architecture/rbac-matrix.md`](architecture/rbac-matrix.md) §3,
`FR-GST-02`), so the guest side is write-only in the literal sense — upload,
and nothing comes back. It belongs to a specific arrival rather than to the
account, so it lives on the stay detail of an upcoming booking as a pre-check-in
convenience. The account area shows at most that the arrival's declaration is
complete, never a document on file.

## Staff surfaces

Every staff surface except login lives inside one authenticated shell — nav,
command palette, global hotkeys — because the console is keyboard-first; login
stands alone with no shell and no nav
([`architecture/repository-structure.md`](architecture/repository-structure.md)
§`apps/admin`).

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

Settings separates staff access from property configuration, and within
configuration it separates the legally dated from the merely current. Tax
values — the VAT rate, its applicability window, the VAT-base rule — are
edited as dated entries with an effective-from and visible history, so a rate
change scheduled for the first posts correctly from the first without anyone
editing at midnight. Credentials and the business-date rollover stay simple
current-value fields; the audit log owns their history.

Reports is a short menu of named reports — revenue, room status, occupancy,
ADR and RevPAR — each a page with a range picker, a chart and an Excel
export. Every page is stamped with the business date of the night-audit
snapshot it reads, because reports never see a day the audit has not closed.
There is no report builder; the requirements enumerate exactly what is needed.

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
