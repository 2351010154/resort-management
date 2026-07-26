// The guest realm's tables — Better Auth's core schema, owned by
// `modules/auth/guest`.
//
// The exported constants are named `user`, `session`, `account` and
// `verification` because Better Auth's Drizzle adapter looks its models up by
// the **key** of the schema object it is handed. Renaming them here would not
// rename anything in Better Auth; it would simply stop the adapter finding the
// table. The SQL names carry the `guest_` prefix instead, so the realm is
// visible in every query plan, backup and psql session, and so the staff
// realm's tables can sit beside them without ambiguity.
//
// The barrel re-exports these under `guestUser`, `guestSession`, … which is how
// the rest of the API should refer to them. `index.ts` is where that happens.

import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// `lower()` is not a Drizzle builtin. Declared here rather than in a shared
// helpers file because it has exactly one caller; it graduates when it has two.
function lower(column: AnyPgColumn): SQL {
  return sql`lower(${column})`;
}

// Better Auth generates its own ids (a 32-character base-62 string) and sends
// them on insert, so these are `text` primary keys with no database default.
// Handing the column a `gen_random_uuid()` default would be a default that
// never fires and a type that never matches.
const id = text("id").primaryKey();

const createdAt = timestamp("created_at", { withTimezone: true, mode: "date" })
  .notNull()
  .defaultNow();

const updatedAt = timestamp("updated_at", { withTimezone: true, mode: "date" })
  .notNull()
  .defaultNow();

/** A guest account. One row per person who signs in on the public site. */
export const user = pgTable(
  "guest_user",
  {
    id,
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt,
    updatedAt,
  },
  (table) => [
    // Unique on the lowercased address, not on the address. Postgres compares
    // text case-sensitively, so a plain unique index lets Anh@ and anh@ both
    // register and turns "which account is this?" into a support ticket.
    // Better Auth lowercases before it writes; this makes that a database
    // guarantee rather than an application habit.
    uniqueIndex("guest_user_email_lower_key").on(lower(table.email)),
  ],
);

/** An active guest sign-in. Better Auth reads and rotates these itself. */
export const session = pgTable(
  "guest_session",
  {
    id,
    userId: text("user_id")
      .notNull()
      // A deleted guest takes their sessions with them: a session row whose
      // user is gone would authenticate nobody, and cleaning it up later is a
      // job nobody would remember to write.
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt,
    updatedAt,
  },
  (table) => [index("guest_session_user_id_idx").on(table.userId)],
);

/**
 * Credentials. One row per sign-in method: the email/password pair lands here
 * with `providerId = 'credential'` and the hash in `password`, and a social
 * provider would add a second row for the same user rather than a second user.
 */
export const account = pgTable(
  "guest_account",
  {
    id,
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("guest_account_user_id_idx").on(table.userId),
    uniqueIndex("guest_account_provider_key").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

/**
 * Short-lived tokens: email verification and password reset. Rows expire and
 * Better Auth deletes them on use — a verification row surviving its use is
 * the single-use property failing, which is why nothing else writes here.
 */
export const verification = pgTable(
  "guest_verification",
  {
    id,
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [index("guest_verification_identifier_idx").on(table.identifier)],
);
