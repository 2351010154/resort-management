// Fails the build if the guest booking funnel ships the arrival's animation
// stack. Runs after `next build`, over the real client chunks Next just wrote.
//
// **The invariant.** `app/layout.tsx` says it in prose: nothing that pulls
// three / gsap / lenis belongs on a surface every route mounts, because a
// provider at the root is in the tree of the funnel too and would drag the
// whole WebGL bundle in behind it. The arrival's scroll machinery lives under
// `app/(marketing)/`, and the funnel under `app/(booking)/` must stay clear of
// it. That is a promise about build output, so it is checked against build
// output rather than against imports — a re-export, a barrel, or a shared
// component that grows a `gsap` dependency two levels down all show up here and
// none of them show up in a grep over the funnel's own source.
//
// Run directly by Node, which strips the types. The file is written in
// CommonJS because `apps/web/package.json` declares no `"type"`: with `import`
// syntax Node has to parse the file twice and warns about it on every build.
//
//   node scripts/check-bundle-budget.ts

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

// The markers and the pure decision they drive live next door so a spec can
// exercise them without a build; see `banned-animation-markers.ts`. That module
// carries ESM exports because vitest imports it, and `require` of an ES module
// is synchronous on the Node this repository pins — it has no top-level await,
// so there is nothing there to refuse.
const { BANNED_PACKAGES, matchBannedPackages } =
  require("./banned-animation-markers.ts") as typeof import("./banned-animation-markers.ts");

const appDir = path.join(__dirname, "..");
const nextDir = path.join(appDir, ".next");

// The route group whose chunks carry the budget. Everything Next writes under
// this group is in scope, so a route added to the funnel tomorrow is covered
// without touching this file.
const FUNNEL_GROUP = "(booking)";

type RouteBundleStat = { route: string; firstLoadChunkPaths: string[] };

