// Staff account administration — the `identity.staff-accounts` row of the RBAC
// matrix, which is the one capability `ADMIN` holds alone.
//
// It is here rather than in `modules/auth` because creating an account is not
// authenticating: `auth` decides whether a credential is good, `identity` owns
// who exists. The two would blur immediately if account creation lived beside
// sign-in, and the RBAC matrix separates them for the same reason.
//
// These two routes are also the first real users of `@RequiresCapability()`.
// Every route added from here on declares one, or stops answering.

import { Body, Controller, Get, Post } from "@nestjs/common";
import { z } from "zod";
import { RequiresCapability } from "../../common/auth/access.decorators.js";
import { ZodValidationPipe } from "../../common/validation/zod-validation.pipe.js";
import type { StaffUserRow } from "../../database/schema/identity.js";
import { staffRoleSchema } from "./rbac/roles.js";
import { StaffUserService } from "./staff-user.service.js";

// Twelve characters, matching the guest realm's floor. Applied where a password
// is *set* rather than where one is used — an administrator creating an account
// is the only place this rule can be enforced without locking out an account
// created before it existed.
const createStaffAccountSchema = z.object({
  email: z.email().max(320),
  fullName: z.string().trim().min(1).max(200),
  role: staffRoleSchema,
  password: z.string().min(12).max(128),
});

type CreateStaffAccountBody = z.infer<typeof createStaffAccountSchema>;

interface StaffAccountView {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly lastSignedInAt: string | null;
}

@Controller("identity/staff-accounts")
export class IdentityController {
  constructor(private readonly staffUsers: StaffUserService) {}

  @RequiresCapability("identity.staff-accounts")
  @Get()
  async list(): Promise<readonly StaffAccountView[]> {
    const accounts = await this.staffUsers.list();

    return accounts.map(view);
  }

  @RequiresCapability("identity.staff-accounts")
  @Post()
  async create(
    @Body(new ZodValidationPipe(createStaffAccountSchema))
    body: CreateStaffAccountBody,
  ): Promise<StaffAccountView> {
    return view(await this.staffUsers.create(body));
  }
}

/** The row minus its password hash. Written as a mapping rather than a delete,
 *  so a column added to the table is absent from responses until somebody
 *  decides it belongs there. */
function view(account: StaffUserRow): StaffAccountView {
  return {
    id: account.id,
    email: account.email,
    fullName: account.fullName,
    role: account.role,
    isActive: account.isActive,
    lastSignedInAt: account.lastSignedInAt?.toISOString() ?? null,
  };
}
