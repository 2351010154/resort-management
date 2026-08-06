// The guest record as routes — `FR-GST-03`, which is two endpoints and cannot
// be one.
//
// **Masked is not a mode.** {@link guest.readRecord} answers with
// {@link guestRecordSchema}, and that shape has no field a plain CCCD could
// travel in. There is no `unmasked` flag, no `?reveal=true`, and nothing a
// caller can send to widen the answer — the second route is the only way the
// number leaves, and it is governed by its own matrix row. A flag would put the
// audited path and the ordinary one behind one declaration, and
// `rbac-matrix.md` §2 refuses exactly that shape for cancellation waivers on
// the same grounds: authority belongs to the route, where it can be seen from
// the routing table, and not to a field inside a body.
//
// **The reveal is a POST because it writes.** Reading a number is an event the
// property keeps a record of — `guest.service.ts` writes one audit row in the
// same transaction — so it is not a GET, whatever it looks like from the desk.
// A collection path says the same thing: revealing is per visit, so two
// readings are two entries and never one entry read twice.
//
// **`reason` is optional and stays optional.** `schema/guest.ts` argues it:
// requiring one produces a column full of "check in", and the attribution — who
// looked, and when — is what makes the reading accountable.
//
// What is deliberately NOT here: creating or editing a guest. A guest is
// created inside the check-in transition, in that transition's transaction
// (`contract/booking.ts`'s `checkInGuestSchema`), and correcting a record is
// `FR-GST-01`'s profile screen at `M7`.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { isoStayDateSchema } from "../stay-date.js";

/** The person every route below acts on. */
const guestIdFields = { guestId: z.uuid() };

/**
 * A guest as `guest.read-record` is allowed to see them — `GuestRecord`, on the
 * wire.
 *
 * `cccdMasked` is the whole of this file's confidentiality claim as a type: the
 * only CCCD field here is the masked one, so a handler cannot leak the number
 * through this schema by forgetting something. It is nullable because a guest
 * with no number on file and a guest whose number is withheld are different
 * facts, and `cccd-mask.ts` keeps them tellable apart.
 *
 * The birthday is ISO text, per `stay-date.ts`: a response carries the encoded
 * form and the controller performs the crossing. The two timestamps are
 * instants and take the full ISO-8601 form beside it.
 */
export const guestRecordSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  cccdMasked: z.string().nullable(),
  dateOfBirth: isoStayDateSchema.nullable(),
  nationality: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/**
 * One decision to look at one number.
 *
 * Bounded rather than free text of any length: the reason is typed at a desk
 * and read back in an investigation, and a column that can absorb a pasted
 * document is a column nobody reads.
 */
export const unmaskCccdInput = z.object({
  ...guestIdFields,
  reason: z.string().trim().max(200).nullish(),
});

/**
 * What was revealed, to whom, and when.
 *
 * `unmaskedBy` and `unmaskedAt` travel back because they are the audit row the
 * call just wrote — the caller is shown the record that was made of them,
 * rather than being asked to trust that one was.
 */
export const cccdRevealSchema = z.object({
  ...guestIdFields,
  cccdNumber: z.string(),
  unmaskedBy: z.uuid(),
  unmaskedAt: z.iso.datetime(),
});

export const guest = {
  readRecord: oc
    .route({ method: "GET", path: "/guests/{guestId}" })
    .input(z.object(guestIdFields))
    .output(guestRecordSchema),

  unmaskCccd: oc
    // POST to a collection of readings, and not a GET on the number: the call
    // appends an entry to `cccd_unmask_audit`, and `FR-GST-03` counts those per
    // call. A GET would invite a cache, a retry and a prefetch to each file a
    // reading nobody performed.
    .route({ method: "POST", path: "/guests/{guestId}/cccd-reveals" })
    .input(unmaskCccdInput)
    .output(cccdRevealSchema),
};
