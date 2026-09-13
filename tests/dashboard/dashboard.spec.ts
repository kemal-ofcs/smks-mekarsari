/**
 * Dashboard Tests — Absensi SPPG
 *
 * Menguji bahwa halaman /dashboard dapat dirender dengan benar
 * dan menampilkan data kehadiran dasar.
 *
 * Permission yang dibutuhkan: dashboard.view
 */

import { expect, test } from "@playwright/test";

test.describe("Halaman Dashboard — Render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL("/dashboard");
  });

  test("dashboard dapat diakses oleh superadmin", async ({ page }) => {
    await expect(page).toHaveURL("/dashboard");
    await expect(page).not.toHaveURL(/\/forbidden/);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("dashboard memiliki heading utama", async ({ page }) => {
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });

  test("dashboard tidak melempar error JavaScript", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000); // beri waktu async load

    // Filter error yang tidak relevan (extension browser, dll.)
    const relevantErrors = errors.filter(
      (e) =>
        !e.includes("extension") &&
        !e.includes("favicon") &&
        !e.includes("chunk"),
    );

    expect(relevantErrors).toHaveLength(0);
  });
});

test.describe("Dashboard — Mobile Viewport", () => {
  test("dashboard tampil baik di viewport 393×851 (Pixel 5)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL("/dashboard");
    await expect(page).not.toHaveURL(/\/forbidden/);

    // Heading muncul (tidak tersembunyi di mobile)
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Superadmin — Akses Penuh ke Seluruh Area", () => {
  const SUPERADMIN_ACCESSIBLE_ROUTES = [
    { route: "/siswa", label: "Halaman Siswa" },
    { route: "/guru", label: "Halaman Guru" },
    { route: "/karyawan", label: "Halaman Karyawan" },
    { route: "/shift", label: "Halaman Shift" },
    { route: "/holidays", label: "Halaman Hari Libur" },
    { route: "/dashboard", label: "Halaman Dashboard" },
    { route: "/settings", label: "Halaman Settings" },
    { route: "/operators", label: "Halaman Operators" },
  ];

  for (const { route, label } of SUPERADMIN_ACCESSIBLE_ROUTES) {
    test(`${label} (${route}) dapat diakses tanpa hambatan`, async ({
      page,
    }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page).not.toHaveURL(/\/forbidden/);
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page).toHaveURL(route);
    });
  }
});
