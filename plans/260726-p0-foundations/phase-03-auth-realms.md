---
phase: 03
title: The two auth realms
started: 2026-07-26
---

# Phase 03 — The two auth realms

Phase 03 of the plan is *"Contracts and the two auth realms"*. This file covers
the auth half. The primitive contracts (`P0-C-01`, `P0-C-02`) exist; the
`@orpc/contract` router, Nest binding, and typed client are `P0-C-03` and
`P0-C-04`. The routes described below remain implementation evidence, not the
wire-contract authority.

Jira project `SCRUM` owns execution status and delivery evidence. This phase
record retains the decisions and rationale that are not recoverable from code.

## Context

`rbac-matrix.md` defines the role and capability contract and requires
data-driven coverage of every row. The executable matrix and tests are linked
below; this record does not copy their current inventory.

The decision the matrix froze, and this phase implements without revisiting:
**guests authenticate through Better Auth, staff through Passport-JWT, and no
token opens both realms.**

## Requirements

- Both realms working end to end against a real database, not a mock.
- A guard that is closed by default, so a route written next month is
  unreachable until somebody says who may reach it.
- Every row of the matrix asserted by test, in both realm directions.
- The guest funnel's screens: an account can be created, confirmed, signed into
  and recovered without touching a terminal.

## Work done

### The matrix, as data

The executable capability matrix remains in
`apps/api/src/modules/identity/rbac/matrix.ts`; it is server policy, not a wire
contract. `StaffRole` does cross the API/admin boundary, so its schema and type
are owned and exported by `packages/shared` and imported by API RBAC. The
current API-local definition in `rbac/roles.ts` is an implementation gap closed
with `P0-C-03`, not an open architecture decision.

Four grant levels rather than two: `full`, `read`, `conditional`, `denied`. The
matrix's ⚠ marks are grants the guard cannot complete — ownership, "own shift",
a retention window — so `conditional` passes the request on with the condition
attached to it, and the handler owes the rest. Collapsing ⚠ to "allowed" would
have lost exactly the information that stops one guest reading another's folio.

### The guard

One global `AccessGuard`. `@Unguarded("<reason>")` first, then a capability
lookup, then the caller, then the grant. A route declaring neither is 403 for
everyone. A bearer token goes to Passport and a cookie to Better Auth, and a
request carrying both is treated as staff — one request, one realm, never a
union.

`@Unguarded` takes a written reason instead of being a bare `@Public()`, because
the reason is the thing a reviewer gets to disagree with. There are two kinds of
user: the routes that issue a session, and `/health`.

### Staff — Passport-JWT

Thirty-minute HS256 access token, seven-day refresh token stored as a SHA-256
digest and rotated on use. The rotation is one `UPDATE … WHERE revoked_at IS
NULL … RETURNING`, so two concurrent refreshes of the same token cannot both
succeed however they interleave, and a replay after the real client has
refreshed finds nothing to spend.

Argon2id at OWASP parameters, through `@node-rs/argon2`. Sign-in verifies
against a boot-time random digest when the address does not exist, so "no such
account" and "wrong password" take the same time as well as returning the same
sentence. The strategy re-reads the account on every request rather than
trusting the role in the claim: deactivating somebody has to end their access
now, not in half an hour.

### Guests — Better Auth 1.6.25

Mounted at `/api/auth/*` by one controller handing off to the library's own
handler. Nothing is reimplemented. Configured deliberately rather than by
default: verification required before sign-in, twelve-character minimum,
sessions revoked on password reset, `sameSite: lax` (a verification link is a
cross-site navigation and `strict` would drop the cookie on arrival), and
per-endpoint rate limits on the five credential paths.

One default was overridden for a reason worth recording: Better Auth switches
its Origin/CSRF check **off** when `NODE_ENV=test`. A defence absent from the
environment the tests run in is a defence no test can prove, so
`disableOriginCheck: false` is set explicitly and the e2e asserts that a
session-bearing request from `http://evil.example` is refused.

### Tables and migration

`0001_auth_realms.sql`: four Better Auth tables prefixed `guest_`, plus
`staff_user` and `staff_session`. The Drizzle exports keep Better Auth's own
names because its adapter indexes the schema object by them; the barrel
re-exports them as `guestUser`, `guestSession`, … so the rest of the API says
which realm it is touching. Both realms are unique on `lower(email)` — a plain
unique index would let `Anh@` and `anh@` both register.

### The bootstrap problem

Creating a staff account needs `identity.staff-accounts`, which only an `ADMIN`
holds, and a fresh database has no `ADMIN`. So the first one is made from a
shell — `pnpm --filter @mariva/api staff:create`, which reads the password from
stdin rather than from an argument that would land in shell history — and every
account after it comes from `POST /identity/staff-accounts`. A route open for
one request in the system's lifetime would be a hole for the rest of it.

### Web

`/signup`, `/verify-email`, `/forgot-password` and `/reset-password` under
`app/(booking)`, joining the `/login` screen that already existed and links to
two of them. CSS-only motion on the five permitted properties at `--ease-ui`,
tokens throughout, no import from `features/arrival` — `design-foundations.md`
§5's booking budget.

The quiet screens share `auth-shell.tsx` rather than the login screen's two-plate
composition. The door has the photograph; the rooms behind it are plain.

Sign-up cannot report that an address is taken, and the copy is written not to
promise an email that will not arrive: Better Auth answers a duplicate sign-up
with a plausible user object, writes nothing and sends nothing. Verified — the
database gained no row and the mail log no message. It is an anti-enumeration
measure, and a screen that said "that address is taken" would undo it.

## Validation

Current executable evidence lives in:

- `apps/api/src/modules/identity/rbac/matrix.spec.ts` for role/capability
  coverage;
- `apps/api/test/auth.e2e-spec.ts` for the realm boundary and credential flows;
- `apps/web/features/auth/` for the guest screens and browser-side boundary;
- the package manifests for the narrow test, typecheck, and build commands.

CI and hermetic database verification belong to `P0-CI-02` through
`P0-CI-04`/Jira `SCRUM-21`. This dated phase record is not evidence that those
checks currently gate a merge.

## Risk and rollback

The guard is global, so importing `AuthModule` changes every route in the
application at once. That is the intent, and it is why the health controller
gained an `@Unguarded` in the same change rather than later.

Rollback is removing `AuthModule`, `IdentityModule` and `NotificationModule`
from `app.module.ts`, which restores the previous behaviour of every route, and
dropping migration `0001` — it only adds tables, so nothing else refers to them
yet.
