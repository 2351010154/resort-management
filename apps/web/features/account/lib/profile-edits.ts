// What a filled-in form means as a `PATCH` body.
//
// `updateProfileInput` in `contract/guest.ts` is strict and three-valued:
// **absent leaves a field alone, `null` clears it**, and a key the schema does
// not know is a `400` rather than a field quietly dropped. A form is
// two-valued — every box holds a string, and an empty box is a string too — so
// something has to make the crossing, and this is it.
//
// It is a function over values rather than a branch inside the form, because
// the distinction it draws is the one this screen can most easily get wrong: a
// screen that sent every box on every save would clear a birthday nobody
// touched the moment a browser declined to prefill it, and a screen that never
// sent `null` would leave a guest unable to remove a phone number they no
// longer hold.
//
// Trimmed before comparison because the API trims too — `.trim().min(1)` on all
// four fields — so a name given a trailing space is not a change, and would
// otherwise be sent on every save.

/** The four boxes on the form, as the DOM holds them. */
export interface ProfileFields {
  readonly fullName: string;
  readonly phone: string;
  readonly dateOfBirth: string;
  readonly nationality: string;
}

/** The same four as the profile carries them: text, or nothing on file. */
export interface ProfileValues {
  readonly fullName: string;
  readonly phone: string | null;
  readonly dateOfBirth: string | null;
  readonly nationality: string | null;
}

/** A `PATCH` body: only what changed, and `null` for what was emptied. */
export type ProfileEdit = {
  readonly [K in keyof ProfileFields]?: string | null;
};

const FIELDS = [
  "fullName",
  "phone",
  "dateOfBirth",
  "nationality",
] as const satisfies readonly (keyof ProfileFields)[];

/**
 * The changes between the profile as it stands and the form as it was left.
 *
 * An empty result means nothing was edited, and the caller is expected to say so
 * rather than send it: a `PATCH` carrying no field is a round trip that writes
 * nothing and reports success, which reads to a guest as a save that happened.
 *
 * Clearing `fullName` is allowed and is not the same as clearing the others —
 * `schema/guest-profile.ts` has the account fall back to the name it was
 * registered under — so the empty box is sent as `null` here exactly as it is
 * for a phone number, and what that means is the API's to decide.
 */
export function profileEdits(
  current: ProfileValues,
  form: ProfileFields,
): ProfileEdit {
  // The writable twin of {@link ProfileEdit}: the same four optional keys with
  // the `readonly` taken off, so this can be filled a field at a time and handed
  // back as the immutable shape a caller sends.
  const edit: { -readonly [K in keyof ProfileEdit]: ProfileEdit[K] } = {};

  for (const field of FIELDS) {
    const typed = form[field].trim();
    const next = typed === "" ? null : typed;

    if (next !== (current[field] ?? null)) {
      edit[field] = next;
    }
  }

  return edit;
}

/** Whether there is anything to send. */
export function hasEdits(edit: ProfileEdit): boolean {
  return Object.keys(edit).length > 0;
}
