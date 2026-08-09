# Orientation — start here

This is the cold-start guide for a human or AI collaborator returning to
Mariva. It explains the durable goal and points to the authorities that answer
current questions. It deliberately carries no delivery snapshot.

## What Mariva is

Mariva is a property management system for one resort, plus the public website
that sells its rooms.

It has two audiences that never meet. A **guest** finds a free room, books it
and pays online. **Staff** operate the property through five roles:
`RECEPTIONIST`, `HOUSEKEEPING`, `ACCOUNTANT`, `MANAGER` and `ADMIN`. `GUEST` is
a separate actor and authentication realm, not a sixth staff role.

It is also a coursework deliverable. The coursework consumes the product and
architecture authorities; it does not define them.

## The constraint everything protects

> **Two guests must never be sold the same room for the same night.**

A resort sells inventory that is finite, dated and worthless after the night
passes. An application-level “read availability, decide, then write” check
cannot be the final defence because concurrent requests can make the same
decision.

The accepted design therefore puts inventory and room-overlap invariants in
Postgres. Guests reserve a room *type*; a physical room is assigned for the
stay. That separation makes room moves, maintenance closures and upgrades
possible without weakening the sales invariant.

This is a durable requirement and design decision, not proof that the
constraints have shipped. Verify current migrations and tests under
[`apps/api/src/database`](../apps/api/src/database/) and use
[`product-requirements.md`](product-requirements.md) for acceptance criteria.

## System boundaries

The public site and booking flow live in `apps/web`; staff operations belong in
`apps/admin`; `apps/api` owns business rules and database writes. Shared
contracts belong in `packages/shared`.

The reasons for those boundaries and the allowed dependency direction live in
[`architecture/repository-structure.md`](architecture/repository-structure.md).
Inspect workspace manifests and source directories for what exists now.

Two constraints are worth knowing before opening a module:

- Money is integer VND; presentation must not become the storage model.
- A stay date is a calendar date, while an event time is an instant. Mixing
  them creates off-by-one-night errors.

Their executable owners are the schemas and tests under
[`packages/shared/src`](../packages/shared/src/).

## Domain vocabulary

| Term | Meaning in Mariva |
|---|---|
| **Hold** | Inventory reserved for an unpaid booking until its timer expires |
| **Folio** | The append-only bill for a stay; corrections use reversing entries |
| **Reversing entry** | An opposite line that corrects a financial mistake without erasing history |
| **Night audit** | The operation that posts nightly charges, advances the business date and freezes reporting input |
| **Business date** | The resort’s operating day, which is not necessarily midnight-to-midnight |
| **Housekeeping status** | Room readiness, separate from occupancy |
| **Occupancy / ADR / RevPAR** | The operating measures used alongside revenue to understand room performance |

The detailed business rules belong in
[`architecture/property-and-tariff.md`](architecture/property-and-tariff.md),
[`architecture/booking-state-machine.md`](architecture/booking-state-machine.md)
and [`product-requirements.md`](product-requirements.md).

## How to resume work

1. Read [`README.md`](README.md) to identify the authority for the question.
2. Open the
   [GitHub issues](https://github.com/2351010154/resort-management/issues).
   They own current status, assignee, labels, milestones and blockers.
3. Follow the selected issue to its source, test, schema, manifest or workflow.
   Those artifacts own current behavior.
4. Update the issue as execution state changes. If the work settles a durable
   requirement, business rule, constraint or trade-off, update its single
   repository authority as well.

Markdown under `plans/` is versionable stateful evidence. It can explain an
earlier plan or trade-off, but it is not a live tracker. `pnpm backlog:view`
generates a local HTML rendering of the planning record.

## Durable risks

- External booking channels can create double bookings outside Mariva’s
  database until channel inventory is integrated or reconciled operationally.
- Payment and electronic-invoice production access depends on external
  onboarding, contracts and credentials.
- Guest personal data — names, identity numbers, stay records — sits in
  Singapore, and a cross-border transfer dossier must be filed before opening.
  Identity-document images are not part of that exposure: they are read and
  discarded, never stored.
- A solo project has limited review capacity, so money and inventory
  invariants need executable tests and explicit evidence.

Current blockers, owners and follow-up dates for these risks belong in
[GitHub issues](https://github.com/2351010154/resort-management/issues).
