/**
 * Auth Fixture — Helper reusable untuk test yang butuh operasi auth.
 *
 * Extends Playwright test dengan:
 * - `loginPage`: helper untuk mengisi form login
 * - `logoutAction`: helper untuk logout via API (lebih cepat dari UI)
 *
 * Untuk test yang hanya butuh halaman dengan session aktif, gunakan
 * storageState di playwright.config.ts (sudah dikonfigurasi).
 */

import { test as base, expect, type Page } from "@playwright/test";

/**
 * Login via UI form — digunakan oleh setup fixtures dan test auth.
 * Mengisi #username-input, #password-input, klik submit.
 */
export async function loginViaForm(
  page: Page,
  username: string,
  password: string,
): Promise<{ sukses: boolean; errorText: string | null }> {
  await page.goto("/login");
  await expect(page.locator("#username-input")).toBeVisible({
    timeout: 60_000,
  });

  await page.fill("#username-input", username);
  await page.fill("#password-input", password);
  await page.click('[type="submit"]');

  // Tunggu: redirect ke / (sukses) ATAU error alert muncul (gagal)
  await Promise.race([
    page.waitForURL("/", { timeout: 15_000 }),
    page
      .locator(".bg-rose-950\\/60")
      .waitFor({ state: "visible", timeout: 15_000 }),
  ]).catch(() => {
    // Timeout: biarkan test melanjutkan dan assertion akan gagal jika perlu
  });

  const isOnHome = page.url().endsWith("/");
  const errorLocator = page.locator(".bg-rose-950\\/60");
  const hasError = await errorLocator.isVisible().catch(() => false);

  return {
    sukses: isOnHome,
    errorText: hasError ? await errorLocator.textContent() : null,
  };
}

/**
 * Logout via API endpoint — lebih cepat dari klik UI logout.
 * Menghapus session cookie dan mengarahkan ke /login.
 */
export async function logoutViaApi(page: Page): Promise<void> {
  await page.request.delete("/api/auth/session");
  await page.goto("/login");
  await expect(page.locator("#username-input")).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Extended test dengan helper auth.
 * Gunakan ini jika test butuh aksi login/logout di dalam test body.
 */
export const test = base.extend<{
  loginViaForm: typeof loginViaForm;
  logoutViaApi: typeof logoutViaApi;
}>({
  loginViaForm: async (_params, use) => {
    await use(loginViaForm);
  },
  logoutViaApi: async (_params, use) => {
    await use(logoutViaApi);
  },
});

export { expect } from "@playwright/test";
