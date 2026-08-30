# Evaluation — `NFR-03`, availability calendar response time

A dated record of what has actually been measured against
[`product-requirements.md`](../product-requirements.md) §5 row `NFR-03`, on what
hardware, and what each number may honestly be claimed for. It is evidence, not
a decision: the requirement and its target belong to the product requirements,
and this file only reports what a run returned.

**Two measurements exist, and neither of them is a deployed one.**

| # | What ran | Date | Reported p95 |
|---|---|---|---|
| 1 | The whole stack in containers, from the Dockerfiles a deploy uses | 2026-08-30 | **17.078 ms** |
| 2 | The API as a host process against Postgres in a container | 2026-08-27 | **13.951 ms** |

They measured different systems and neither supersedes the other. Both are
**lower bounds** on the deployed number, because both ran entirely on one
machine with no wide-area network and no Neon (§5.3). The measurement `NFR-03`
ultimately owes — against Fly, Vercel and Neon in Singapore — has not been
taken, and §7 says how to take it.

## 1. Requirement and verdict

| Field | Value |
|---|---|
| Requirement | `NFR-03` — availability p95, twelve-month calendar ([`product-requirements.md`](../product-requirements.md) §5) |
| Endpoint | `GET /availability/calendar?from=…&to=…&plan=STANDARD` |
| Target | p95 response time **< 300 ms** |
| Containerized pre-deploy, worst of three runs | **17.078 ms** — PASS, ≈17.6× inside the budget |
| Host process, worst of three runs | **13.951 ms** — PASS, ≈21.5× inside the budget |
| Machine verdict | k6 exit code `0` on all six recorded runs; both declared thresholds satisfied in every one |

Each figure is reported as the **worst** of its three runs rather than the mean
or the median, because the worst run is the one a claim of *under 300 ms* has to
survive. The median run of each set is given in §2 alongside it.

## 2. Results

All figures are the k6 `http_req_duration` trend — full request time seen by the
client, including HTTP, JSON serialisation and the per-request server log write.

### 2.1 Containerized pre-deploy stack — 2026-08-30

Postgres, the API, the public site and the staff console all running from
[`compose.yaml`](../../compose.yaml), built from the same three Dockerfiles a
deploy uses. k6 ran on the host and reached the API through its published port.

| Run | p50 (med) | p90 | p95 | p99 | max | requests | throughput | `p(95)<300` | `checks rate==1.00` | exit |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 11.617 ms | 15.959 ms | 16.993 ms | 18.911 ms | 54.084 ms | 79 977 | 666.5 req/s | PASS | PASS (159 954/159 954) | 0 |
| 2 | 11.606 ms | 16.021 ms | 17.078 ms | 19.111 ms | 36.415 ms | 80 088 | 667.4 req/s | PASS | PASS (160 176/160 176) | 0 |
| 3 | 11.593 ms | 15.848 ms | 16.857 ms | 18.542 ms | 44.307 ms | 80 330 | 669.4 req/s | PASS | PASS (160 660/160 660) | 0 |

- **Reported figure: 17.078 ms**, the worst of the three run p95 values
  (16.993 / 17.078 / 16.857 ms). The median run is 16.993 ms.
- **Spread: 16.857–17.078 ms, a range of 0.22 ms, or 1.3 % of the median run.**
  The p50 spread is 0.02 ms. Three independent two-minute runs agreeing this
  closely is the evidence that this is a measurement of the system rather than
  one lucky sample; no averaging or outlier removal was applied.
- **240 395 recorded requests, zero failed requests, zero failed checks.** Every
  iteration returned HTTP 200 carrying a full 365-night window.

Raw k6 summaries, one per run:
[run 1](nfr-03-availability-latency/container-run-1.json),
[run 2](nfr-03-availability-latency/container-run-2.json),
[run 3](nfr-03-availability-latency/container-run-3.json).

### 2.2 Host process against containerized Postgres — 2026-08-27

