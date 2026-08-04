// Running a sweep on purpose — the manual half of `prd-m4.md`'s job
// infrastructure, and `operations.night-audit-trigger` in the matrix.
//
// That row is `MANAGER` and `ADMIN`. It is not `system.job-queue`, which sits
// two rows below it and is `ADMIN` only: that one is for reading the queue and
// its dead letters, and inspecting a failure is a different act from causing
// one. The row used here is the one whose words are "trigger night audit
// manually", which is exactly what this is — a night that did not sweep, swept
// by the person who noticed.
//
// The run is synchronous. It could have enqueued the job and answered with a
// ticket, and that would be the shape at a scale this property does not have;
// what it would cost is the one property the requirement asks for by name — that
// a test can run a sweep deterministically. A caller that has to poll for an
// outcome cannot assert on one.
//
// The job is named as free text rather than as an enum of the sweeps that exist.
// Which sweeps exist is the API's business and changes with its modules, and a
// contract listing them would have the client's build break because the server
// renamed a background task it never calls. An unknown name is a 404 whose
// message names the ones that are registered.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { isoStayDateSchema, stayDateSchema } from "../stay-date.js";

export const triggerJobInput = z.object({
  job: z.string().trim().min(1).max(64),
  // Optional, and the whole reason the route takes a body at all. Omitted, the
  // sweep runs over the property's current business date, which is what an
  // operator means. Given, it runs over the date named — which is what a test
  // means, and what the manager re-running a night the scheduler missed means.
  businessDate: stayDateSchema.optional(),
});

export const jobRunSchema = z.object({
  job: z.string(),
  /** The date the sweep was run over, resolved — never echoed back as absent. */
  businessDate: isoStayDateSchema,
  /**
   * Rows the sweep changed. Zero is the ordinary answer and, for a second run
   * over a date already swept, the required one.
   */
  affected: z.number().int().min(0),
});

export const jobs = {
  trigger: oc
    // A run is not a resource this API keeps, so there is nothing to hand back
    // a location for: 200 with what happened, not 201 with an id.
    .route({ method: "POST", path: "/jobs/{job}/runs" })
    .input(triggerJobInput)
    .output(jobRunSchema),
};
