import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Load environment test dari .env.test
dotenv.config({ path: path.resolve(__dirname, ".env.test") });

/**
 * Playwright E2E Configuration — Absensi SPPG (web-desktop)
 *
 * Menguji Web path secara lengkap: karena tidak ada `window.__TAURI_INTERNALS__`,
 * `isDesktopRuntime()` selalu `false` di Playwright, sehingga seluruh gateway
 * otomatis menggunakan `fetch("/api/...")` ke route handler Next.js.
 *
 * Aturan:
 * - Credential test wajib via .env.test, TIDAK PERNAH hardcode di file test.
 * - Gunakan storageState untuk session — tidak login ulang setiap test.
 * - Selector wajib menggunakan ID elemen (`#username-input`) bukan CSS class
 *   yang bisa berubah sewaktu-waktu.
 */

// Lokasi storage state untuk setiap role — disimpan di luar src, tidak di-commit
export const STORAGE_STATE_DIR = path.join(__dirname, "playwright/.auth");
export const SUPERADMIN_STATE = path.join(STORAGE_STATE_DIR, "superadmin.json");
export const LIMITED_STATE = path.join(STORAGE_STATE_DIR, "limited.json");

const hasLimitedUser =
  Boolean(process.env.PLAYWRIGHT_LIMITED_USERNAME) &&
  process.env.PLAYWRIGHT_LIMITED_USERNAME !== "test_operator_siswa" &&
  !process.env.PLAYWRIGHT_LIMITED_PASSWORD?.startsWith("GantiDengan");

export default defineConfig({
  testDir: "./tests",

  // Jalankan test secara paralel di satu worker (lebih aman untuk database shared)
  // Naikkan jika database test terisolasi per-suite
  fullyParallel: false,
  workers: 1,

  // Di CI: gagal build jika ada `test.only` yang tertinggal
  forbidOnly: !!process.env.CI,

  // Ulangi test yang gagal: 0 di local, 2 di CI
  retries: process.env.CI ? 2 : 0,

  // Timeout per test: 120 detik (cukup untuk Next.js hydration + API call pada cold start)
  timeout: 120_000,

  // Timeout untuk expect assertions: 15 detik
  expect: {
    timeout: 15_000,
  },

  reporter: process.env.CI
    ? [["html", { open: "never" }], ["github"]]
    : [["html", { open: "never" }], ["list"]],

  use: {
    // Base URL Next.js dev server
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",

    // Screenshot & video hanya saat test gagal
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",

    // Locale Indonesia untuk format tanggal yang konsisten
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  },

  projects: [
    // ─── Setup: Login & simpan session state ────────────────────────────────
    {
      name: "setup-superadmin",
      testMatch: "**/fixtures/setup-superadmin.ts",
    },
    ...(hasLimitedUser
      ? [
          {
            name: "setup-limited",
            testMatch: "**/fixtures/setup-limited.ts",
          },
        ]
      : []),

    // ─── Chromium (utama) ────────────────────────────────────────────────────
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: SUPERADMIN_STATE,
      },
      dependencies: ["setup-superadmin"],
      testIgnore: ["**/rbac/**", "**/fixtures/**"],
    },

    // ─── RBAC Tests: pakai akun limited (hanya jika akun tersedia) ───────────
    ...(hasLimitedUser
      ? [
          {
            name: "chromium-limited",
            use: {
              ...devices["Desktop Chrome"],
              storageState: LIMITED_STATE,
            },
            dependencies: ["setup-limited"],
            testMatch: "**/rbac/area-guard.spec.ts",
          },
        ]
      : []),

    // ─── Auth Tests: tanpa storageState (butuh fresh browser) ───────────────
    {
      name: "chromium-no-auth",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["**/auth/**", "**/rbac/redirect-unauthenticated.spec.ts"],
    },

    // ─── Mobile Viewport ─────────────────────────────────────────────────────
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
        storageState: SUPERADMIN_STATE,
      },
      dependencies: ["setup-superadmin"],
      testMatch: ["**/auth/login.spec.ts", "**/dashboard/**"],
    },
  ],

  // Jalankan dev server otomatis jika belum menyala
  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
