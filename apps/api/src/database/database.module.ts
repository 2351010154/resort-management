import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { InjectPinoLogger, type PinoLogger } from "nestjs-pino";
// `pg` is CommonJS, and this package is ESM. The default import is the whole
// module object; destructuring `Pool` off a named import is what breaks under
// `nodenext` — README §"This package is ESM".
import pg from "pg";
import { ENV, type Env } from "../config/env.js";
import * as schema from "./schema/index.js";

/** DI token for the one `pg` pool in the process. */
export const PG_POOL = Symbol("PG_POOL");

/** DI token for the Drizzle client bound to that pool. */
export const DRIZZLE = Symbol("DRIZZLE");

export type Database = NodePgDatabase<typeof schema>;

// Ten is sized for Fly's single always-on instance against Neon, not for
// throughput: Neon caps connections per compute, and pg-boss will take its
// workers from this same pool at P3-JOB.
const MAX_CONNECTIONS = 10;

// A query that has not returned in five seconds has failed as far as a caller
// is concerned. Set on the pool so /health cannot hang holding a request open —
// a health check that never answers reads as "up" to a probe that gave up.
const STATEMENT_TIMEOUT_MS = 5_000;
const CONNECTION_TIMEOUT_MS = 5_000;

// One pool, exported, shared — `R2#13`. Two pools means two connection limits,
// two failure modes, and a pg-boss job that cannot join the transaction that
// enqueued it, which is the entire reason the queue lives in Postgres.
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        new pg.Pool({
          connectionString: env.DATABASE_URL,
          max: MAX_CONNECTIONS,
          statement_timeout: STATEMENT_TIMEOUT_MS,
          connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
        }),
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool): Database =>
        drizzle({ client: pool, schema }),
    },
  ],
  exports: [PG_POOL, DRIZZLE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    // The literal is not `DatabaseModule.name`: the decorator above is
    // evaluated while the class is still being defined.
    @InjectPinoLogger("DatabaseModule") private readonly logger: PinoLogger,
  ) {
    // An error on an idle client is emitted on the pool, and an unhandled
    // 'error' event on an EventEmitter takes the process down. Neon closes idle
    // connections; that must be a log line, not a restart.
    this.pool.on("error", (error) => {
      this.logger.error({ err: error }, "idle database client errored");
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
