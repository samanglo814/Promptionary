import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// This machine's network addresses (e.g. 192.168.1.20) and the tunnels from dev-tunnel.sh.
// Next.js blocks dev pages opened from anything but localhost, which breaks testing with phones.
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net?.family === "IPv4" && !net.internal)
  .map((net) => net!.address);

const nextConfig: NextConfig = {
  // TUNNEL_DOMAIN: your own domain, when dev-tunnel.sh runs with one (e.g. promptionary.design).
  allowedDevOrigins: [...lanAddresses, "*.trycloudflare.com", ...(process.env.TUNNEL_DOMAIN ? [process.env.TUNNEL_DOMAIN] : [])],
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
