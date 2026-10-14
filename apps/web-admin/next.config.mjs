/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@gusto/ui-web", "@gusto/api-contracts", "@gusto/core-logic"],
  output: "standalone",
};

export default nextConfig;
