// Who a caller of the public door is, defined once.
//
// Two things bound `booking.create-own` and both have to agree about the
// caller's identity or neither means anything: `hold-rate-limit.guard.ts` counts
// requests per caller in this process, and `booking.service.ts` counts *live
// holds* per caller in SQL. A limiter that keyed on the address while the hold
// cap keyed on the /64 would be two different callers wearing one name, and the
// looser of the two would be the one that mattered. So the key lives here and
// both import it.
//
// **The caller's address is the edge's word, not the client's.** `main.ts`
// trusts exactly one proxy hop, so `request.ip` is what Fly appended to
// `X-Forwarded-For` and not what a client put there. That is a property of the
// deployment: reached off the proxy — a private-network address, or a future
// host that does not rewrite the header — a caller could name their own address
// and hold a private allowance. Both limits are a cost rather than an
// authorisation decision, and this is the assumption they rest on.

import { createHash } from "node:crypto";

/**
 * IPv6 is keyed by its /64 and not by the address.
 *
 * A client holds a whole /64 — eighteen quintillion addresses — at no cost, so
 * an exact-address key is a limit that binds the NAT'd family sharing one v4
 * address and nobody who is actually automating this. The prefix is the smallest
 * unit an operator hands out, so it is the unit worth counting.
 */
const IPV6_PREFIX_GROUPS = 4;

/** What an address has when none of it is elided. */
const IPV6_GROUPS = 8;

/**
 * What the hash below is separated by, so the digest means one thing.
 *
 * A bare `sha256(secret || caller)` would be a value another feature deriving
 * from the same secret could reproduce by accident. Prefixing the purpose makes
 * two derivations of one secret two different functions.
 */
const HOLD_CALLER_DOMAIN = "mariva:hold-caller";

/**
 * The caller a window and a hold cap are counted against — an address, or the
 * prefix it sits in when the address is IPv6.
 *
 * Express hands v4-mapped v6 addresses through as `::ffff:203.0.113.7`, which
 * is one address and is treated as one. A real v6 address is cut to its /64 for
 * the reason {@link IPV6_PREFIX_GROUPS} gives.
 */
export function callerOf(address: string | undefined): string {
  if (!address) {
    return "unknown";
  }

  if (!address.includes(":") || address.includes(".")) {
    return address;
  }

  return expanded(address).slice(0, IPV6_PREFIX_GROUPS).join(":");
}

/**
 * The caller as a column may hold them — a salted digest, never the address.
 *
 * `booking.held_by` is a stored column on a table the desk, the reports and
 * every future export read, and an address is personal data about somebody who
 * has not signed up for anything. What the concurrent-hold cap needs is only
 * equality: whether this request's caller is the one holding those three rooms.
 * A digest answers that and answers nothing else, and it is what makes the
 * column safe to keep for the ten minutes a hold lives.
 *
 * **Salted with `BETTER_AUTH_SECRET`, and derived rather than used.** The
 * address space this protects is small enough to enumerate — four billion v4
 * addresses is minutes of hashing — so an unsalted digest would be a reversible
 * record of who booked from where. The secret is the one value the API already
 * requires in every environment, so no deployment gains a variable it could
 * forget and no `.env` gains a line whose absence would be a boot failure at the
 * funnel's door. Nothing here is reversible into it: the digest is one way, it
 * is domain-separated from anything else the secret is used for by
 * {@link HOLD_CALLER_DOMAIN}, and the value stored is a hash rather than a
 * signature, so a leaked `held_by` proves nothing about the key that salted it.
 * A rotation of the secret orphans the live holds' keys, which costs one TTL's
 * worth of caps and nothing else.
 */
export function hashedCaller(caller: string, secret: string): string {
  return createHash("sha256")
    .update(HOLD_CALLER_DOMAIN)
    .update("\0")
    .update(secret)
    .update("\0")
    .update(caller)
    .digest("hex");
}

/**
 * The eight groups of an address, with anything a `::` stands in for written
 * out.
 *
 * Expanded before it is cut, and that order is the whole of it. A `::` elides a
 * run of zero groups that may begin anywhere, so the first four groups of the
 * *written* form are not the prefix whenever the run starts inside them:
 * `2001:db8::7` is `2001:db8:0:0:0:0:0:7`, and cutting the text would key it
 * under the whole address while `2001:db8::8` — the same /64, one host along —
 * took a window of its own. A caller who holds the prefix picks the host part,
 * so that is an allowance per address on the one door that takes rooms off the
 * shelf, which is exactly what {@link IPV6_PREFIX_GROUPS} exists to stop.
 *
 * A `::` appears at most once, which is what lets the two sides be read off a
 * single split. Nothing here validates the address: a malformed one keys to
 * whatever it expands to, because this is a counter rather than a parser, and
 * the zero count is floored so that a caller cannot turn one into a 500 on a
 * public route.
 */
function expanded(address: string): string[] {
  const groupsOf = (part: string) => (part === "" ? [] : part.split(":"));

  if (!address.includes("::")) {
    return groupsOf(address);
  }

  const [head = "", tail = ""] = address.split("::");
  const stated = groupsOf(head);
  const trailing = groupsOf(tail);
  const elided = Math.max(IPV6_GROUPS - stated.length - trailing.length, 0);

  return [...stated, ...Array<string>(elided).fill("0"), ...trailing];
}
