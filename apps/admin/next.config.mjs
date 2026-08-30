import { fileURLToPath } from "node:url";

// The workspace root, not the app. Left unset, Turbopack walks up looking for a
// lockfile and can settle far outside the repo — on a stray one in the home
// directory, for instance — because pnpm keeps this workspace's settings in
// pnpm-workspace.yaml rather than a lockfile it recognises. The container build
// needs the same directory for a different reason, below.
const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

// Asked for by `apps/admin/Dockerfile` and by nothing else. Vercel builds this
// app itself and produces its own output — `output: "standalone"` is documented
// as unnecessary there and would put the server under `.next/standalone/` where
// `next start` refuses to find it — so the container asks for it by setting this
// variable and the Vercel build never sees it.
const standalone = process.env.NEXT_OUTPUT_STANDALONE === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: workspaceRoot,
  },

  // `outputFileTracingRoot` travels with `standalone` and is not optional
  // beside it: tracing defaults to the directory holding this file, so
  // `packages/shared` and `packages/api-client` — which live two levels up and
  // are reached through a pnpm symlink — would be traced as files outside the
  // root and dropped. The server that resulted would start and then fail on the
  // first import of a contract.
  ...(standalone
    ? { output: "standalone", outputFileTracingRoot: workspaceRoot }
    : {}),
};

export default nextConfig;
