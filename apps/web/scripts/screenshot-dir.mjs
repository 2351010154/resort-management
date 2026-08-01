// The capture scripts ship with the app they photograph, but their output is a
// planning artifact, so it belongs to the repo-root plans/ tree rather than to
// apps/web. Resolving from this one file keeps the hop count out of six call
// sites that would otherwise all have to agree on how deep the app is nested.

import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** plans/reports/screenshots/<segments…>, absolute. */
export function screenshotDir(...segments) {
  return path.resolve(REPO_ROOT, "plans", "reports", "screenshots", ...segments);
}