function fail(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

function readJson<T>(file: string, what: string): T {
  if (!fs.existsSync(file)) {
    fail(
      `Bundle budget: ${what} is missing at ${path.relative(appDir, file)}.\n` +
        "This check reads the output of `next build` and cannot run on its own.",
    );
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (error) {
    fail(
      `Bundle budget: ${what} at ${path.relative(appDir, file)} is not readable JSON.\n` +
        `${(error as Error).message}`,
    );
  }
}

/**
 * `/(booking)/booking/[hold]/details/page` -> `/booking/[hold]/details`.
 *
 * Route groups are a source-tree device and never appear in a URL, which is
 * also how `route-bundle-stats.json` names its routes — so dropping them is
 * what makes the two manifests joinable.
 */
function toPublicRoute(appPath: string): string {
  const withoutGroups = appPath.replace(/\/\([^)]*\)/g, "");
  const withoutPage = withoutGroups.replace(/\/page$/, "");
  return withoutPage === "" ? "/" : withoutPage;
}

/**
 * Every client chunk a browser fetches for one route.
 *
 * Two manifests, because they answer different halves of the question.
 * `route-bundle-stats.json` is Next's own first-load accounting — the shared
 * framework chunks plus the route's own — and is the set the arrival's bundle
 * would arrive in if it leaked through a shared module. The route's client
 * reference manifest lists the client modules its server graph points at, with
 * the chunks each one needs, which is where a `next/dynamic` boundary would
 * appear even though nothing about it is first-load. Neither one alone is the
 * whole surface a guest can be served.
 */
function chunksForRoute(
  appPath: string,
  stats: RouteBundleStat[],
): Set<string> {
  const chunks = new Set<string>();

  const publicRoute = toPublicRoute(appPath);
  const stat = stats.find((entry) => entry.route === publicRoute);
  for (const chunkPath of stat?.firstLoadChunkPaths ?? []) {
    // The manifest writes these with the host separator, so split on both.
    chunks.add(path.resolve(appDir, ...chunkPath.split(/[\\/]/)));
  }

  const manifestFile = `${path.join(nextDir, "server", "app", ...appPath.split("/").filter(Boolean))}_client-reference-manifest.js`;
  if (fs.existsSync(manifestFile)) {
    const source = fs.readFileSync(manifestFile, "utf8");
    for (const match of source.matchAll(/static\/chunks\/[\w-]+\.js/g)) {
      chunks.add(path.resolve(nextDir, ...match[0].split("/")));
    }
  }

  return chunks;
}

/**
 * Proves the markers above still describe the packages that are installed.
 *
 * Without this, a package that renames its internals turns the whole check into
 * a green light that means nothing — the worst outcome available here, worse
 * than a false alarm, because nobody investigates a pass. Each package is asked
 * whether its own distributed entry point still matches at least one marker.
 */
function verifyMarkersStillMatchInstalledPackages(): void {
  for (const banned of BANNED_PACKAGES) {
    let entry: string;
    try {
      entry = require.resolve(banned.name, { paths: [appDir] });
    } catch (error) {
      fail(
        `Bundle budget: cannot resolve \`${banned.name}\` from ${appDir}.\n` +
          "The check identifies this package by markers taken from its own source and\n" +
          "cannot confirm those markers without it installed.\n" +
          `${(error as Error).message}`,
      );
    }

    const source = fs.readFileSync(entry, "utf8");
    const matched = matchBannedPackages(source).some(
      (hit) => hit.name === banned.name,
    );
    if (!matched) {
      fail(
        `Bundle budget: no marker for \`${banned.name}\` matches its installed source at\n` +
          `  ${entry}\n` +
          "The package changed shape, so this check can no longer recognise it and would\n" +
          "pass a bundle that contains it. Update the markers in this file before relying\n" +
          "on a green build.",
      );
    }
  }
}

function main(): void {
  verifyMarkersStillMatchInstalledPackages();

  const appPaths = readJson<Record<string, string>>(
    path.join(nextDir, "server", "app-paths-manifest.json"),
    "the app paths manifest",
  );
  const stats = readJson<RouteBundleStat[]>(
    path.join(nextDir, "diagnostics", "route-bundle-stats.json"),
    "the route bundle stats",
  );

  const funnelRoutes = Object.keys(appPaths).filter((appPath) =>
    appPath.startsWith(`/${FUNNEL_GROUP}/`),
  );
  if (funnelRoutes.length === 0) {
    fail(
      `Bundle budget: no built route lives under the \`${FUNNEL_GROUP}\` group.\n` +
        "Either the funnel moved or the group was renamed. Until this file names the\n" +
        "group the funnel actually uses, the check guards nothing.",
    );
  }

  // Chunk -> the funnel routes that load it, so a violation in a shared chunk
  // reports every route it reaches rather than an arbitrary one.
  const routesByChunk = new Map<string, string[]>();
  for (const appPath of funnelRoutes) {
    const chunks = chunksForRoute(appPath, stats);
    if (chunks.size === 0) {
      fail(
        `Bundle budget: found no client chunks for \`${appPath}\`.\n` +
          "A funnel route with no chunks is not a route under budget, it is a route this\n" +
          "check failed to read. Neither the route bundle stats nor the client reference\n" +
          "manifest named a chunk for it.",
      );
    }
    for (const chunk of chunks) {
      // CSS carries none of these packages, and their vocabulary — easing
      // names, transform properties — is exactly what a stylesheet is full of.
      if (!chunk.endsWith(".js")) continue;
      const routes = routesByChunk.get(chunk);
      if (routes) routes.push(toPublicRoute(appPath));
      else routesByChunk.set(chunk, [toPublicRoute(appPath)]);
    }
  }

  const violations: string[] = [];
  for (const [chunk, routes] of routesByChunk) {
    if (!fs.existsSync(chunk)) {
      fail(
        `Bundle budget: ${path.relative(appDir, chunk)} is named by a manifest but is not\n` +
          "on disk. The build output is inconsistent; rebuild before trusting this check.",
      );
    }
    const source = fs.readFileSync(chunk, "utf8");
    for (const hit of matchBannedPackages(source)) {
      violations.push(
        `  ${path.relative(appDir, chunk)}\n` +
          `    contains: ${hit.name}  (matched ${hit.markerLabel})\n` +
          `    loaded by: ${routes.sort().join(", ")}`,
      );
    }
  }

  if (violations.length > 0) {
    fail(
      "Bundle budget: the guest booking funnel is shipping the arrival's animation stack.\n\n" +
        `${violations.join("\n\n")}\n\n` +
        "three / gsap / lenis belong to the arrival under app/(marketing). A funnel route\n" +
        "reaches them only through a module both groups share — usually something newly\n" +
        "imported by a shared component, or a provider that drifted into the root layout.\n" +
        "Move the dependency behind the marketing boundary rather than raising the budget.",
    );
  }

  const scanned = routesByChunk.size;
  process.stdout.write(
    `✓ Bundle budget: ${funnelRoutes.length} funnel routes, ${scanned} client chunks, ` +
      "no three / gsap / lenis.\n",
  );
}

main();
