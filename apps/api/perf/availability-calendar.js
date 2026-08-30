// Load profile for the 12-month availability calendar — the read the booking
// funnel opens on, and the one the non-functional requirement names: p95 under
// 300 ms over a twelve-month window.
//
// The route is `GET /availability/calendar` (packages/shared/src/contract/
// availability.ts). It is the single unauthenticated capability row in the
// matrix, so no credential is needed against a default deployment; STAFF_TOKEN
// exists only so the same profile can be pointed at a deployment that has since
// put rates behind a login. Nothing here carries a secret — every value that
// could be one arrives from the environment.
//
// Run it with `pnpm --filter @mariva/api perf:availability`. It measures a
// running API against a real database; it does not start either.
//
// ## Pointing it somewhere else
//
// `BASE_URL` selects what is measured and defaults to the local API, so an
// invocation that passes nothing keeps measuring what it always did. Give it a
// deployed origin — `BASE_URL=https://mariva-api.fly.dev` — and the same
// profile, the same thresholds and the same window measure that deployment
// instead. Two things change when it does, and neither is a defect: the number
// then contains client-to-server network time, which a loopback run has none
// of, and the window has to be pinned to dates that deployment actually holds
// inventory for. `FROM` and `TO` exist for that, and the check below counts
// nights from them rather than assuming a year, so a window of any length is
// still checked honestly.
//
// `docs/evaluations/nfr-03-availability-latency.md` records what has been
// measured with this file, on what, and what each figure may be claimed for.

import { check } from "k6";
import http from "k6/http";

const BASE_URL = (__ENV.BASE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const STAFF_TOKEN = __ENV.STAFF_TOKEN ?? "";
const PLAN = __ENV.PLAN ?? "STANDARD";

// The window the funnel asks for on first paint: 365 nights, half-open
// [from, to), which is the convention every stay range in the system uses. The
// contract refuses anything longer than 425 nights, so this sits inside the
// ceiling with room to spare.
const CALENDAR_NIGHTS = 365;

// UTC rather than the property's zone. A load profile only needs a window that
// covers the seeded twelve months of rates; which side of midnight in Bangkok
// it starts on changes no measurement. FROM overrides it when a run has to line
// up with a specific seeded calendar.
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function midnightUtc(day) {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    throw new Error(`not a YYYY-MM-DD calendar date: ${day}`);
  }
  return parsed;
}

const from = __ENV.FROM ?? isoDate(new Date());
const to =
  __ENV.TO ??
  isoDate(new Date(midnightUtc(from) + CALENDAR_NIGHTS * 86_400_000));

// What a correct response has to contain, counted from the window actually
// requested rather than from the default. A run that pins FROM and TO to a
// deployment's own calendar — which a deployed run must — then still proves
// every night came back, instead of failing every iteration for the sole
// reason that the window is not exactly a year long.
const requestedNights = (midnightUtc(to) - midnightUtc(from)) / 86_400_000;
if (!Number.isInteger(requestedNights) || requestedNights < 1) {
  throw new Error(
    `FROM must fall at least one night before TO — got ${from} to ${to}`,
  );
}

const url = `${BASE_URL}/availability/calendar?from=${from}&to=${to}&plan=${PLAN}`;

export const options = {
  // Modest and deliberately so. What is being proven is a latency percentile,
  // not a capacity ceiling: ten concurrent readers is more than this property's
  // funnel sees, and low enough that a p95 above 300 ms indicts the query
  // rather than the machine the test ran on. The opening ramp is warm-up —
  // connection setup and the first query plan — and the closing one keeps the
  // last iterations from being cut off mid-flight.
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 10 },
    { duration: "30s", target: 0 },
  ],

  thresholds: {
    // The requirement, machine-checked. A failing run exits non-zero.
    http_req_duration: ["p(95)<300"],

    // A request that errors is still a fast request, and without this line a
    // deployment answering 500 in 4 ms would satisfy the one above. Every
    // iteration must come back 200 carrying a full window of nights.
    checks: ["rate==1.00"],
  },

  // p(95) is what the requirement is written in, so it belongs in the printed
  // summary and not only in the threshold verdict.
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "max"],
};

export default function availabilityCalendar() {
  const response = http.get(url, {
    headers: STAFF_TOKEN ? { Authorization: `Bearer ${STAFF_TOKEN}` } : {},
    tags: { name: "availability-calendar" },
  });

  check(response, {
    "status is 200": (r) => r.status === 200,
    "answers the whole window": (r) => {
      if (r.status !== 200) return false;
      try {
        return r.json("nights").length === requestedNights;
      } catch {
        return false;
      }
    },
  });
}
