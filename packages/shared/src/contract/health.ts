import { oc } from "@orpc/contract";
import { z } from "zod";

// The liveness probe's shape, stated once. Better Stack polls it and Fly
// restarts on the answer, so the two facts it carries are the two a restart
// decision needs: the process answered, and it could still reach Postgres.
//
// `ok`/`up` are literals rather than strings because there is no third value a
// 200 may carry — a degraded database is a 503, not a 200 with a sadder word in
// it, and a literal is how the compiler holds anyone to that.
export const healthReport = z.object({
  status: z.literal("ok"),
  database: z.literal("up"),
});

export const health = oc
  .route({ method: "GET", path: "/health" })
  .output(healthReport);
