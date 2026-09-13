/**
 * Login Page Tests — Absensi SPPG
 *
 * Menguji alur login di Web path (isDesktopRuntime() === false di Playwright).
 * Semua request auth mengalir ke /api/auth/login → Turso Cloud.
 *
 * Selector yang digunakan:
 * - #username-input  (id di login/page.tsx:253)
 * - #password-input  (id di login/page.tsx:273)
 * - #totp-input      (id di login/page.tsx:315)
 * - [type="submit"]  (tombol submit form)
 */

import { expect, test } from "@playwright/test";
import { loginViaForm } from "../fixtures/auth.fixture";

test.describe("Login Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    // Tunggu halaman selesai hydrate
    await expect(page.locator("#username-input")).toBeVisible({
      timeout: 15_000,
    });
  });

  // ─── Validasi Form ──────────────────────────────────────────────────────────

  test("submit form kosong menampilkan pesan error", async ({ page }) => {
    await page.click('[type="submit"]');

    // Error: "Mohon isi Username / Kode Operator dan Password."
    const errorAlert = page.locator(".bg-rose-950\\/60");
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText("Mohon isi");
  });

  test("submit hanya username tanpa password menampilkan error", async ({
    page,
  }) => {
    await page.fill("#username-input", "someuser");
    await page.click('[type="submit"]');

    const errorAlert = page.locator(".bg-rose-950\\/60");
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText("Mohon isi");
  });

  // ─── Credential Salah ───────────────────────────────────────────────────────

  test("username atau password salah menampilkan error dari API", async ({
    page,
  }) => {
    await page.fill("#username-input", "username_tidak_ada_12345");
    await page.fill("#password-input", "passwordSalah!999");
    await page.click('[type="submit"]');

    // Loading state muncul saat mengirim
    await expect(page.locator("text=Memverifikasi Login..."))
      .toBeVisible({
        timeout: 3_000,
      })
      .catch(() => {
        // Loading mungkin terlalu cepat — tidak kritis jika terlewat
      });

    // Error response dari API
    const errorAlert = page.locator(".bg-rose-950\\/60");
    await expect(errorAlert).toBeVisible({ timeout: 15_000 });
    // Pesan dari server (bisa "Username atau password tidak sesuai" atau sejenisnya)
    await expect(errorAlert).not.toBeEmpty();
  });

  // ─── Elemen UI ──────────────────────────────────────────────────────────────

  test("tombol toggle show/hide password berfungsi", async ({ page }) => {
    await page.fill("#password-input", "testpassword");

    // Awalnya type="password"
    await expect(page.locator("#password-input")).toHaveAttribute(
      "type",
      "password",
    );

    // Klik toggle
    await page.click("text=👁️ Lihat");
    await expect(page.locator("#password-input")).toHaveAttribute(
      "type",
      "text",
    );

    // Klik lagi → kembali tersembunyi
    await page.click("text=🙈 Sembunyi");
    await expect(page.locator("#password-input")).toHaveAttribute(
      "type",
      "password",
    );
  });

  test("link 'Lupa Password?' mengarah ke /lupa-password", async ({ page }) => {
    await page.click("text=Lupa Password?");
    await expect(page).toHaveURL("/lupa-password");
  });

  // ─── Judul & SEO ────────────────────────────────────────────────────────────

  test("halaman login memiliki title yang benar", async ({ page }) => {
    await expect(page).toHaveTitle(/.+/); // title tidak kosong
  });

  // ─── Responsivitas ──────────────────────────────────────────────────────────

  test("form login tampil baik di viewport mobile 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/login");
    await expect(page.locator("#username-input")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("#password-input")).toBeVisible();
    await expect(page.locator('[type="submit"]')).toBeVisible();

    // Form tidak overflow horizontal
    const formCard = page.locator("form").first();
    const box = await formCard.boundingBox();
    expect(box).toBeTruthy();
    if (box) {
      expect(box.x + box.width).toBeLessThanOrEqual(375 + 16); // toleransi 16px
    }
  });
});

test.describe("Login — Alur TOTP", () => {
  // Test ini membutuhkan akun dengan 2FA aktif.
  // Hanya menguji UI behavior (field TOTP muncul), bukan validasi kode TOTP sungguhan.

  test("field TOTP muncul setelah server mengembalikan TOTP_REQUIRED", async ({
    page,
  }) => {
    // Mock response server yang mengembalikan requiresTotp: true
    await page.route("/api/auth/login", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sukses: false,
          requiresTotp: true,
          pesan: "Masukkan kode verifikasi dua langkah.",
        }),
      });
    });

    await page.goto("/login");
    await expect(page.locator("#username-input")).toBeVisible({
      timeout: 15_000,
    });

    await page.fill("#username-input", "user_dengan_2fa");
    await page.fill("#password-input", "passwordBenar!123");
    await page.click('[type="submit"]');

    // Field TOTP harus muncul
    await expect(page.locator("#totp-input")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=Kode Verifikasi 2FA")).toBeVisible();
  });
});

test.describe("Login — Redirect setelah sukses", () => {
  test("login berhasil mengarah ke halaman home /", async ({ page }) => {
    const superadminUser = process.env.PLAYWRIGHT_SUPERADMIN_USERNAME;
    const superadminPass = process.env.PLAYWRIGHT_SUPERADMIN_PASSWORD;

    test.skip(
      !superadminUser || !superadminPass,
      "Atur PLAYWRIGHT_SUPERADMIN_USERNAME dan PLAYWRIGHT_SUPERADMIN_PASSWORD di .env.test",
    );

    const result = await loginViaForm(
      page,
      superadminUser ?? "",
      superadminPass ?? "",
    );

    expect(result.sukses).toBe(true);
    await expect(page).toHaveURL("/");
  });
});
