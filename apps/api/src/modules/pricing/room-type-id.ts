// A room type code, as the tables that hang off it need it.
//
// `rate_calendar` and `stay_restriction` both key on `room_type_id`, and every
// route in this module names the type by its code instead — the code is what
// `property-and-tariff.md` §1 calls it and what the wire carries. One lookup,
// in one place, so the two services do not answer "no such type" differently.
//
// It takes the caller's executor rather than the client, so the lookup happens
// inside whatever transaction the write it precedes is running in. Read on one
// connection and written on another, a type deleted in between would be a
// foreign key violation raised a long way from the query that permitted it.
//
// The 404 is close to unreachable and is here anyway. `room_type_code` is a
// Postgres enum, so a code the property has not defined is refused by the wire
// schema long before this runs; what is left is a database migrated and not
// seeded, which is exactly the case where a silent zero-row write would be the
// worst answer.

import type { RoomTypeCode } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { roomType } from "../../database/schema/inventory.js";

export async function roomTypeIdFor(
  exec: DbExecutor,
  code: RoomTypeCode,
): Promise<string> {
  const [found] = await exec
    .select({ id: roomType.id })
    .from(roomType)
    .where(eq(roomType.code, code))
    .limit(1);

  if (!found) {
    throw new ORPCError("NOT_FOUND", {
      message: `The property has no ${code} rooms`,
    });
  }

  return found.id;
}
