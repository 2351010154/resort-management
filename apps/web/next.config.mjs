/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // next lint walks app / pages / components / lib / src and nothing else, so
  // without naming them the feature folders — where most of the code lives —
  // would pass by never being read.
  eslint: { dirs: ["app", "components", "features", "lib"] },
  // three / R3F ship untranspiled ESM in a few subpaths; let Next handle them.
  // @mariva/shared is consumed as TypeScript source rather than a built dist,
  // so it needs the same treatment.
  transpilePackages: ["three", "@mariva/shared"],
};

export default nextConfig;
