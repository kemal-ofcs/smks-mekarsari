/**
 * RBAC Area Guard Tests — Absensi SPPG
 *
 * Menguji bahwa `canAccessArea(user, area)` bekerja dengan benar:
 * - Operator terbatas (andriyanguru) dapat mengakses area siswa, guru, dashboard
 * - Operator terbatas diredirect ke /forbidden saat mengakses area di luar haknya
 *   (karyawan, shift, holidays, settings, operators, scanner)
 *
 * Rule #36: "Setiap halaman privat wajib memasang guard area level halaman:
 * canAccessArea(user, area) redirect('/forbidden')"
 *
 * Project Playwright: "chromium-limited" (storageState: limited.json)
 */

import { expect, test } from "@playwright/test";

// ─── 1. Area yang BOLEH diakses oleh operator terbatas ──────────────────────

test.describe("Operator Terbatas — area yang diizinkan", () => {
  const ACCESSIBLE_ROUTES = [
    { route: "/siswa", label: "Halaman Siswa" },
    { route: "/guru", label: "Halaman Guru" },
    { route: "/dashboard", label: "Halaman Dashboard" },
  ];

  for (const { route, label } of ACCESSIBLE_ROUTES) {
    test(`${label} (${route}) dapat diakses`, async ({ page }) => {
      await page.goto(route);
      await expect(page).not.toHaveURL(/\/forbidden/, { timeout: 25_000 });
      await expect(page).not.toHaveURL(/\/login/, { timeout: 25_000 });
      await expect(page).toHaveURL(route, { timeout: 25_000 });
    });
  }
});

// ─── 2. Area yang DITOLAK (Guard redirect ke /forbidden) ────────────────────

test.describe("Operator Terbatas — area yang dibatasi (RBAC Guard)", () => {
  const RESTRICTED_ROUTES = [
    { route: "/karyawan", label: "Halaman Karyawan" },
    { route: "/shift", label: "Halaman Shift" },
    { route: "/holidays", label: "Halaman Hari Libur" },
    { route: "/settings", label: "Halaman Settings" },
    { route: "/operators", label: "Halaman Operators" },
    { route: "/scanner", label: "Halaman Scanner" },
  ];

  for (const { route, label } of RESTRICTED_ROUTES) {
    test(`${label} (${route}) dialihkan ke /forbidden`, async ({ page }) => {
      await page.goto(route);
      // Operator terbatas WAJIB diredirect ke /forbidden
      await expect(page).toHaveURL(/\/forbidden/, { timeout: 25_000 });
    });
  }
});

// ─── 3. Halaman /forbidden menampilkan konten yang benar ─────────────────────

test.describe("Halaman /forbidden", () => {
  test("menampilkan pesan akses dibatasi", async ({ page }) => {
    await page.goto("/forbidden");

    await expect(page).toHaveURL("/forbidden", { timeout: 25_000 });
    await expect(page.getByText("Akses dibatasi")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("Role kamu belum memiliki permission"),
    ).toBeVisible({ timeout: 15_000 });
  });
});
