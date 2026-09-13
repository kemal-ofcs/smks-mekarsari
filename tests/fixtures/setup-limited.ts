/**
 * Setup Limited User Session — operator dengan permission terbatas.
 *
 * Akun ini hanya punya: students.view, teachers.view, dashboard.view, home.view
 * Tidak punya: employees.view, branding.manage, shifts.view, dll.
 * Digunakan untuk test RBAC area-guard.
 */

import { expect, test as setup } from "@playwright/test";
import { LIMITED_STATE } from "../../playwright.config";

const username = process.env.PLAYWRIGHT_LIMITED_USERNAME;
const password = process.env.PLAYWRIGHT_LIMITED_PASSWORD;

setup("authenticate limited user", async ({ page }) => {
  if (
    !username ||
    !password ||
    username === "test_operator_siswa" ||
    password.startsWith("GantiDengan")
  ) {
    setup.skip(true, "Akun limited user belum diset di .env.test. Lewati.");
    return;
  }

  await page.goto("/login");
  await expect(page.locator("#username-input")).toBeVisible({
    timeout: 60_000,
  });

  await page.fill("#username-input", username);
  await page.fill("#password-input", password);
  await page.click('[type="submit"]');

  // Limited user juga redirect ke home setelah login
  await page.waitForURL("/", { timeout: 120_000 });
  await expect(page).toHaveURL("/");

  await page.context().storageState({ path: LIMITED_STATE });
});
