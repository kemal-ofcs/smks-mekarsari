/**
 * Logout Tests — Absensi SPPG
 *
 * Menguji bahwa setelah logout:
 * 1. User diarahkan ke /login
 * 2. Halaman privat tidak bisa diakses
 * 3. Session cookie sudah tidak valid
 *
 * Test ini berjalan di project "chromium-no-auth" (tanpa storageState)
 * karena butuh state fresh setiap kali.
 */

import { expect, test } from "@playwright/test";
import { loginViaForm, logoutViaApi } from "../fixtures/auth.fixture";

test.describe("Logout", () => {
  test.skip(
    !process.env.PLAYWRIGHT_SUPERADMIN_USERNAME,
    "Atur PLAYWRIGHT_SUPERADMIN_USERNAME di .env.test",
  );

  test("logout via API menghapus session dan redirect ke /login", async ({
    page,
  }) => {
    // Login dulu
    await loginViaForm(
      page,
      process.env.PLAYWRIGHT_SUPERADMIN_USERNAME ?? "",
      process.env.PLAYWRIGHT_SUPERADMIN_PASSWORD ?? "",
    );
    await expect(page).toHaveURL("/");

    // Logout via API (menghapus HttpOnly cookie)
    await logoutViaApi(page);
    await expect(page).toHaveURL("/login");
  });

  test("akses halaman privat setelah logout redirect ke /login", async ({
    page,
  }) => {
    // Login lalu logout
    await loginViaForm(
      page,
      process.env.PLAYWRIGHT_SUPERADMIN_USERNAME ?? "",
      process.env.PLAYWRIGHT_SUPERADMIN_PASSWORD ?? "",
    );
    await logoutViaApi(page);

    // Coba akses halaman privat
    await page.goto("/siswa");
    // Seharusnya redirect ke /login (karena session sudah tidak ada)
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("akses /dashboard setelah logout redirect ke /login", async ({
    page,
  }) => {
    await loginViaForm(
      page,
      process.env.PLAYWRIGHT_SUPERADMIN_USERNAME ?? "",
      process.env.PLAYWRIGHT_SUPERADMIN_PASSWORD ?? "",
    );
    await logoutViaApi(page);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});
