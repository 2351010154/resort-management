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
};

export default nextConfig;
