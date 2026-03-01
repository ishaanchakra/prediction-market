import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
// Tailwind + PostCSS require Webpack in dev. Use: npm run dev (not `next dev`).
const nextConfig = {
  outputFileTracingRoot: rootDir,
  turbopack: {
    root: rootDir,
  },
  experimental: {
    // Offload Webpack work to a worker to keep dev more responsive.
    webpackBuildWorker: true,
  },
};

export default nextConfig;
