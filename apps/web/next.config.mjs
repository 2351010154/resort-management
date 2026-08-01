import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    // The workspace root, not the app. Left unset, Turbopack walks up looking
    // for a lockfile and can settle far outside the repo — on a stray one in
    // the home directory, for instance — because pnpm keeps this workspace's
    // settings in pnpm-workspace.yaml rather than a lockfile it recognises.
    root: fileURLToPath(new URL("../..", import.meta.url)),
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
};

export default nextConfig;
