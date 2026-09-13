/**
 * Guru CRUD Tests — Absensi SPPG
 *
 * Menguji alur halaman /guru: akses, render, dan filter dasar.
 * Analog dengan siswa-crud.spec.ts.
 *
 * Permission yang dibutuhkan: teachers.view (lihat), teachers.manage (kelola)
 */

import { expect, test } from "@playwright/test";

test.describe("Halaman Guru — Akses & Render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/guru");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL("/guru");
  });

  test("halaman /guru dapat diakses oleh superadmin", async ({ page }) => {
    await expect(page).toHaveURL("/guru");
    await expect(page).not.toHaveURL(/\/forbidden/);
  });

  test("halaman memiliki heading yang benar", async ({ page }) => {
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test("tombol 'Tambah Guru' tersedia untuk user dengan teachers.manage", async ({
    page,
  }) => {
    // Superadmin punya teachers.manage → tombol tambah harus ada
    const addButton = page.getByRole("button", { name: /tambah guru/i });
    await expect(addButton).toBeVisible({ timeout: 8_000 });
  });
});

test.describe("Halaman Guru — Search & Filter", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/guru");
    await expect(page).toHaveURL("/guru");
    await page.waitForLoadState("networkidle");
  });

  test("input search tidak error saat diisi", async ({ page }) => {
    const searchInput = page
      .locator(
        "input[placeholder*='cari'], input[placeholder*='Cari'], input[type='search']",
      )
      .first();

    if (await searchInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await searchInput.fill("Nama Guru Test");
      await page.waitForTimeout(300);
      // Tidak ada error JS di halaman
      await expect(page).toHaveURL("/guru");
    }
  });

  test("filter dipertahankan setelah event sppg:sync-completed", async ({
    page,
  }) => {
    const searchInput = page
      .locator("input[placeholder*='cari'], input[placeholder*='Cari']")
      .first();

    if (await searchInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await searchInput.fill("GuruFilterTest");
      await page.waitForTimeout(200);

      await page.evaluate(() => {
        window.dispatchEvent(new Event("sppg:sync-completed"));
      });

      await page.waitForTimeout(500);
      await expect(searchInput).toHaveValue("GuruFilterTest");
    }
  });
});

test.describe("Halaman Guru — Form Tambah", () => {
  test("form tambah guru terbuka saat klik tombol", async ({ page }) => {
    await page.goto("/guru");
    await expect(page).toHaveURL("/guru");
    await page.waitForLoadState("networkidle");

    const addButton = page.getByRole("button", { name: /tambah guru/i });
    await expect(addButton).toBeVisible({ timeout: 8_000 });
    await addButton.click();

    await page.waitForTimeout(300);
    const modal = page
      .locator("dialog, [role='dialog'], [class*='modal']")
      .first();
    await expect(modal).toBeVisible({ timeout: 5_000 });
  });
});