The API built with `tsc` and run as `node dist/main.js` directly on the host,
against Postgres in a container. No API container, no front ends, no Docker
network in the request path.

| Run | p50 (med) | p90 | p95 | p99 | max | requests | throughput | `p(95)<300` | `checks rate==1.00` | exit |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 11.837 ms | 13.401 ms | 13.868 ms | 15.027 ms | 24.728 ms | 84 138 | 701.1 req/s | PASS | PASS (168 276/168 276) | 0 |
| 2 | 11.638 ms | 13.430 ms | 13.951 ms | 15.131 ms | 23.544 ms | 85 134 | 709.4 req/s | PASS | PASS (170 268/170 268) | 0 |
| 3 | 11.787 ms | 13.364 ms | 13.848 ms | 15.137 ms | 23.585 ms | 84 942 | 707.8 req/s | PASS | PASS (169 884/169 884) | 0 |

- **Reported figure: 13.951 ms**, the worst of the three run p95 values
  (13.868 / 13.951 / 13.848 ms). The median run is 13.868 ms. An earlier
  statement of this measurement called 13.95 ms the *median* run; it is the
  worst of the three, and the correction is recorded here rather than quietly
  applied.
- **Spread: 13.848–13.951 ms, a range of 0.10 ms, or 0.7 % of the median run.**
  p50 spread is 0.20 ms, p99 spread 0.11 ms.
- **254 214 recorded requests, zero failed requests, zero failed checks.**

Raw k6 summaries:
[run 1](nfr-03-availability-latency/host-run-1.json),
[run 2](nfr-03-availability-latency/host-run-2.json),
[run 3](nfr-03-availability-latency/host-run-3.json).

In k6's exported summary format the `thresholds` booleans record *failure*, so
the `false` recorded in every file above is the pass verdict, consistent with the
console output and exit 0.

### 2.3 What separates the two

Containerizing the API cost about **3.1 ms at p95** (13.868 → 16.993 ms comparing
median runs) and about 6 % of throughput (707 → 668 req/s), while leaving p50
unchanged at ~11.6 ms. The cost is entirely in the tail: p90 moves 13.40 → 15.96
ms while the median moves the other way by 0.2 ms.

It is not database work. The same query against the containerized Postgres
plans identically to the host run and executes in 1.809 ms against 1.547 ms —
same node shapes, same costs, same 36 shared buffer hits (§6). What the extra
milliseconds buy is the request crossing a Docker bridge network to reach
Postgres and Docker Desktop's published-port forwarding to reach the API, both
of which a host process does not pay and a deployed one pays differently.

## 3. Method

Both sets used the same profile, the same window, the same thresholds and the
same three-runs-after-a-discarded-warm-up shape. What differed is only what was
running, recorded in §4.

**Pinned window — `FROM=2026-08-01`, `TO=2027-08-01`, half-open `[from, to)`.**
The seeded calendar covers nights 2026-08-01 through 2027-07-31 inclusive: 365
nights, all five room types, no gaps. Pinning both dates lands the request
exactly on seeded data, and this was verified before measuring in both sets —
HTTP 200, body carrying exactly 365 nights, first `2026-08-01`, last
`2027-07-31`, and `min(stay_date)`/`max(stay_date)` read straight from
`type_inventory`.

The pin is not cosmetic. The k6 script defaults `from` to *today*, which on both
measurement dates would have run 365 nights past the end of the seed. For nights
it has no inventory row for, the route fabricates a sold-out night rather than
failing — cheap rows that would have flattered the percentile with roughly a
month of unseeded data. That is why the dates are stated explicitly rather than
left to the default.

**Dataset.** One seeded property: 40 rooms across 5 room types, 1 825
`type_inventory` rows, 1 825 `rate_calendar` rows, 170 `stay_restriction` rows,
500 synthetic stays. Identical row counts in both sets, verified in the database
before each. The database was seeded and verified before the runs and was not
re-seeded between them.

