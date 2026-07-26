// Staff password hashing.
//
// Argon2id, at the OWASP second-recommended parameter set (19 MiB, t=2, p=1).
// Not bcrypt: bcrypt silently truncates at 72 bytes and has no memory cost, so
// a GPU attacks it at a rate memory-hardness is specifically designed to
// prevent. Not the guest realm's hasher either — Better Auth owns that one, and
// borrowing it would couple staff sign-in to a library the staff realm
// otherwise does not use.
//
// `@node-rs/argon2` is the Rust binding: prebuilt for every platform this
// repository targets, so `pnpm install` needs no toolchain on Windows.

import { hash, verify } from "@node-rs/argon2";
import { Injectable } from "@nestjs/common";

// OWASP Password Storage Cheat Sheet, argon2id row two. Written out rather than
// left to the library's defaults so a version bump that changes them is a
// deliberate edit here, not a silent change in how every password is stored.
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  /**
   * Constant-time in the library; the surrounding flow must be too. A caller
   * that skips this call when the account does not exist leaks which addresses
   * are registered through response timing — see `StaffAuthService`, which
   * verifies against a dummy hash instead.
   */
  async verify(digest: string, password: string): Promise<boolean> {
    try {
      return await verify(digest, password, ARGON2_OPTIONS);
    } catch {
      // A malformed or foreign-format digest is a failed verification, not a
      // 500. It means the stored value is not one of ours, and the answer to
      // "does this password match it" is still no.
      return false;
    }
  }
}
