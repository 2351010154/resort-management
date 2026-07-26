import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    // The workspace root, not the app: @mariva/shared is compiled from source
    // two levels up. Left unset, Turbopack walks up looking for a lockfile and
    // can settle far outside the repo — on a stray one in the home directory,
    // for instance — because pnpm keeps this workspace's settings in
    // pnpm-workspace.yaml rather than a lockfile it recognises.
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
  // three / R3F ship untranspiled ESM in a few subpaths; let Next handle them.
  // @mariva/shared is consumed as TypeScript source rather than a built dist,
  // so it needs the same treatment.
  transpilePackages: ["three", "@mariva/shared"],
};

export default nextConfig;
