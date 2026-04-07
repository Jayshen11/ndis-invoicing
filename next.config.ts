import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SEC: pdf-parse pulls pdf.js; keep it external so the server bundle does not break.
  serverExternalPackages: ["pdf-parse"],
  async redirects() {
    return [
      { source: "/", destination: "/dashboard", permanent: true },
      { source: "/participants", destination: "/clients", permanent: true },
      { source: "/settings", destination: "/rbac-roles", permanent: true },
      {
        source: "/settings/user-roles",
        destination: "/rbac-roles",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
