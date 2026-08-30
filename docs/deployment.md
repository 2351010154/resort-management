# Deployment

The order of operations for putting this system somewhere. It is a runbook: it
says what to do first, what to check before continuing and how to get back, and
it cites the decisions rather than repeating them.

**Nothing here has been executed.** No account exists for any vendor below, and
every command is written to be run by a person holding credentials this
repository does not have. Where a step could not be verified from the repository
or from vendor documentation it is marked **⚠ confirm**, and a marked step is one
to check against the vendor's console before trusting it.

## The topology

| Piece | Where | Region |
|---|---|---|
| `apps/api` | Fly.io, one always-on machine | `sin` |
| `apps/web`, `apps/admin` | Vercel, one project each | `sin1` (`ap-southeast-1`) |
| Postgres | Neon | `aws-ap-southeast-1` |

Singapore throughout — the nearest mature region to Vietnam, and no vendor here
has a Vietnam one. Why each vendor, what it costs and what the offshore data
question obliges are
[`architecture/infrastructure.md`](architecture/infrastructure.md) §Hosting;
this file does not re-argue any of it.

Object storage, error tracking, uptime monitoring and the weekly encrypted dump
are decided in that document and **are not set up here**. Neither is either
payment gateway: switching a gateway from sandbox to production credentials is
gate `G2`, and it has its own runbooks
([VNPay](runbooks/g2-production-payment.md),
[PayPal](runbooks/g2-production-paypal.md)). A deployment made by following this
file collects no money, which is the correct state for it to be in until `G2` is
worked.

## The rule this file exists to enforce

**The schema is applied by a person, before the process that needs it starts.**

`main.ts` calls `assertMigrationsApplied` before the port opens, so an API
pointed at a database behind its own build refuses to start and names the
migration that is missing
([`migration-check.ts`](../apps/api/src/database/migration-check.ts)). Nothing
migrates on its own: not the container's entrypoint, not a Fly release command,
not `compose.yaml`. Two machines deploying at once would race to apply the same
DDL, and the guard exists precisely to make *schema first, then process* an
ordering somebody performs.

The other direction is deliberately allowed. A database that has run migrations
the running build does not know about is what every deploy looks like for the
seconds between step 6 and step 8 below, and refusing to start then would turn a
normal rollout into an outage. That asymmetry is also what makes the rollback in
§Rollback safe.

## Before anything

| | |
|---|---|
| Node 24, pnpm 11.1.2 | `corepack enable`, then `pnpm install`. Pinned in `.nvmrc` and the root `packageManager` |
| Docker | For the local stack below. Docker Desktop on Windows and macOS |
| `flyctl` | Windows: `pwsh -Command "iwr https://fly.io/install.ps1 -useb \| iex"`. macOS: `brew install flyctl`. Linux: `curl -L https://fly.io/install.sh \| sh` |
| `vercel` | `pnpm add -g vercel` |

Neon needs no CLI for anything in this file; its work is done in the console.

## 1. Run it locally first

The whole system in containers on one machine, from the same three Dockerfiles a
deploy uses. Do this before opening any account: it is the only place where a
mistake in an image costs nothing.

```bash
cp apps/api/.env.example apps/api/.env
openssl rand -base64 32   # paste into BETTER_AUTH_SECRET
openssl rand -base64 32   # paste into STAFF_JWT_SECRET
```

Two different values. One signs guest session cookies and the other signs staff
access tokens, and `env.ts` refuses to boot if they match — one leak must not
forge both realms.

```bash
docker compose up -d db
```

Then the schema, from the host, against the published port — the same command
the README already gives for local development:

```bash
DATABASE_URL='postgres://postgres:postgres@localhost:5432/mariva_dev' \
  pnpm --filter @mariva/api db:migrate
```

Only now the rest:

```bash
docker compose up -d --build
curl http://localhost:3001/health          # {"status":"ok","database":"up"}
```

The public site is on <http://localhost:3000>, the staff console on
<http://localhost:3002>, and the API on <http://localhost:3001>. The console has
nobody to sign in as until the first `ADMIN` exists, which is the same script
step 7 uses:

