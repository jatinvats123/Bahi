import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bottom-left is where the sidebar shows the "Mock data" badge.
  devIndicators: { position: "top-right" },
  // The Slack approval link opens the dashboard on the owner's phone over the local network.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
};

export default nextConfig;
