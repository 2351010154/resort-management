// Two realms, one module. They share nothing but this file: no table, no
// secret, no session type, no token format — docs/architecture/rbac-matrix.md
// §1. What they do share is the guard, which is why it is registered here.
//
// The booking-scoped token is a third credential and not a third realm in that
// sense: it is a guest-realm credential that names one stay rather than an
// account, it opens exactly two rows, and it cannot become a session. It lives
// in its own module so that the booking module can issue it without importing
// everything here.

import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import {
  AccessGuard,
  StaffJwtGuard,
} from "../../common/auth/access.guard.js";
import { ENV, type Env } from "../../config/env.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { MailerService } from "../notification/mailer.service.js";
import { NotificationModule } from "../notification/notification.module.js";
import { BookingTokenModule } from "./booking-token/booking-token.module.js";
import { createGuestAuth } from "./guest/guest-auth.factory.js";
import { GuestAuthController } from "./guest/guest-auth.controller.js";
import { GuestAuthService } from "./guest/guest-auth.service.js";
import { GUEST_AUTH } from "./guest/guest-auth.tokens.js";
import { StaffAuthController } from "./staff/staff-auth.controller.js";
import { StaffAuthService } from "./staff/staff-auth.service.js";
import { StaffJwtStrategy } from "./staff/staff-jwt.strategy.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  StaffTokenService,
} from "./staff/staff-token.service.js";

@Module({
  imports: [
    // The third credential the guard resolves — a booking-scoped token, which
    // is neither realm's session and belongs to neither realm's folder.
    BookingTokenModule,
    IdentityModule,
    NotificationModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.STAFF_JWT_SECRET,
        signOptions: {
          algorithm: "HS256",
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        },
      }),
    }),
  ],
  controllers: [GuestAuthController, StaffAuthController],
  providers: [
    {
      provide: GUEST_AUTH,
      inject: [DRIZZLE, ENV, MailerService],
      useFactory: (db: Database, env: Env, mailer: MailerService) =>
        createGuestAuth({ db, env, mailer }),
    },
    GuestAuthService,
    StaffAuthService,
    StaffTokenService,
    StaffJwtStrategy,
    StaffJwtGuard,

    // Global, and registered from the module that owns the two realms it
    // arbitrates between. Applying it per-controller would mean every future
    // controller is unprotected until someone remembers to add it, which is the
    // opposite of deny by default.
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [GUEST_AUTH, GuestAuthService, StaffAuthService, StaffTokenService],
})
export class AuthModule {}
