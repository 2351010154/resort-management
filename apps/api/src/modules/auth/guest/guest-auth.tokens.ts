// The DI token for the Better Auth instance, in its own file so the guard, the
// controller and the module can all reach it without any of them importing the
// factory — importing the factory would drag Better Auth's whole configuration
// into a file that only needs the type.

import type { GuestAuth } from "./guest-auth.factory.js";

export const GUEST_AUTH = Symbol("GUEST_AUTH");

export type { GuestAuth };
