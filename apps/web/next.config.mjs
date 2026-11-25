/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cloudflare Pages : preset « Next.js (Static HTML Export) », répertoire `out`.
  output: 'export',
  images: { unoptimized: true },
  transpilePackages: ['@stream24/shared'],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
