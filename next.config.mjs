/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["telegram"],
  experimental: {
    outputFileTracingIncludes: {
      "/api/telegram-search": ["./node_modules/telegram/**/*"],
      "/api/telegram-channels": ["./node_modules/telegram/**/*"],
    },
  },
};

export default nextConfig;
