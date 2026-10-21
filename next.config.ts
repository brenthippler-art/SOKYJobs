import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // Report uploads go through Server Actions; the default limit is 1 MB.
      // Vercel caps requests at 4.5 MB, so stay just under that.
      bodySizeLimit: "4mb",
    },
  },
  // exceljs is a Node library - load it at runtime instead of bundling it
  serverExternalPackages: ["exceljs"],
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
