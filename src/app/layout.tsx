import type { Metadata, Viewport } from "next";
// Self-hosted fonts: bundled with the site, no request to Google at build time
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";

export const metadata: Metadata = {
  title: "South Central KY Jobs",
  description:
    "Open jobs in south central Kentucky, updated weekly. Search by county, job type, and pay.",
};

export const viewport: Viewport = {
  themeColor: "#17312b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
