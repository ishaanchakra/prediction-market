/** @type {import('next').NextConfig} */
// Tailwind + PostCSS require Webpack in dev. Use: npm run dev (not `next dev`).
const nextConfig = {
  experimental: {
    // Offload Webpack work to a worker to keep dev more responsive.
    webpackBuildWorker: true,
  },
};

export default nextConfig;
