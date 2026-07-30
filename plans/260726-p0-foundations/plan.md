---
title: P0 — Foundations
tags: [monorepo, api, database, auth, ci, docs]
created: 2026-07-26
---

# P0 — Foundations

The spine everything else stands on: a repo shape that absorbs new screens
without rearrangement, an API that boots against a real Postgres, two separate
auth realms, and a CI that runs tests rather than just proving the site
compiles.

Architecture and rationale:
`plans/reports/archive/advise-260726-0939-resort-pms.md`.
Structure authority: `docs/architecture/repository-structure.md`. Which document
owns which fact: `docs/README.md`.

This plan retains the milestone rationale, dependencies, and acceptance
criteria. Jira project `SCRUM` owns execution status, assignment, sprint,
priority, dates, blockers, and delivery evidence.

## Acceptance criteria

- Every app and package has a home, and the rules for what goes where are
  written down rather than remembered.
- `pnpm build` succeeds across the workspace; `pnpm test` runs real tests.
- The API boots against Postgres with `btree_gist` available and answers a
  health check in production.
- A staff token cannot open a guest route and a guest token cannot open a staff
  route — asserted by a test, not by inspection.
- Each of the five staff roles and the separate `GUEST` realm has its allowed
  and denied routes asserted.
- CI regenerates the ERD from the live schema and fails when it has drifted.

## Phases

| # | Phase | Depends on |
|---|---|---|
| 01 | [Repository structure and conventions](phase-01-repository-structure.md) | — |
| 02 | API skeleton and database | 01 |
| 03 | [Contracts and the two auth realms](phase-03-auth-realms.md) | 02 |
| 04 | CI with tests, and the docs/ERD pipeline | 02 |
| 05 | Production deploy of the API | 02, 04 |

### 02 — API skeleton and database

NestJS 11 on Express 5 with env validated at boot. Drizzle is the ORM: its
migrations emit real `.sql` you hand-edit, so the `EXCLUDE USING gist`
constraint stays in version control rather than outside it. `pg` is the driver,
and Drizzle and pg-boss share a single pool — one connection config, one failure
mode. Postgres provisioned on a managed host, `btree_gist` enabled by migration,
a migration runner wired to `pnpm`, and a health endpoint. Object storage and
transactional email provisioned in the same pass; secrets by env, never
committed.

### 03 — Contracts and the two auth realms

The primitive money and stay-date contracts are the base for the
`@orpc/contract` router, its Nest binding, and the typed client. The compile-time
contract decision and measured boundary live in
[`tech-stack.md`](../../docs/architecture/tech-stack.md#orpc-compile-time-contract-evidence).
`StaffRole` is exported from `packages/shared` and imported by the API RBAC
implementation because it crosses the API/admin boundary; the capability
matrix remains API-owned. `packages/api-client` is implemented in this phase.

The realm decision is separate: staff use Passport-JWT, guests use Better Auth,
and no token opens both. The capability guard and its acceptance criteria are
owned by [`rbac-matrix.md`](../../docs/architecture/rbac-matrix.md).

### 04 — CI with tests, and the docs/ERD pipeline

This phase makes the repository test command gate merges. Database-backed tests
will bring their own Postgres through `@testcontainers/postgresql`, using the
same helper locally and in CI rather than a CI-only service container or a
manually provisioned `.env.test` database. The work includes the affected
package manifests, `pnpm-lock.yaml`, `turbo.json`, and a cache policy that
cannot replay an earlier green result instead of exercising the required
runtime. The phase also generates the ERD from the live schema and makes CI
reject drift.

### 05 — Production deploy of the API

Hello-world API in production early, so deployment is a solved problem before
anything depends on it rather than a surprise at the end.

## Deferred out of P0

`apps/admin` remains a reserved boundary and starts with the front-desk
milestone, once there is an operational domain to expose. `packages/api-client`
is not deferred: P0 implements it as the typed transport boundary shared by the
frontends.
