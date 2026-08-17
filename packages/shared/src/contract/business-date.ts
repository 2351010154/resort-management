// What day the property is having, as a route — `property-and-tariff.md` §2's
// rollover, answered by the API for any screen that needs the day and nothing
// else.
//
// **Its own file rather than a third route in `system-config.ts`.** That file is
// the seven editable figures behind the `system.config` row, and the row exists
// because one of the figures beside them is a gateway credential: it is read by
// `MANAGER` and written by `ADMIN`, and nothing else may come near it. The day
// is the opposite kind of fact — a receptionist, a housekeeper and an accountant
// all render against it, and none of them may open that row. Two audiences that
// far apart in one contract file is an invitation to reuse the wrong capability
// the next time a route is added, so the boundary is drawn in the file tree
// where it can be seen. The path still reads `/system/...` because the answer is
// the property's configuration applied to the clock, and that is where a reader
// will look for it.
//
// **The rollover hour itself is not here, and that is the point.** A client
// handed the hour would compute its own day, and two consoles doing that
// arithmetic at 01:30 against clocks a minute apart render two different days.
// So the crossing is made once, on the server, and what travels is the answer.
// `housekeeping.ts` states the same rule for the board; both resolve through
// `business-date.service.ts`, so they cannot disagree.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { isoStayDateSchema } from "../stay-date.js";

/**
 * The property's day, and nothing else.
 *
 * The field is named `businessDate` because that is what the board calls it —
 * a screen moving from one source to the other should be reading the same word.
 * ISO text rather than a decoded calendar date, which is what `stay-date.ts`
 * requires of every response.
 */
export const businessDateSchema = z.object({
  businessDate: isoStayDateSchema,
});

export const businessDate = {
  read: oc
    .route({ method: "GET", path: "/system/business-date" })
    .output(businessDateSchema),
};
