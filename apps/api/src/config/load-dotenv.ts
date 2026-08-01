/**
 * Loads `.env` from the working directory into `process.env`, if one exists.
 *
 * Node 24 reads dotenv files natively, so this is a two-line wrapper rather
 * than a dependency. A missing file is not an error: deployed environments get
 * their variables from `fly secrets`, and `.env` is git-ignored precisely so it
 * never reaches them.
 *
 * Values already present in the environment win — `process.loadEnvFile` does
 * not overwrite them — so `DATABASE_URL=… pnpm start` still works.
 */
export function loadDotenv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file. Deployed environments are configured, not filed.
  }
}