```bash
DATABASE_URL='postgres://postgres:postgres@localhost:5432/mariva_dev' \
  pnpm --filter @mariva/api staff:create \
  --email owner@mariva.vn --name "Trần Minh" --role ADMIN
```

`docker compose down` stops it and keeps the data; `docker compose down -v`
throws the database away.

**What this rehearsal does not prove.** It runs with `NODE_ENV=development`, so
none of the production requirements in `env.ts` are enforced — no mailer, no
Google client, no trusted address header — and the first deploy is where those
are met. It has no edge, no CDN and no managed backups. What it does prove is
that the three images build, that the API can reach a Postgres it did not
create, and that the front ends talk to it across an origin the CORS allow-list
had to be told about.

## 2. Accounts

Three signups, in this order, because each later step needs the one before it.

1. **Neon** — <https://neon.com>. Free tier is enough until `G2`, which upgrades
   it (`infrastructure.md` §Payments, item 1).
2. **Fly.io** — `fly auth signup`, or the console. A payment method is required
   before an app will deploy. **⚠ confirm** the current free-allowance terms
   against Fly's pricing page; they have changed more than once.
3. **Vercel** — <https://vercel.com>. Sign up with the account that owns the
   GitHub repository, so the two projects in step 8 can be imported.

> [!IMPORTANT]
> **Vercel Hobby is non-commercial and a booking site is commercial use.** This
> is `G2` item 2, and it comes due when the property takes real money, not when
> the site first goes up. It is written here so nobody discovers it at that
> point.

## 3. The database

In the Neon console:

1. Create a project in **AWS Asia Pacific 1 (Singapore) — `aws-ap-southeast-1`**.
   The region cannot be changed afterwards; a different one means a new project
   and a data migration.
2. Name the default branch `production`, and create a second branch `staging`
   from it. **⚠ confirm** the default branch's name in the console — Neon has
   shipped both `main` and `production` as the default — and rename rather than
   add if it differs.
3. Copy the connection string for `production`.

**Take the direct connection string, not the pooled one.** The API opens exactly
one long-lived `pg.Pool` for the whole process and pg-boss draws its workers from
that same pool
([`apps/api/README.md`](../apps/api/README.md) §Database), so a connection pooler
in front of it is solving a problem this process does not have. **⚠ confirm**
before ever switching to the `-pooler` host: whether pg-boss tolerates
transaction-level pooling has not been established here, and migrations must use
the direct connection in any case.

Keep the string out of the shell history — read it from a prompt or paste it into
the secret-setting command, never into a file in this repository.

## 4. The Fly app

```bash
fly apps create mariva-api --org personal
```

The name must match `app` in [`../apps/api/fly.toml`](../apps/api/fly.toml). If
it is taken, change it in both places.

## 5. Addresses

Three values in `fly.toml`'s `[env]` block are placeholders on a `.example`
domain and must be edited before the first deploy: `API_URL`, `WEB_ORIGIN` and
`ADMIN_ORIGIN`. They are addresses rather than secrets, which is why they are in
version control where a reviewer sees them change.

Until custom domains exist, the vendor-assigned ones are:

| Variable | Value before custom domains |
|---|---|
| `API_URL` | `https://mariva-api.fly.dev` |
| `WEB_ORIGIN` | the production URL Vercel assigns the `web` project in step 8 |
| `ADMIN_ORIGIN` | the production URL Vercel assigns the `admin` project in step 8 |

The two Vercel URLs are not known yet, which is why step 10 comes back to this
block. `main.ts` builds the CORS allow-list from `WEB_ORIGIN` and `ADMIN_ORIGIN`
and trusts nothing else, so a value that does not match the browser's origin
character for character fails sign-in as a CORS error rather than as a wrong
password.

## 6. Secrets

Every one of these is required at boot under `NODE_ENV=production` by
[`env.ts`](../apps/api/src/config/env.ts), and every value below is a
placeholder.

```bash
fly secrets set --app mariva-api \
  DATABASE_URL='<neon production direct connection string>' \
  BETTER_AUTH_SECRET='<openssl rand -base64 32>' \
  STAFF_JWT_SECRET='<a different openssl rand -base64 32>' \
  GOOGLE_CLIENT_ID='<oauth client id>' \
  GOOGLE_CLIENT_SECRET='<oauth client secret>' \
  RESEND_API_KEY='<resend api key>'
```

