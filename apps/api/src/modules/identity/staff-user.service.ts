// Staff accounts: the reads and writes every other module goes through.
//
// `identity` owns staff, roles and the permission matrix
// (docs/architecture/repository-structure.md §"Domain modules"), so this is the
// only place that touches `staff_user`. Authentication is deliberately not
// here — that is `modules/auth/staff`, which asks this service for an account
// and decides on its own what a failed password means.
//
// **The two writes below open a transaction for a row each, and that is not
// ceremony.** `staff_user` is audited by the database, and the trigger reads the
// acting member of staff from a setting that only exists inside a transaction
// `TransactionRunner` opened — `transaction-runner.ts` says why it cannot be
// established any other way. Run against the pool directly, a statement is its
// own implicit transaction with no such setting, so an administrator opening an
// account for a new receptionist would be filed as the property's own machinery
// having done it. A missing entry is a gap; an entry naming the wrong actor is
// an accusation, and the second is what this arrangement avoids. The reads stay
// on the client, because nothing fires on a read.

import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { staffUser, type StaffUserRow } from "../../database/schema/identity.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { PasswordHasher } from "./password-hasher.js";
import type { StaffRole } from "./rbac/roles.js";

export interface CreateStaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

@Injectable()
export class StaffUserService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly hasher: PasswordHasher,
    private readonly transactions: TransactionRunner,
  ) {}

  /**
   * Looks an account up by address, case-insensitively.
   *
   * `lower(email)` matches the unique index the migration creates, so this is
   * an index scan rather than a sequential one — and, more to the point, it
   * cannot disagree with the constraint that decides whether two addresses are
   * the same address.
   */
  async findByEmail(email: string): Promise<StaffUserRow | undefined> {
    const [row] = await this.db
      .select()
      .from(staffUser)
      .where(sql`lower(${staffUser.email}) = lower(${email})`)
      .limit(1);

    return row;
  }

  /** Looks an active account up by id. Inactive accounts resolve to
   *  `undefined` so a deactivated staff member's live token stops working at
   *  the next request rather than at its expiry. */
  async findActiveById(id: string): Promise<StaffUserRow | undefined> {
    const [row] = await this.db
      .select()
      .from(staffUser)
      .where(and(eq(staffUser.id, id), eq(staffUser.isActive, true)))
      .limit(1);

    return row;
  }

  /**
   * Creates an account. There is no self-service path to this: staff accounts
   * are made by an administrator holding `identity.staff-accounts`, which is
   * the one capability the RBAC matrix gives to `ADMIN` alone.
   */
  async create(account: CreateStaffAccount): Promise<StaffUserRow> {
    const passwordHash = await this.hasher.hash(account.password);

    const [row] = await this.transactions.run((exec) =>
      exec
        .insert(staffUser)
        .values({
          email: account.email.toLowerCase(),
          fullName: account.fullName,
          role: account.role,
          passwordHash,
        })
        .returning(),
    );

    return row!;
  }

  /** Every account, active or not, oldest first. Deactivated accounts are in
   *  the list because an administrator's first question about one is usually
   *  whether it still exists. */
  async list(): Promise<readonly StaffUserRow[]> {
    return this.db.select().from(staffUser).orderBy(staffUser.createdAt);
  }

  /**
   * Stamps the account with the moment it was signed into.
   *
   * Filed against nobody, and correctly so: this runs as part of the sign-in
   * itself, before any guard has resolved a principal, so there is no acting
   * member of staff for the entry to name. What the log then holds is the
   * property's own record that the account was used, which is the fact.
   */
  async recordSignIn(id: string): Promise<void> {
    await this.transactions.run((exec) =>
      exec
        .update(staffUser)
        .set({ lastSignedInAt: new Date() })
        .where(eq(staffUser.id, id)),
    );
  }
}
