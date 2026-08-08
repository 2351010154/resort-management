import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { SystemConfigController } from "./system-config.controller.js";
import { SystemConfigSeeder } from "./system-config.seeder.js";
import { SystemConfigService } from "./system-config.service.js";

// The `system_config` row — the figures `property-and-tariff.md` §8 forbids the
// tree from knowing, as data (`FR-IDN-03`).
//
// Two providers with opposite lifetimes. The seeder runs once, at boot, and
// writes the row's first values from the environment. The service runs at every
// posting and reads them, through the caller's executor, without caching.
//
// The controller is the screen that edits them, governed by the guard
// `AuthModule` installs over the `system.config` row in `rbac-matrix.md` §3 —
// `ADMIN` writes, `MANAGER` reads. It is the only way into the write path from
// outside this module: the service is exported so a folio posting can read the
// rates, and nothing else anywhere has business changing them.
//
// `DatabaseModule` and `ConfigModule` are both global, so neither is imported
// for the Drizzle client, the `TransactionRunner` and the environment these
// providers inject.
//
// `AuditModule` is global as well, and is imported anyway. An edit here is the
// change in this application with the widest reach — it moves every future
// posting and the property's own day — and the row filed against it is the only
// attribution it gets, since `schema/config.ts` declined an `updated_by` column
// on the promise that the log would serve it. A dependency that consequential
// is stated where a reader looks for one rather than left to be inherited, and
// stating it is also what lets this module's graph resolve on its own: a spec
// that builds it in isolation to check the wiring would otherwise fail on a
// provider only a booted application supplies.
@Module({
  imports: [AuditModule],
  controllers: [SystemConfigController],
  providers: [SystemConfigService, SystemConfigSeeder],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