**Load profile**
([`apps/api/perf/availability-calendar.js`](../../apps/api/perf/availability-calendar.js),
unmodified in both sets): 30 s ramp to 10 virtual users, 1 m steady at 10 VUs,
30 s ramp down — two minutes per run, three runs, sequential, on an otherwise
idle machine.

**Discarded warm-up run.** One full run was executed first in each set and
discarded. k6 thresholds and summary statistics aggregate across *all* stages of
a run, so the opening ramp's cold cost — TCP setup, first query-plan
compilation, unwarmed shared buffers — sits inside whatever that run reports.
Discarding the first run entirely is what keeps that cost out of the recorded
figure. On the host set the discarded run was visibly colder (p95 19.93 ms over
71 494 requests). On the containerized set it was not (p95 16.923 ms over 79 023
requests, inside the recorded spread) — the API container had been answering its
own health check for a minute before k6 started, which is warm-up the host set
did not have. Both were discarded on method rather than on their numbers.

**Two thresholds, both machine-checked:**

- `http_req_duration: ["p(95)<300"]` — the requirement itself. A breach exits
  non-zero.
- `checks: ["rate==1.00"]` — every iteration must return 200 *and* carry the
  whole requested window. This exists because a request that errors is still a
  fast request: without it, a deployment answering HTTP 500 in 4 ms would satisfy
  the latency threshold and the run would be scored a pass. The latency number is
  only meaningful because this second threshold proves the responses were
  correct.

Neither threshold was edited or relaxed for any run in this document.

**Background work was left running.** The scheduled sweeps fired on their normal
cadence during both sets — in the containerized one `hold-expiry` every minute
and `e-invoice` on its own schedule, both visible in the API log across the whole
measured period. A deployment runs them too, so they belong inside the figure.

