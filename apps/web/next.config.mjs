/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three / R3F ship untranspiled ESM in a few subpaths; let Next handle them.
  // @mariva/shared is consumed as TypeScript source rather than a built dist,
  // so it needs the same treatment.
  transpilePackages: ["three", "@mariva/shared"],
};

export default nextConfig;
