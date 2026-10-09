// What each of the house's three standings is called on a guest's screen.
//
// Member, Silver and Gold are the only answers the derivation can give
// (`property-and-tariff.md` §7, `vipTierSchema`), so they are fixed and safe to
// name here. The stays and the revenue that reach each one are not: they are
// `system_config` rows an admin retunes without a deploy, which is why nothing
// on the account prints a threshold or a distance to the next standing.
//
// Two places name a standing — the member card and the profile's heading — and
// two copies of three words are two places a guest could be told different
// things, so the words live here.

import type { Profile } from "./profile";

export type TierCode = Profile["vipTier"];

const NAMES: Readonly<Record<TierCode, string>> = {
  MEMBER: "Member",
  SILVER: "Silver",
  GOLD: "Gold",
};

/** "Silver" for `SILVER`. */
export function tierName(code: TierCode): string {
  return NAMES[code];
}
