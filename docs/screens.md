# Screens

Every screen in the system, what it is for, and whether it exists yet. Written
to be **looked at**, not executed — `plans/backlog.md` is the version an agent
reads, and it wins on status wherever the two disagree.

*Status snapshot: 2026-07-26.* Re-check against the backlog rather than trusting
the ticks in two weeks.

**6 of 29 built, and one more standing on a stub** — ✅ built and wired to the API,
🟡 built against a local fixture because the API it needs is not there yet,
⬜ not started.

| | Built | Planned | Total |
|---|:-:|:-:|:-:|
| Guest — `apps/web` | 6 | 7 | 13 |
| Staff — `apps/admin` | 0 | 16 | 16 |

---

## Guest — the public website

What a stranger sees. One app, two halves: the arrival sells the place, and
everything else is transactional and loads no 3D.

### The arrival

| | Screen | What the guest does here | Lands |
|:-:|---|---|---|
| ✅ | `/` | Scrolls through six acts and decides they want to come. The only screen with 3D, video and scroll animation | M1 |

### Signing in

| | Screen | What the guest does here | Lands |
|:-:|---|---|---|
| ✅ | `/login` | Signs in | M2 |
| ✅ | `/signup` | Creates an account | M2 |
| ✅ | `/verify-email` | Confirms their address. Also the page the emailed link lands on — after clicking, they are already signed in | M2 |
| ✅ | `/forgot-password` | Asks for a reset link | M2 |
| ✅ | `/reset-password` | Picks a new password | M2 |

### Booking a room

| | Screen | What the guest does here | Lands |
|:-:|---|---|---|
| 🟡 | `/booking` | Picks dates and guests, sees what is free, chooses a room type. **Screen built; reads a local fixture because the `pricing` and `inventory` reads it needs do not exist yet** | M7 |
| ⬜ | `/booking/…/details` | Says who is staying. The room is now held on a timer | M7 |
| ⬜ | `/booking/…/payment` | Pays. **This is where the system starts handling real money** | M7 |
| ⬜ | `/booking/…/confirming` | Waits a few seconds while the bank confirms. Not a page anyone lingers on, but it has to exist — the bank's answer arrives separately from the browser | M7 |
| ⬜ | `/bookings/…` | Sees the booking is confirmed. The same page they come back to later to check details, and where they leave feedback after the stay | M7 |

### Their account

| | Screen | What the guest does here | Lands |
|:-:|---|---|---|
| ⬜ | `/account` | Profile, VIP tier, loyalty points, uploads a photo of their ID | M7 |
| ⬜ | `/account/stays` | Every stay they have had here | M7 |

---

## Staff — the admin console

The console the property runs on. **Nothing is built** — the folders exist and
are empty on purpose, because these names will move before the work behind them
does.

These are **screen families**, not single screens. "Bookings" is a list, a
detail view and a form; expect two or three screens each once built.

| | Family | What the staff member does here | Lands |
|:-:|---|---|---|
| ⬜ | Login | Signs in. Separate from the guest login — no token opens both | M4 |
| ⬜ | Dashboard | Today at a glance | M4 |
| ⬜ | Arrivals | Who is coming today. Gives them a room, checks them in | M4 |
| ⬜ | Departures | Who is leaving. Settles the bill, checks them out. **Legally a cash register** — the invoice is signed and filed with the tax authority at this moment | M6 |
| ⬜ | Bookings | Finds, creates, changes and cancels bookings | M4 |
| ⬜ | Rooms | The rooms and room types themselves. Closing a room for maintenance happens here, and it reduces what can be sold | M4 |
| ⬜ | Housekeeping | The cleaning board. Clean, dirty, inspected, out of order. Separate from whether anyone is in the room — a guest checking out does not make the room sellable | M4 |
| ⬜ | Guests | Guest records. ID numbers are masked; unmasking one is logged | M4 |
| ⬜ | Rates | Prices per room type per date. Seasons, weekends, minimum stays, promotions | M4 |
| ⬜ | Folios | The running bill for a stay. Charges go on, nothing is ever deleted — a mistake is corrected by adding an opposite line | M6 |
| ⬜ | Payments | Card and wallet payments, refunds, and matching the day's takings against the gateway's own report | M6 |
| ⬜ | Shifts | Opening and closing a shift, counting the cash drawer, handover notes for the next person | M8 |
| ⬜ | Finance | Money in, money out, by category | M8 |
| ⬜ | Audit | Who changed what, when, and what it looked like before | M8 |
| ⬜ | Settings | Staff accounts and roles, tax rates, and the switches the rest of the system reads | M8 |
| ⬜ | Reports | Revenue and occupancy charts by day, month, quarter or any range — plus the three numbers a hotel is judged on: occupancy, ADR, RevPAR | M9 |

---

## What "lands" means

| | Milestone | Roughly when |
|---|---|---|
| M1 | Website on current React/Next | done |
| M2 | API, database, logins, six roles | mostly done |
| M4 | Front desk — the first admin screens | after inventory (M3) |
| M6 | Money — bills, payments, invoices | |
| M7 | Guests book and pay on the website | |
| M8 | Shifts, expenses, audit log | |
| M9 | Reports and charts | |

Full milestone road: [`orientation.md`](orientation.md) §5.

## Where this comes from

This file owns nothing. It is a view over three others, and each of them wins
over it:

- **Routes and why they are shaped that way** — [`architecture/repository-structure.md`](architecture/repository-structure.md)
- **Who is allowed on which screen** — [`architecture/rbac-matrix.md`](architecture/rbac-matrix.md)
- **Whether something is actually done** — `plans/backlog.md`
