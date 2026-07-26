// The staff realm's tables, owned by `modules/identity`.
//
// Deliberately not Better Auth's. The two realms share a database and nothing
// else: a staff account is created by an administrator rather than by signing
// up, carries exactly one role, and authenticates with a bearer token the admin
// console sends — not a browser cookie. Modelling it as a second Better Auth
// instance would mean one library's session semantics governing both, which is
// the thing rbac-matrix.md §1 exists to prevent.

import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { STAFF_ROLES } from "../../modules/identity/rbac/roles.js";

function lower(column: AnyPgColumn): SQL {
  return sql`lower(${column})`;
}

/**
 * The five staff roles as a database type.
 *
 * Postgres rejects a role the matrix does not define, so a typo in a seed
 * script or an admin form fails at the write rather than at the guard, where it
 * would read as "this account can do nothing" and be diagnosed as a bug in
 * authorisation.
 */
export const staffRoleEnum = pgEnum("staff_role", STAFF_ROLES);

export const staffUser = pgTable(
  "staff_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    role: staffRoleEnum("role").notNull(),
    // Argon2id, produced by `PasswordHasher`. Never null: an account with no
    // password is an account that cannot be signed into, and representing that
    // as `is_active = false` keeps one meaning per column.
    passwordHash: text("password_hash").notNull(),
    // Deactivation, not deletion. A receptionist who leaves still authored
    // every folio posting they made, and a deleted row would orphan the audit
    // trail that makes those postings attributable.
    isActive: boolean("is_active").notNull().default(true),
    lastSignedInAt: timestamp("last_signed_in_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("staff_user_email_lower_key").on(lower(table.email))],
);

/**
 * One row per issued refresh token.
 *
 * The access token is a JWT and is deliberately not stored — it is verified by
 * signature and expires in minutes. The refresh token is the long-lived half,
 * so it is stored as a SHA-256 digest and rotated on every use: a database that
 * leaks cannot be replayed against the API, and a stolen token stops working
 * the moment the real client refreshes.
 */
export const staffSession = pgTable(
  "staff_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => staffUser.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    // Set on rotation as well as on sign-out, so a replayed token is
    // distinguishable from an unused one — the difference between a client
    // that is behind and a token that was stolen.
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("staff_session_staff_user_id_idx").on(table.staffUserId)],
);

export type StaffUserRow = typeof staffUser.$inferSelect;
export type StaffSessionRow = typeof staffSession.$inferSelect;
