import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['ws', 'socket.io'],
  turbopack: {
    resolveAlias: {
      net: { browser: './lib/empty.js' },
      tls: { browser: './lib/empty.js' },
      fs: { browser: './lib/empty.js' },
      dgram: { browser: './lib/empty.js' },
    },
  },
  allowedDevOrigins: ["level-newspapers-comment-josh.trycloudflare.com", "players-airports-sorry-spin.trycloudflare.com"],

};

export default nextConfig;
