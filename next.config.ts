import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unpdf ships its own pdf.js build; keep it out of the server bundle.
  serverExternalPackages: ["unpdf"],
  async headers() {
    return [
      {
        // ffmpeg.wasm core (~32MB) never changes for a given version.
        source: "/ffmpeg/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
