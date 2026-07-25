/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three / R3F ship untranspiled ESM in a few subpaths; let Next handle them.
  transpilePackages: ["three"],
};

export default nextConfig;
