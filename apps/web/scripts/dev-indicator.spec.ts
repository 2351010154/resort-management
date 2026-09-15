import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

test("development screenshots do not include the Next.js tools badge", async () => {
  const config = await readFile(
    new URL("../next.config.mjs", import.meta.url),
    "utf8",
  );

  expect(config).toMatch(/\bdevIndicators:\s*false\b/);
});
