// Brings up the local Postgres container before `pnpm dev` fans out.
// The API asserts migrations against the database at boot and exits when it
// cannot connect, so without this a stopped container leaves web and admin
// running against a dead API ("Failed to fetch") instead of failing loudly.
import { execFileSync } from "node:child_process";

const CONTAINER = "mariva-pg";
const READY_TIMEOUT_MS = 30_000;

function docker(args, options = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  }).trim();
}

function containerState() {
  try {
    return docker(["inspect", "--format", "{{.State.Running}}", CONTAINER]);
  } catch {
    return "missing";
  }
}

try {
  docker(["version", "--format", "{{.Server.Version}}"]);
} catch {
  console.error(
    "Docker is not running. Start Docker Desktop, then run `pnpm dev` again.",
  );
  process.exit(1);
}

const state = containerState();
if (state === "missing") {
  // Same container the README's Database section creates.
  console.log(`Creating ${CONTAINER} (postgres:17 on 5432)…`);
  docker([
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-p",
    "5432:5432",
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-e",
    "POSTGRES_DB=mariva_dev",
    "postgres:17",
  ]);
  console.log(
    "New database: run `pnpm --filter @mariva/api db:migrate` once it is up.",
  );
} else if (state !== "true") {
  console.log(`Starting ${CONTAINER}…`);
  docker(["start", CONTAINER]);
}

// A started container accepts connections a moment later; wait so the API's
// boot-time migration check does not race it.
const deadline = Date.now() + READY_TIMEOUT_MS;
for (;;) {
  try {
    docker(["exec", CONTAINER, "pg_isready", "-U", "postgres", "-q"]);
    break;
  } catch {
    if (Date.now() > deadline) {
      console.error(
        `${CONTAINER} did not accept connections within ${READY_TIMEOUT_MS / 1000}s.`,
      );
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
console.log(`${CONTAINER} is ready.`);
