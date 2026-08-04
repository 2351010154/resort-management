// The contract root: one definition the API implements and the client calls, so
// a route that changes shape breaks both sides at compile time instead of at
// runtime in whichever one was deployed second.
//
// Domain contracts join here as their modules are built — inventory and pricing
// at M3. Nothing is listed speculatively; an entry with no implementation is a
// promise the type system will hold the client to and nobody can keep.

import { availability } from "./availability.js";
import { health } from "./health.js";
import { inventory } from "./inventory.js";
import { jobs } from "./jobs.js";
import { pricing } from "./pricing.js";

export const contract = {
  health,
  availability,
  inventory,
  pricing,
  jobs,
};

export type Contract = typeof contract;

// The request and response shapes themselves, so a service can name what it is
// handed without inferring it back out of the router object.
export { rateCalendarQuery, stayOfferQuery } from "./availability.js";
export { closeRoomInput, roomClosureSchema } from "./inventory.js";
export { jobRunSchema, triggerJobInput } from "./jobs.js";
export {
  isUnrestricted,
  pricingRangeQuery,
  ratePlanSchema,
  setRateCalendarInput,
  setStayRestrictionsInput,
  stayRestrictionSchema,
  updateRatePlanInput,
} from "./pricing.js";
