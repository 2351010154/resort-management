// The bootstrap problem, solved once: creating a staff account requires the
// `identity.staff-accounts` capability, which only an `ADMIN` holds, and on a
// fresh database there is no `ADMIN` to hold it.
//
// So the first account is created here, from a shell with database access,
// rather than by a route that would have to be open for exactly one request in
// the system's life and then be a hole forever. Every account after the first
// can be created through `POST /identity/staff-accounts`.
//
//   pnpm --filter @mariva/api staff:create -- \
//     --email owner@mariva.vn --name "Trần Minh" --role ADMIN
//
// The password is read from stdin, never from an argument: an argument is in
// the shell history, in `ps`, and in whatever shipped the terminal's scrollback
// somewhere else.

import "reflect-metadata";

import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module.js";
import { loadDotenv } from "../../config/load-dotenv.js";
import { staffRoleSchema } from "./rbac/roles.js";
import { StaffUserService } from "./staff-user.service.js";

const MIN_PASSWORD_LENGTH = 12;

async function main(): Promise<void> {
  loadDotenv();

  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
    },
  });

  if (!values.email || !values.name || !values.role) {
    throw new Error(
      "Usage: staff:create -- --email <address> --name <full name> --role <ROLE>",
    );
  }

  const role = staffRoleSchema.parse(values.role);

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const password = await prompt.question(`Password for ${values.email}: `);
  prompt.close();

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  // An application context, not an HTTP server: this needs the container — the
  // env schema, the pool, the hasher — and nothing that listens on a port.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const staffUsers = app.get(StaffUserService);

    if (await staffUsers.findByEmail(values.email)) {
      throw new Error(`${values.email} already has an account`);
    }

    const created = await staffUsers.create({
      email: values.email,
      fullName: values.name,
      role,
      password,
    });

    process.stdout.write(`Created ${created.role} ${created.email} (${created.id})\n`);
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
