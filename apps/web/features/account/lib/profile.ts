// The calls `/account` makes, and the two realms they land in.
//
// **The profile is oRPC and the credentials are Better Auth, and that split is
// the API's rather than this file's.** `contract/guest.ts` declares
// `GET /profile` and `PATCH /profile`, so those go through `@mariva/api-client`
// and are typed by the contract; the address and the password a guest signs in
// with are Better Auth's own `/change-email` and `/change-password`, mounted by
// `guest-auth.controller.ts`, and neither is ours to reimplement. A screen that
// treated them as one thing would be a screen that had decided where a route
// lives.
//
// Every call resolves rather than throws, in `sign-in.ts`'s and
// `booking-links.ts`'s shape: each outcome is something the screen has a
// sentence for, and the API's own sentence is preferred over anything invented
// here — the handler that refused knows why, and this side does not.
//
// The two credential calls go through `better-auth-call.ts`, which is where the
// skeleton every Better Auth caller shares now lives — the send, the network
// failure, the 429 and the failure name read out of the body. What is left below
// is the only part that is this screen's: which of those names has a sentence.

import {
  type AuthResult,
  callBetterAuth,
} from "@/features/auth/lib/better-auth-call";
import { MIN_PASSWORD_LENGTH, origin } from "@/features/auth/lib/guest-auth";
import { api, API_URL, apiMessage } from "@/lib/api";

/**
 * The guest's own record of themselves, inferred from the client rather than
 * written out.
 *
 * The same move `booking-links.ts` makes for a stay, and for its reason: the
 * contract in `@mariva/shared` types both ends, so a field that changes shape
 * breaks this screen in the pull request that changed it rather than in
 * whichever side was deployed second.
 */
export type Profile = Awaited<ReturnType<typeof api.guest.readProfile>>;

/** The four fields `updateProfileInput` accepts — absent leaves a field alone,
 *  `null` clears it. `profile-edits.ts` is what decides which is which. */
export type ProfileEdits = Parameters<typeof api.guest.updateProfile>[0];

export type ProfileOutcome =
  | { readonly ok: true; readonly profile: Profile }
  | { readonly ok: false; readonly message: string };

/** The shape both credential calls answer — `better-auth-call.ts`'s, because
 *  they are its calls and a second name for one type is how the two drift. */
export type CredentialOutcome = AuthResult;

// Copy per design-foundations §6 — plain and blameless, no apology theatre and
// no exclamation marks. The unreachable and throttled sentences are not here:
// they belong to every Better Auth caller alike and live beside the call.
const MESSAGES = {
  read: "Your details could not be read just now. Check your connection and try again.",
  save: "Your details could not be saved just now. Check your connection and try again.",
  signedOut: "Your session has ended. Log in again to make this change.",
  wrongPassword: "That is not the password on your account.",
  weakPassword: `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`,
  google:
    "This account signs in with Google, so Google keeps its address and password.",
  passwordRefused:
    "Your password could not be changed just now. Check the details and try again.",
  emailRefused:
    "That address could not be used. Try another, or check it for a typo.",
} as const;

/** The account's own record of itself, derived figures included. */
export async function readProfile(): Promise<ProfileOutcome> {
  try {
    return { ok: true, profile: await api.guest.readProfile() };
  } catch (error) {
    return { ok: false, message: apiMessage(error, MESSAGES.read) };
  }
}

/**
 * The fields a guest changed, and nothing else.
 *
 * What comes back is the profile as it now stands — the contract answers the
 * whole record rather than an acknowledgement, so a screen that saved a field
 * does not have to fetch the page again to render the tier and the points
 * beside it.
 */
export async function saveProfile(
  edits: ProfileEdits,
): Promise<ProfileOutcome> {
  try {
    return { ok: true, profile: await api.guest.updateProfile(edits) };
  } catch (error) {
    return { ok: false, message: apiMessage(error, MESSAGES.save) };
  }
}

/**
 * Whether this account has a password of its own.
 *
 * **It decides what to draw and never what is allowed.** A guest who only ever
 * pressed Google has no password to prove and no address of their own — Google
 * owns both — and `guest-auth.factory.ts` refuses them both routes at the API,
 * before either reaches an endpoint. So this is presentation: a form that would
 * be refused is not offered, and the refusal is still the API's if the request
 * is made anyway.
 *
 * `providerId` is Better Auth's own name for the credential row — the API reads
 * the same column to make the same decision — and `list-accounts` answers only
 * about the session's own account.
 *
 * A read that fails is answered `true`, which offers both forms to a guest whose
 * account may not want them. That is the safer way round: the API refuses what
 * it must, and hiding a control from somebody entitled to it leaves them with no
 * way to change their password at all.
 */
export async function hasPassword(): Promise<boolean> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}/api/auth/list-accounts`, {
      // The session is an httpOnly cookie the API set on its own origin.
      credentials: "include",
    });
  } catch {
    return true;
  }

  if (!response.ok) {
    return true;
  }

  try {
    const accounts = (await response.json()) as readonly {
      providerId?: unknown;
    }[];

    return (
      Array.isArray(accounts) &&
      accounts.some((account) => account.providerId === "credential")
    );
  } catch {
    return true;
  }
}

/**
 * A new password, with the current one proved.
 *
 * `currentPassword` is not optional and cannot be made so: without it, anyone
 * who reaches an unlocked browser takes the account outright instead of
 * borrowing it. The API also revokes every other session on success —
 * `guest-auth.factory.ts` sets that server-side precisely so no caller can
 * decline it — so a guest changing their password because somebody else has it
 * is not left signed in on that somebody else's device.
 */
export async function changePassword(passwords: {
  readonly currentPassword: string;
  readonly newPassword: string;
}): Promise<CredentialOutcome> {
  return post("/api/auth/change-password", passwords, MESSAGES.passwordRefused);
}

/**
 * The address the guest wants to sign in with next.
 *
 * **It does not change the identifier.** The API mints a link to the new address
 * and the account keeps answering to the old one until that link is followed —
 * which is the whole of the protection: naming an address must not be enough to
 * make it a credential, or an unlocked session is a way to lock somebody out of
 * their own account.
 *
 * `callbackURL` is where the API sends the guest once the link has proved the
 * address. Absolute and on this origin, for the reason `guest-auth.ts`'s
 * `origin` gives, and back to this screen because that is where the new address
 * will be shown.
 */
export async function changeEmail(
  newEmail: string,
): Promise<CredentialOutcome> {
  return post(
    "/api/auth/change-email",
    { newEmail, callbackURL: `${origin()}/account` },
    MESSAGES.emailRefused,
  );
}

/**
 * One credential call, and the four refusals this screen tells apart.
 *
 * A signed-out session is read off the status; the other three are names in the
 * body, because the status cannot separate them — a password that does not
 * match, one that is too short and an account that has no password at all all
 * arrive as 400, and they are three different things for the guest to do next.
 *
 * `refused` is the caller's own fallback, so a password that could not be
 * changed and an address that could not be used say so rather than sharing one
 * sentence about neither.
 */
async function post(
  path: string,
  body: Record<string, unknown>,
  refused: string,
): Promise<CredentialOutcome> {
  return callBetterAuth(path, body, ({ status, code }) => {
    if (status === 401) {
      return MESSAGES.signedOut;
    }

    if (code === "INVALID_PASSWORD") {
      return MESSAGES.wrongPassword;
    }

    if (code === "PASSWORD_TOO_SHORT") {
      return MESSAGES.weakPassword;
    }

    if (code === "CREDENTIAL_ACCOUNT_NOT_FOUND") {
      return MESSAGES.google;
    }

    return refused;
  });
}
