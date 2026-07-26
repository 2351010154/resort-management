import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller.js";
import { PasswordHasher } from "./password-hasher.js";
import { StaffUserService } from "./staff-user.service.js";

// Staff, roles and the permission matrix. The matrix itself is data, not a
// provider — `rbac/matrix.ts` is imported directly by the guard that reads it,
// because a table of fifty-four constants gains nothing from dependency
// injection and loses the compile-time key checking that makes it safe.
@Module({
  controllers: [IdentityController],
  providers: [PasswordHasher, StaffUserService],
  exports: [PasswordHasher, StaffUserService],
})
export class IdentityModule {}
