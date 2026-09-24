import path from "node:path";
import type { NextConfig } from "next";

const isDesktopBuild = process.env.SPPG_BUILD_TARGET === "desktop";
const zxingBrowserModule = "@zxing/browser/es2015/index.js";
const zxingLibraryModule = "@zxing/library/es2015/index.js";
const zxingBrowserEntry = path.resolve(
  process.cwd(),
  "node_modules/@zxing/browser/es2015/index.js",
);
const zxingLibraryEntry = path.resolve(
  process.cwd(),
  "node_modules/@zxing/library/es2015/index.js",
);

/**
 * Header keamanan build Web. Tanpa CSP apa pun, nama personil berisi
 * `<img onerror>` yang lolos ke `innerHTML` langsung berjalan di sesi admin;
 * aturan ini sengaja minimal (tanpa `script-src`) supaya script tema inline dan
 * chunk Next.js tidak ikut terblokir.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(self), microphone=()",
  },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
  },
];

const nextConfig: NextConfig = {
  // Static export Desktop tidak melayani header; di sana CSP Tauri yang berlaku.
  ...(isDesktopBuild
    ? { output: "export" as const }
    : {
        async headers() {
          return [{ source: "/:path*", headers: SECURITY_HEADERS }];
        },
      }),
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
    resolveAlias: {
      "@zxing/browser": zxingBrowserModule,
      "@zxing/library": zxingLibraryModule,
    },
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@zxing/browser$": zxingBrowserEntry,
      "@zxing/library$": zxingLibraryEntry,
    };
    return config;
  },
  images: {
    unoptimized: true,
  },
  reactCompiler: true,
};

export default nextConfig;