| Secret | Where it comes from | Why the boot insists |
|---|---|---|
| `DATABASE_URL` | Neon, step 3 | No default exists — one would point production at somebody's laptop |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | Signs guest session cookies |
| `STAFF_JWT_SECRET` | a second, different `openssl rand -base64 32` | Signs staff access tokens; must differ from the above |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Google Cloud console, OAuth client of type *Web application* | The login screen offers the Google button unconditionally |
| `RESEND_API_KEY` | Resend | Without it, verification and reset mail is only logged |

The Google client needs one authorised redirect URI registered against it, and
it is `API_URL` plus the callback path:

```
https://mariva-api.fly.dev/api/auth/callback/google
```

Optional, and both belong to work this file does not do:
`OPS_ALERT_WEBHOOK_URL` is where a reconciliation discrepancy pages, and becomes
mandatory the moment a VNPay terminal is configured in production; the
`VNPAY_*` and `PAYPAL_*` credentials are `G2`'s. Leave all of them unset. The API
boots without them, offers no gateway, and says so at `GET /payments/gateways`.

Setting secrets on an app that is already running triggers a rolling restart. On
a fresh app with no machines it does not, which is why this step comes before the
first deploy.

## 7. Migrations

**Before the API is deployed, not after, and by hand.**

```bash
DATABASE_URL='<neon production direct connection string>' \
  pnpm --filter @mariva/api db:migrate
```

Run from a machine with the repository checked out at the commit about to be
deployed. `drizzle.config.ts` reads `DATABASE_URL` from the shell and the shell
wins over any `.env` file, so nothing needs editing.

Then the first `ADMIN`, which cannot be created through the API because creating
staff accounts needs a capability only an `ADMIN` holds:

```bash
DATABASE_URL='<neon production direct connection string>' \
  pnpm --filter @mariva/api staff:create \
  --email '<owner email>' --name '<owner name>' --role ADMIN
```

It prompts for the password rather than taking it as an argument, which would put
it in the shell history and in `ps`.

## 8. Deploy the API

From the repository root, never from `apps/api`:

```bash
fly deploy . \
  --config apps/api/fly.toml \
  --dockerfile apps/api/Dockerfile \
  --ha=false
```

The build context is the whole tree because the image is a pnpm workspace build
and `--frozen-lockfile` resolves against every workspace member the lockfile
names. Both paths are flags rather than `fly.toml` keys for the reason that file
gives: a path in `[build]` resolves against a directory that has differed between
flyctl versions, and a flag resolves against the working directory in all of
them.

`--ha=false` deploys one machine. Fly creates two by default, and two is not
wrong — pg-boss coordinates its cron across instances — but the budgeted shape is
one always-on machine (`infrastructure.md` §Hosting) and a second one should be a
decision rather than a default.

Then:

```bash
fly status --app mariva-api
fly logs --app mariva-api
curl https://mariva-api.fly.dev/health
```

A machine that will not stay up is almost always one of two things, and both name
themselves in the log: a missing environment variable, printed as one line with
the variable's name, or a database behind the migrations, printed as the
migration that has not been applied. Neither is fixed by redeploying.

## 9. Deploy the front ends

Two Vercel projects from one repository, one per app. In the Vercel dashboard,
**Add New → Project**, import the repository, and create it twice:

| | `web` | `admin` |
|---|---|---|
| Root Directory | `apps/web` | `apps/admin` |
| Framework preset | Next.js (detected) | Next.js (detected) |

Everything else comes from the `vercel.json` in each root directory, which is
short on purpose:

- `"regions": ["sin1"]` — Singapore. Hobby may select any single region, so this
  works before the `G2` upgrade to Pro.
- `"buildCommand": "cd ../.. && pnpm exec turbo run build --filter=@mariva/web"`
  — turbo from the workspace root rather than `next build` in place. Each app's
  build task `dependsOn: ["^build"]`, and the packages it imports publish types
  and JavaScript out of their own `dist/`; the default command would compile
  against a `dist/` that was never written.

