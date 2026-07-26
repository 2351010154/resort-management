import { Global, Module } from "@nestjs/common";
import { ENV, parseEnv } from "./env.js";

// Global because configuration is genuinely ambient: every module that needs a
// value needs it for the same reason, and threading an import through fourteen
// domain modules would express nothing the token does not.
//
// The factory runs during module initialisation, so a missing or malformed
// variable throws before a single route is mapped. main.ts turns that into a
// clean exit — P0-API-04.
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => parseEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
