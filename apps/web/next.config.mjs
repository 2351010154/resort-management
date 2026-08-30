import { fileURLToPath } from "node:url";

// The workspace root, not the app. Left unset, Turbopack walks up looking for a
// lockfile and can settle far outside the repo — on a stray one in the home
// directory, for instance — because pnpm keeps this workspace's settings in
// pnpm-workspace.yaml rather than a lockfile it recognises. The container build
// needs the same directory for a different reason, below.
const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

// Asked for by `apps/web/Dockerfile` and by nothing else. Vercel builds this app
// itself and produces its own output — `output: "standalone"` is documented as
// unnecessary there and would put the server under `.next/standalone/` where
// `next start` refuses to find it — so the container asks for it by setting this
// variable and the Vercel build never sees it. One config, two consumers, and
// neither has to know about the other's build.
const standalone = process.env.NEXT_OUTPUT_STANDALONE === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: workspaceRoot,
  },

  // three / R3F ship untranspiled ESM in a few subpaths; let Next handle them.
  //
  // `@mariva/shared` was listed here too, compiled from its TypeScript source.
  // It ships a built `dist/` now: the `@orpc/*` contract packages are ESM only,
  // which put that package on `moduleResolution: nodenext`, where relative
  // imports carry `.js` extensions naming a file tsc has not written yet.
  // Turbopack resolves those literally and finds nothing, and it has no
  // extension aliasing to bridge the gap — `experimental.extensionAlias` is
  // webpack's and is ignored here, measured both under `turbopack` and under
  // `experimental`. Building the package removes the question instead of
  // answering it.
  transpilePackages: ["three"],

  // `outputFileTracingRoot` travels with `standalone` and is not optional
  // beside it: tracing defaults to the directory holding this file, so
  // `packages/shared` and `packages/tokens` — which live two levels up and are
  // reached through a pnpm symlink — would be traced as files outside the root
  // and dropped. The server that resulted would start and then fail on the
  // first import of a contract.
  ...(standalone
    ? { output: "standalone", outputFileTracingRoot: workspaceRoot }
    : {}),
};

export default nextConfig;
