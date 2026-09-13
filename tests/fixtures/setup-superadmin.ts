/**
 * Setup Superadmin Session — dijalankan sekali sebelum semua test yang butuh auth.
 *
 * Menyimpan cookie session ke file JSON (storageState) sehingga test individual
 * tidak perlu login ulang. Cookie menggunakan HttpOnly session yang diset oleh
 * /api/auth/login — Playwright menangkap dan menyimpannya otomatis.
 */

import { expect, test as setup } from "@playwright/test";
import { SUPERADMIN_STATE } from "../../playwright.config";

const username = process.env.PLAYWRIGHT_SUPERADMIN_USERNAME;
const password = process.env.PLAYWRIGHT_SUPERADMIN_PASSWORD;

setup("authenticate superadmin", async ({ page }) => {
  if (!username || !password) {
    throw new Error(
      "PLAYWRIGHT_SUPERADMIN_USERNAME dan PLAYWRIGHT_SUPERADMIN_PASSWORD " +
        "wajib diset di .env.test. Lihat .env.test untuk petunjuk.",
    );
  }

  await page.goto("/login");

  // Tunggu halaman selesai hydrate (komponen login muncul)
  await expect(page.locator("#username-input")).toBeVisible({
    timeout: 60_000,
  });

  await page.fill("#username-input", username);
  await page.fill("#password-input", password);
  await page.click('[type="submit"]');

  // Tunggu redirect ke halaman home (/) setelah login berhasil
  await page.waitForURL("/", { timeout: 120_000 });
  await expect(page).toHaveURL("/");

  // Simpan storage state (cookie session) untuk dipakai test lain
  await page.context().storageState({ path: SUPERADMIN_STATE });
});