**Reproduction.** Both sets used the unmodified script with the window pinned by
environment variable, a per-run JSON summary export, and `--summary-trend-stats`
widened to add `p(90)` (the script's own `summaryTrendStats` omits it):

```bash
# from apps/api, against a migrated + seeded database and a running API
k6 run \
  --summary-export=../../<somewhere>/run-1.json \
  --summary-trend-stats "avg,min,med,p(90),p(95),p(99),max" \
  -e BASE_URL=http://localhost:3001 \
  -e FROM=2026-08-01 -e TO=2027-08-01 \
  perf/availability-calendar.js
```

The containerized set was stood up with the rehearsal in
[`deployment.md`](../deployment.md) §1 — `compose up -d db`, migrate from the
host, seed, then `compose up -d --build` — and torn down with
`docker compose down -v` afterwards.

## 4. Environment

Both sets ran on the same machine, on the dates given.

| Component | Containerized, 2026-08-30 | Host process, 2026-08-27 |
|---|---|---|
| CPU | AMD Ryzen 9 8940HX — 16 physical / 32 logical cores | same |
| RAM | 31.2 GB | same |
| OS | Microsoft Windows 11 Pro, build 26200 | same |
| API | `apps/api/Dockerfile` image, Node v24.20.0 in the container | built with `tsc`, run as `node dist/main.js` on the host, Node v25.2.1 |
| Postgres | 17.10 (Debian 17.10-1.pgdg13+1), `compose.yaml` service `db`, container port 5432 on the compose network | 17.10 (Debian 17.10-1.pgdg13+1), container `mariva-pg-test`, host port 5433 |
| Also running | the `web` and `admin` containers, idle — no request in this measurement reached either | nothing else |
| Container runtime | Docker Engine 29.6.2, Docker Desktop VM with 32 CPUs and 15.2 GiB | Docker Engine 29.6.2 (Postgres only) |
| k6 | v2.2.0 (windows/amd64), on the host | same |
| Log level | `info` — the default (`LOG_LEVEL` unset; `apps/api/src/config/env.ts` defaults it) | same |
| `NODE_ENV` | `development`, as `compose.yaml` sets it | `development` |

**Log level matters and is not tuned down.** At `info`, pino-http emits one
structured line per completed request; the containerized API logged 319 504
lines against 319 418 requests plus health checks over the warm-up and the three
recorded runs. That per-request write is a cost a default deployment pays, so it
is inside every number above. Suppressing it to `warn` would have produced a
lower and less honest figure.

**Load generator and system under test shared one machine** in both sets. At 10
VUs on 32 logical cores this is not a contention risk, but it is why the figures
contain no wide-area network time (§5.3).

## 5. Limitations

These are stated as found. Each one bounds what either figure may be used to
claim.

### 5.1 The query plan uses sequential scans, not the indexes

`type_inventory`, `rate_calendar` and `stay_restriction` each carry a
`stay_date` btree index, and the planner used none of them (§6), in both sets. At
1 825 rows spanning exactly the requested window a 16-page sequential scan is
cheaper, and the planner is correct to choose it. The consequence is that the
headroom measured here is real but **its scaling behaviour is unproven**: the
figures characterise a full scan of a small table, at 5 room types and one year
of retained history. A property with materially more room types, or more retained
history, changes the shape of the access path and must be re-measured. Nothing
here predicts what that re-measurement would return.

### 5.2 Every iteration requests an identical URL

The window is pinned, so all 494 609 requests across both sets hit the same query
with the same parameters and Postgres serves them from a fully warm cache — zero
disk reads in the measured path (§6). This is defensible because `NFR-03` names
exactly this one read, the twelve-month calendar the funnel opens on, and a
single-property deployment genuinely serves close to one window. But it means
both results are **hot-path steady-state figures, not cold-start ones**, and they
say nothing about cache-miss behaviour or about a workload spread across many
distinct windows.

### 5.3 Both figures are lower bounds — neither is a production number

Both runs put k6, the API and Postgres on one machine. Deployed environments run
the API on Fly in `sin` and Postgres on Neon in `aws-ap-southeast-1`
([`architecture/infrastructure.md`](../architecture/infrastructure.md)), which
adds client-to-server network latency, an API-to-database hop across a provider
boundary, a different storage profile and, on the free tier, idle-suspend
behaviour that a local container cannot represent.

Each figure therefore isolates **what the system itself costs on the documented
hardware**. Both are lower bounds on the deployed number, and the containerized
one is the tighter of the two only in the sense that it carries the container
boundary; it still carries no wide-area network. Neither may be cited as a
production or Neon measurement, and no production claim can be derived from
either by adding an assumed network delay. Proving `NFR-03` against the deployed
stack is a separate measurement, unperformed — §7.

### 5.4 Closed-model virtual users, not a fixed arrival rate

The profile uses 10 VUs, each of which issues its next request only after the
previous response arrives. This is a *closed* model: if responses slow down, the
offered load slows with them, so the system is never pushed past what it can
absorb and the tail percentiles are mildly flattered relative to an open model
with a fixed arrival rate (k6's `constant-arrival-rate` executor). At this
concurrency and with the observed 2–54 ms response range the distortion is
marginal, but both reported p95 values are closed-model p95 values and are named
as such.

### 5.5 Ten virtual users needs its own justification

The script chooses 10 VUs on the stated reasoning that ten concurrent readers is
more than this property's funnel sees, and low enough that a p95 above 300 ms
would indict the query rather than the machine. The arithmetic behind that: the
property has 40 rooms and the seeded stays average about 3 nights, so even at
100 % year-round occupancy it turns over roughly 40 × 365 ÷ 3 ≈ 4 900 bookings a
year, about 13 a day. At even fifty calendar views per booking that is ~650
calendar reads a day, under 0.01 requests per second; the measured runs sustained
666–709 requests per second. Ten VUs is therefore several orders of magnitude
above realistic demand, which is the point — but it also means these runs prove
latency under light concurrency and **are not a capacity test**. The concurrency
at which the service degrades was not measured.

### 5.6 The seeded window is anchored to the seed month

The seed derives its calendar as the first of the *current* month in the
property's `Asia/Ho_Chi_Minh` zone plus twelve months. Re-seeding on or after
2026-09-01 shifts the seeded window to `2026-09-01 → 2027-08-31` and silently
invalidates the pinned `FROM=2026-08-01` used here — a re-run would then measure
unseeded, fabricated nights. Any reproduction after that date must re-verify the
seeded minimum and maximum `stay_date` before pinning, and the dates in §3 will
need to change accordingly. The script accepts any window length and checks the
response against the one it asked for, so re-pinning is a matter of two
environment variables and no edit.

### 5.7 The two front ends were up but idle

The containerized set had the `web` and `admin` containers running, because the
rehearsal in `deployment.md` §1 starts the whole stack. Neither served a request
during the measurement, so they contributed memory pressure on the same machine
and nothing else. This is not a measurement of the system under mixed traffic.

## 6. Query plan evidence

`EXPLAIN (ANALYZE, BUFFERS)` of the calendar aggregate, same pinned window,
captured against the containerized Postgres on 2026-08-30:

```text
HashAggregate  (cost=178.06..181.71 rows=365 width=32) (actual time=1.645..1.683 rows=365 loops=1)
  Group Key: ti.stay_date
  Batches: 1  Memory Usage: 93kB
  Buffers: shared hit=36
  ->  Hash Left Join  (cost=69.88..132.44 rows=1825 width=19) (actual time=0.683..1.309 rows=1825 loops=1)
        Hash Cond: ((ti.room_type_id = sr.room_type_id) AND (ti.stay_date = sr.stay_date))
        Buffers: shared hit=36
        ->  Hash Join  (cost=63.62..116.59 rows=1825 width=32) (actual time=0.629..1.061 rows=1825 loops=1)
              Hash Cond: ((ti.room_type_id = rc.room_type_id) AND (ti.stay_date = rc.stay_date))
              Buffers: shared hit=34
              ->  Seq Scan on type_inventory ti  (cost=0.00..43.38 rows=1825 width=24) (actual time=0.006..0.153 rows=1825 loops=1)
                    Filter: ((stay_date >= '2026-08-01'::date) AND (stay_date < '2027-08-01'::date))
                    Buffers: shared hit=16
              ->  Hash  (cost=36.25..36.25 rows=1825 width=28) (actual time=0.601..0.602 rows=1825 loops=1)
                    Buckets: 2048  Batches: 1  Memory Usage: 123kB
                    Buffers: shared hit=18
                    ->  Seq Scan on rate_calendar rc  (cost=0.00..36.25 rows=1825 width=28) (actual time=0.009..0.371 rows=1825 loops=1)
                          Buffers: shared hit=18
        ->  Hash  (cost=3.70..3.70 rows=170 width=23) (actual time=0.038..0.038 rows=170 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 18kB
              Buffers: shared hit=2
              ->  Seq Scan on stay_restriction sr  (cost=0.00..3.70 rows=170 width=23) (actual time=0.004..0.017 rows=170 loops=1)
                    Buffers: shared hit=2
Planning:
  Buffers: shared hit=379
Planning Time: 0.913 ms
Execution Time: 1.809 ms
```

The same capture on 2026-08-27 against the host set's Postgres returned an
identical plan — same nodes, same costs, same 36 shared buffer hits — with
`Planning Time: 1.023 ms` and `Execution Time: 1.547 ms`.

**What it proves.**

- **One statement, one pass, 365 groups.** The twelve-month window is answered by
  a single grouped aggregate, not by twelve month-sized queries fanned out or 365
  per-night reads. That is the design property `NFR-03` rests on, and the plan
  shows it directly.
- **36 shared buffer hits, zero reads.** There is no disk in the measured path.
- **1.8 ms execution against an ~11.6 ms end-to-end p50** puts the database at
  roughly a sixth of request time. The rest is HTTP handling, JSON serialisation
  of 365 nights, the per-request log write and — in the containerized set — the
  Docker network hops. This route is not database-bound at this data size.

**What it does not prove.** It does not prove the access path is indexed — it is
not; all three scans are sequential (§5.1). It does not prove anything about the
plan at a larger row count, since the planner's choice here is a function of
table size. And it is a plan captured against local Postgres, not against Neon.

## 7. The deployed measurement, still owed

`NFR-03` is a requirement about the system guests use, and no figure in this
document was taken against it. The measurement below is the one the requirement
actually owes; it has **not** been performed, because no account exists at any
vendor yet.

**Prerequisite.** A deployment reachable at `API_URL`, stood up by working
[`deployment.md`](../deployment.md) end to end. That file owns the procedure and
this one does not repeat it. `curl $API_URL/health` returning
`{"status":"ok","database":"up"}` is the gate — measuring an API that cannot
reach its database measures nothing.

**Pin the window to that deployment's own calendar, not to this document's
dates.** A deployed database holds whatever inventory the property has opened,
which will not be 2026-08-01 → 2027-08-01. Read the bounds first, either from
Neon:

```sql
select min(stay_date), max(stay_date) from type_inventory;
```

or from the deployment itself, by asking for a window and counting what comes
back. `TO` is exclusive, so it is the day *after* the last night wanted.

**Then the same profile, pointed at the deployment.** `BASE_URL` is read from
the environment, so the existing package script carries it without an edit:

```bash
BASE_URL=https://mariva-api.fly.dev \
FROM=<first night> TO=<day after last night> \
  pnpm --filter @mariva/api perf:availability
```

For a record comparable with §2, run it the way §3 does — one discarded warm-up
followed by three recorded runs, each with `--summary-export` and
`--summary-trend-stats "avg,min,med,p(90),p(95),p(99),max"` — which needs `k6
run` directly rather than the package script:

```bash
cd apps/api && k6 run \
  --summary-export=../../docs/evaluations/nfr-03-availability-latency/deployed-run-1.json \
  --summary-trend-stats "avg,min,med,p(90),p(95),p(99),max" \
  -e BASE_URL=https://mariva-api.fly.dev \
  -e FROM=<first night> -e TO=<day after last night> \
  perf/availability-calendar.js
```

**What to expect and what not to conclude.** The number will be larger than
anything in §2, and most of the difference will be network: the run originates
from wherever the operator sits, and Fly is in Singapore. A run from Vietnam
carries roughly a regional round trip on every request that a loopback run does
not. Two consequences follow, and both matter for how the result is written up:

- The threshold is unchanged. `p(95)<300` is the requirement wherever the load
  generator stands, and a breach is a real breach.
- The result is a measurement *from where it was run*. Record the origin — city
  or at least country, and the connection — beside the figure, because a p95
  measured from Hanoi over consumer fibre and one measured from a Fly machine in
  the same region are different claims.

Load also lands on a machine sized by [`fly.toml`](../../apps/api/fly.toml)
rather than on 32 logical cores, and on the free Neon tier a first request after
idle pays a resume. Take the warm-up discard seriously there; it is doing more
work than it did here.

**Where the result goes.** Back into this file, as a third set beside §2.1 and
§2.2, with its own environment row in §4 — and the `NFR-03` row in
[`product-requirements.md`](../product-requirements.md) §5 loses its "the
deployed measurement is still owed" caveat only once that set exists.

## 8. Traceability

- Requirement statement and target: [`product-requirements.md`](../product-requirements.md) §5, row `NFR-03`.
- Load profile: [`apps/api/perf/availability-calendar.js`](../../apps/api/perf/availability-calendar.js).
- Query under test: the calendar aggregate in [`apps/api/src/modules/inventory/availability.service.ts`](../../apps/api/src/modules/inventory/availability.service.ts).
- Contract and window semantics: [`packages/shared/src/contract/availability.ts`](../../packages/shared/src/contract/availability.ts).
- The containerized stack: [`compose.yaml`](../../compose.yaml), stood up per [`deployment.md`](../deployment.md) §1.
- Deployed-environment decisions: [`architecture/infrastructure.md`](../architecture/infrastructure.md).
- Raw evidence: the six k6 summary exports in [`nfr-03-availability-latency/`](nfr-03-availability-latency/).
