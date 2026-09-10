import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {import('next').NextConfig} */
const nextConfig = (phase) => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next-build",
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["@prisma/client"]
});

export default nextConfig;