**⚠ confirm** that *Include source files outside of the Root Directory in the
Build Step* is enabled on both projects. Vercel turns it on when it detects a
workspace, but the build command above walks up two directories and fails without
it.

Set the one public variable on each project, before the first build — Next inlines
`NEXT_PUBLIC_` values into the client bundle when it compiles, so a value added
afterwards does nothing until the next deploy:

```bash
cd apps/web && vercel link && vercel env add NEXT_PUBLIC_API_URL production
cd ../admin && vercel link && vercel env add NEXT_PUBLIC_API_URL production
```

The value is `API_URL` from step 5 — `https://mariva-api.fly.dev` until a custom
domain exists. Add it for the `preview` and `development` environments too if
preview deployments are going to be used against the same API.

Then deploy each:

```bash
cd apps/web && vercel --prod
cd ../admin && vercel --prod
```

Note the production URL Vercel prints for each.

## 10. Close the CORS loop

Steps 5 and 9 are circular: the API needs the front ends' origins and the front
ends need the API's. The API went first because its address is predictable and
theirs is not.

Put the two URLs from step 9 into `WEB_ORIGIN` and `ADMIN_ORIGIN` in `fly.toml`,
commit that change, and deploy the API again with the command from step 8. No
migration is involved, so step 7 is not repeated.

Do the same after attaching custom domains: a domain change is an origin change,
and an origin change is a redeploy of the API.

## 11. Verify

| Check | Expected |
|---|---|
| `curl https://mariva-api.fly.dev/health` | `200` with `{"status":"ok","database":"up"}` |
| Guest sign-up on the public site | Completes, and a verification mail arrives |
| Staff sign-in on the console with the step 7 account | Completes, and the shell loads |
| `GET /payments/gateways` | Reports no gateway. Correct until `G2` |
| `fly logs --app mariva-api` | JSON lines, no repeated boot |

`/health` executes `select 1` through the pool and returns 200 only after that
round trip comes back, so a green check means the API can reach Neon rather than
that the Node process is alive. It is the same route `fly.toml`'s check polls and
the one Better Stack is pointed at when monitoring is set up.

## Rollback

**The API.** Fly keeps every release's image.

```bash
fly releases --app mariva-api --image
fly deploy . --config apps/api/fly.toml --image registry.fly.io/mariva-api:deployment-<label>
```

This is safe against a schema that has moved on, and deliberately so:
`assertMigrationsApplied` refuses only a database *behind* the build, never one
ahead of it. An older build against a newer schema starts. What it does not do is
undo a migration — nothing here does, and no migration in this repository is
written to be reversed. A schema change that has to be taken back is a new
migration, generated, reviewed and applied through step 7 like any other.

**The front ends.** Vercel keeps previous deployments addressable.

```bash
cd apps/web && vercel rollback <previous deployment url>
```

On Hobby only the immediately previous production deployment can be rolled back
to; going further needs Pro. `vercel promote <url>` undoes a rollback.

**Order matters when both move together.** Roll the front ends back first and the
API second: a front end is the only thing a guest sees, and an API one release
ahead of the site it serves is the pair that still works.

## What is not in this file

`infrastructure.md` decides several things this procedure does not set up, and
each has its own owner:

- **Cloudflare R2**, the weekly encrypted `pg_dump` and the restore drill —
  §Backup and retention. The drill is the evidence, not the job.
- **Better Stack** — the `/health` probe and the heartbeat the night audit checks
  into, both alerting to a phone.
- **Both payment gateways** — gate `G2` and its two runbooks.
- **The cross-border transfer dossier** for guest personal data held in
  Singapore. It gates opening the property rather than any deploy, and it is the
  lawyer's (`M0-05`).

One thing this file makes possible rather than does: `NFR-03`, the availability
calendar's response time, has only ever been measured on one machine, and a
deployment is what a real measurement of it needs.
[`evaluations/nfr-03-availability-latency.md`](evaluations/nfr-03-availability-latency.md)
§7 has the procedure — where to point the load profile once step 8 has produced
an `API_URL`, how to pin the window to the deployed calendar rather than to a
seeded one, and what the resulting number may be claimed for.
