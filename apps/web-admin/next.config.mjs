/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@gusto/ui-web", "@gusto/api-contracts", "@gusto/core-logic"],
  output: "standalone",
  async rewrites() {
    const rawUrl =
      process.env.API_GATEWAY_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:3001";
    const cleanUrl = rawUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
    return [
      {
        source: "/api/v1/:path*",
        destination: `${cleanUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
