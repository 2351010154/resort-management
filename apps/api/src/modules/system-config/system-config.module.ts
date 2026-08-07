import { Module } from "@nestjs/common";
import { SystemConfigSeeder } from "./system-config.seeder.js";
import { SystemConfigService } from "./system-config.service.js";

// The `system_config` row — the figures `property-and-tariff.md` §8 forbids the
// tree from knowing, as data (`FR-IDN-03`).
//
// Two providers with opposite lifetimes. The seeder runs once, at boot, and
// writes the row's first values from the environment. The service runs at every
// posting and reads them, through the caller's executor, without caching.
//
// The service is exported and the seeder is not: a folio posting is the whole
// audience for these rows, and nothing outside this module has any business
// writing them. The `ADMIN` screen that edits them arrives as a controller here,
// governed by the guard `AuthModule` installs, over the `system.config` row in
// `rbac-matrix.md` §3 — `ADMIN` writes, `MANAGER` reads.
//
// `DatabaseModule` and `ConfigModule` are both global, so neither is imported
// for the Drizzle client and the environment these providers inject.
@Module({
  providers: [SystemConfigService, SystemConfigSeeder],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
