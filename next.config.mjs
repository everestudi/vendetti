/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
  serverExternalPackages: ['@prisma/client', 'playwright'],
  // Scripts standalone (src/scrapers/*) têm cast loose pra DOM — não bloquear build.
  // Pra rodar typecheck antes de prod: `npm run typecheck`.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
