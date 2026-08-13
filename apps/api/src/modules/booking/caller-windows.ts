// How often one caller may do something, counted in this process.
//
// Two doors on the funnel need the same arithmetic and refuse for different
// reasons: `hold-rate-limit.guard.ts` bounds how often an address may take a room
// off the shelf, and `presence-rate-limit.guard.ts` bounds how often it may say
// it is still standing on one. What they share is the counting — a fixed window
// per caller, a ceiling on how many callers are remembered, and an eviction rule
// for the day something tries to grow the map without bound — and what they do
// not share is the sentence, the figure, or who reads it. So the counting lives
// here once and each guard is what it refuses plus what it says.
//
// **In memory, which is correct for one instance and wrong for two.** The counter
// lives in this process, so two machines behind one hostname would each allow the
// full rate and the property would face twice whatever a policy states. That is
// the same caveat Better Auth's own limiter carries (`guest-auth.factory.ts`),
// and the same answer applies: it is honest at one instance, it is the deployment
// this milestone has, and the day a second machine is started the counter has to
// move to a shared store rather than being tuned down to compensate.
//
// **Who a caller is lives in `caller-key.ts`**, with the argument for the /64 and
// for the proxy hop the address is read off. Nothing here decides identity; it
// only counts against whatever it is handed.
//
// **Fixed windows, not a token bucket.** A window that resets lets a caller spend
// the whole allowance at the boundary and again immediately after, which is twice
// the rate for one moment. For limits whose job is to make sustained automation
// expensive rather than to smooth traffic, that is an acceptable and
// well-understood edge; the alternative is per-caller timestamp lists, which is
// memory this would then have to bound.

/** How many times one caller may act, and over what. */
export interface CallerRatePolicy {
  readonly limit: number;
  readonly windowMs: number;
}

/**
 * How many callers are tracked at once, and what happens past it.
 *
 * A hard ceiling and not only an expiry sweep. A caller cycling addresses —
 * which the grouping in `caller-key.ts` makes expensive but not impossible —
 * would otherwise grow the map without bound, and a sweep that found every window
 * fresh would walk the whole thing on every request while freeing nothing. Past
 * the ceiling the expired entries go first and, if that frees none, the oldest
 * window is evicted: the caller it belonged to gets a fresh allowance, which is
 * the safe direction to fail for a limiter whose job is to make sustained
 * automation expensive rather than to be an authorisation decision.
 */
const TRACKED_CEILING = 10_000;

interface Window {
  count: number;
  startedAt: number;
}

/** One policy's worth of counting, per caller. */
export class CallerWindows {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly policy: CallerRatePolicy) {}

  /**
   * Whether this caller is still inside its allowance, counting this call.
   *
   * A refused call is counted like any other. A limiter that treated its own
   * refusal as a fresh start would let every second call through, which is the
   * shape of limiter that looks like it works.
   */
  admits(caller: string, now: number = Date.now()): boolean {
    if (this.windows.size >= TRACKED_CEILING) {
      this.makeRoom(now);
    }

    const current = this.windows.get(caller);

    if (!current || now - current.startedAt >= this.policy.windowMs) {
      this.windows.set(caller, { count: 1, startedAt: now });

      return true;
    }

    current.count += 1;

    return current.count <= this.policy.limit;
  }

  /** Expired windows first, then the oldest — see {@link TRACKED_CEILING}. */
  private makeRoom(now: number): void {
    let oldest: [string, Window] | undefined;

    for (const entry of this.windows) {
      if (now - entry[1].startedAt >= this.policy.windowMs) {
        this.windows.delete(entry[0]);

        continue;
      }

      if (!oldest || entry[1].startedAt < oldest[1].startedAt) {
        oldest = entry;
      }
    }

    if (this.windows.size >= TRACKED_CEILING && oldest) {
      this.windows.delete(oldest[0]);
    }
  }
}
