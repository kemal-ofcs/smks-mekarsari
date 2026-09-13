/**
 * Redirect Unauthenticated Tests — Absensi SPPG
 *
 * Memastikan semua route privat meredirect ke /login
 * ketika tidak ada session aktif.
 *
 * Test ini berjalan di project "chromium-no-auth" (tanpa storageState).
 *
 * Implementasi guard di halaman: menggunakan `useAuth()` hook dan
 * `redirect("/login")` dari next/navigation ketika `!isAuthenticated`.
 */

import { expect, test } from "@playwright/test";

const PRIVATE_ROUTES = [
  "/siswa",
  "/guru",
  "/karyawan",
  "/shift",
  "/holidays",
  "/dashboard",
  "/settings",
  "/operators",
  "/payroll",
  "/scanner",
  "/history",
  "/id-cards",
  "/akademik",
  "/presensi-kelas",
  "/jurnal-mengajar",
  "/leger-kehadiran",
  "/audit-absensi",
  "/riwayat-reset-password",
  "/foto-absensi",
  "/dasbor-kehadiran",
  "/notifikasi-wa",
  "/bimbingan-konseling",
  "/pmb",
  "/nilai",
];

test.describe("Redirect Unauthenticated — semua route privat", () => {
  // Setiap route privat harus redirect ke /login jika tidak ada session
  for (const route of PRIVATE_ROUTES) {
    test(`${route} → redirect ke /login tanpa session`, async ({ page }) => {
      // Pastikan tidak ada cookie session (berjalan di project no-auth)
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      // Harus diredirect ke /login
      await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    });
  }
});

test.describe("Halaman publik — dapat diakses tanpa login", () => {
  test("/login dapat diakses", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL("/login");
    await expect(page.locator("#username-input")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("/lupa-password dapat diakses", async ({ page }) => {
    await page.goto("/lupa-password");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL("/lupa-password");
    // Tidak redirect ke /login
    await expect(page).not.toHaveURL(/\/login/);
  });
});
