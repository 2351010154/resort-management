// The smallest read the guest navigation needs: whether the browser holds a
// session, and whose name should replace "Sign in" when it does.
//
// Better Auth owns this endpoint and its cookie. The navigation does not read
// `/profile` for the answer because a profile is a larger guest-owned record;
// the session already carries the two identity fields the disclosure needs.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const SESSION_PATH = "/api/auth/get-session";

export interface GuestIdentity {
  readonly name: string;
  readonly email: string;
}

/**
 * Reads the current guest without turning a missing or unreachable session
 * into an error on every public booking screen.
 *
 * A malformed success is treated as signed out. Navigation is presentation,
 * never authority; the API still protects `/profile`, `/stays` and sign-out.
 */
export async function readGuestSession(): Promise<GuestIdentity | null> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${SESSION_PATH}`, {
      credentials: "include",
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  try {
    const body: unknown = await response.json();

    if (!isGuestSession(body)) {
      return null;
    }

    return {
      name: body.user.name.trim(),
      email: body.user.email.trim(),
    };
  } catch {
    return null;
  }
}

function isGuestSession(value: unknown): value is {
  readonly session: Record<string, unknown>;
  readonly user: { readonly name: string; readonly email: string };
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const { session, user } = value as {
    readonly session?: unknown;
    readonly user?: unknown;
  };

  if (
    typeof session !== "object" ||
    session === null ||
    typeof user !== "object" ||
    user === null
  ) {
    return false;
  }

  const identity = user as {
    readonly name?: unknown;
    readonly email?: unknown;
  };

  return (
    typeof identity.name === "string" &&
    identity.name.trim() !== "" &&
    typeof identity.email === "string" &&
    identity.email.trim() !== ""
  );
}
