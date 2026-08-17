// `FR-INV-05`'s one command:
//
//   pnpm --filter @mariva/api db:seed
//
// It opens the calendar from the first of the current month in the property's
// zone. `--from 2027-01-01` pins that instead, which is what the test suite
// uses: a fixture that moves with the wall clock cannot assert a price on a
// named night.
//
// The flags may be written with or without a `--` in front of them. pnpm
// forwards the separator into argv rather than consuming it, and
// `common/cli/script-args.ts` takes it back out — that file says why the
// alternative fix would have pinned the calendar to nothing, quietly.
//
// It refuses to run against `NODE_ENV=production`, and the refusal is not
// politeness. The seed empties the property, the calendar and every stay
// standing against them before it writes; a demo command that can do that to a
// live hotel is a command somebody will eventually run in the wrong terminal.

import "reflect-metadata";

import { parseArgs } from "node:util";
import { parseDate } from "@internationalized/date";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module.js";
import { scriptArgs } from "../../common/cli/script-args.js";
import { ENV, type Env } from "../../config/env.js";
import { loadDotenv } from "../../config/load-dotenv.js";
import { type Database, DRIZZLE } from "../database.module.js";
import { seedDatabase } from "./seed.js";

async function main(): Promise<void> {
  loadDotenv();

  const { values } = parseArgs({
    args: scriptArgs(),
    options: {
      from: { type: "string" },
      bookings: { type: "string" },
    },
  });

  // An application context and not an HTTP server: this needs the env schema
  // and the pool, and nothing that listens on a port.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    if (app.get<Env>(ENV).NODE_ENV === "production") {
      throw new Error(
        "Refusing to seed a production database — this command deletes the property and every stay against it",
      );
    }

    const summary = await seedDatabase(app.get<Database>(DRIZZLE), {
      from: values.from ? parseDate(values.from) : undefined,
      bookings: values.bookings ? Number(values.bookings) : undefined,
    });

    process.stdout.write(
      [
        `${summary.roomTypes} room types, ${summary.rooms} rooms`,
        `${summary.nightsOpened} nights opened — ${summary.firstNight} to ${summary.lastNight}`,
        `${summary.ratesWritten} rates, ${summary.restrictions} restrictions`,
        `${summary.serviceItems} service items`,
        `${summary.bookings} synthetic stays`,
        "",
      ].join("\n"),
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
