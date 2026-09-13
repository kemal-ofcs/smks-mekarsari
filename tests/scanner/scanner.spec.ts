import { expect, test } from "@playwright/test";

/**
 * Scanner E2E Tests — Absensi SPPG (web-desktop)
 *
 * Menguji antarmuka Terminal Scanner QR dengan berbagai skenario:
 * - Scan Siswa (Tepat Waktu & Terlambat)
 * - Scan Guru (Masuk Mengajar)
 * - Scan Pegawai / Karyawan (Pulang)
 * - Penolakan: Belum Waktu Absen, QR Tidak Sah, Personil Non-aktif, Scan Ganda / Cooldown
 *
 * Catatan penting sesuai AGENTS.md:
 * - Waktu absensi divalidasi oleh backend/database, bukan manipulasi Date di client.
 * - Pengujian UI skenario absensi menggunakan API route mocking (page.route)
 *   pada endpoint POST /api/scanner.
 */

test.describe("Terminal Scanner QR — Operasional Absensi", () => {
  test.beforeEach(async ({ page }) => {
    // Kunjungi halaman scanner
    await page.goto("/scanner");

    // Pastikan berada di /scanner dan bukan redirect ke /login
    await expect(page).toHaveURL(/\/scanner/, { timeout: 35_000 });

    // Tunggu terminal selesai hydrate dan judul muncul
    await expect(page.locator("h1.scanner-terminal-title")).toBeVisible({
      timeout: 35_000,
    });

    // Pindah ke mode QR Reader USB / Wireless agar input keyboard aktif
    const readerModeBtn = page.getByRole("button", {
      name: /QR Reader USB/i,
    });
    await expect(readerModeBtn).toBeVisible({ timeout: 10_000 });
    await readerModeBtn.click();

    // Pastikan input QR reader sudah siap
    await expect(page.locator("#qr-reader-input")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Menampilkan elemen antarmuka scanner dengan benar", async ({
    page,
  }) => {
    await expect(page.locator("h1.scanner-terminal-title")).toBeVisible();
    await expect(page.locator(".scanner-terminal-clock-time")).toBeVisible();
    await expect(page.locator(".scanner-terminal-clock-date")).toBeVisible();
    await expect(page.locator("#qr-reader-input")).toBeVisible();
  });

  test("Scan Siswa — Masuk Tepat Waktu", async ({ page }) => {
    await page.route("**/api/scanner", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          sukses: true,
          status: "Berhasil",
          jenisScan: "Masuk",
          idKaryawan: "SISWA-001",
          nama: "Ahmad Santoso",
          divisi: "Kelas X-RPL-1",
          jenisPersonil: "SISWA",
          keterangan: "Tepat Waktu",
          pesan: "Absensi masuk siswa berhasil dicatat.",
        },
      });
    });

    const input = page.locator("#qr-reader-input");
    await input.fill("SISWA-001|TOKEN_ABC");
    await input.press("Enter");

    // Verifikasi nama dan status di layar (gunakan .first() karena nama juga muncul di riwayat)
    await expect(page.getByText("Ahmad Santoso").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Siswa").first()).toBeVisible();
    await expect(
      page.getByText("Absensi masuk siswa berhasil dicatat.").first(),
    ).toBeVisible();
  });

  test("Scan Siswa — Masuk Terlambat", async ({ page }) => {
    await page.route("**/api/scanner", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          sukses: true,
          status: "Berhasil",
          jenisScan: "Masuk",
          idKaryawan: "SISWA-002",
          nama: "Budi Pratama",
          divisi: "Kelas XI-TKJ-2",
          jenisPersonil: "SISWA",
          keterangan: "Terlambat",
          menitTerlambat: 20,
          pesan: "Absensi siswa tercatat: Terlambat 20 menit.",
        },
      });
    });

    const input = page.locator("#qr-reader-input");
    await input.fill("SISWA-002|TOKEN_XYZ");
    await input.press("Enter");

    await expect(page.getByText("Budi Pratama").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("Absensi siswa tercatat: Terlambat 20 menit.").first(),
    ).toBeVisible();
  });

  test("Scan Guru — Masuk Mengajar Tepat Waktu", async ({ page }) => {
    await page.route("**/api/scanner", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          sukses: true,
          status: "Berhasil",
          jenisScan: "Masuk",
          idKaryawan: "GURU-001",
          nama: "Ibu Siti Nurhaliza",
          divisi: "Matematika",
          jenisPersonil: "GURU",
          keterangan: "Tepat Waktu",
          pesan: "Absensi guru berhasil dicatat. Selamat mengajar!",
        },
      });
    });

    const input = page.locator("#qr-reader-input");
    await input.fill("GURU-001|TOKEN_GURU");
    await input.press("Enter");

    await expect(page.getByText("Ibu Siti Nurhaliza").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Guru").first()).toBeVisible();
    await expect(
      page
        .getByText("Absensi guru berhasil dicatat. Selamat mengajar!")
        .first(),
    ).toBeVisible();
  });

  test("Scan Pegawai / Karyawan — Pulang", async ({ page }) => {
    await page.route("**/api/scanner", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          sukses: true,
          status: "Berhasil",
          jenisScan: "Pulang",
          idKaryawan: "EMP-005",
          nama: "Hendra Wijaya",
          divisi: "Tata Usaha",
          jenisPersonil: "Pegawai",
          keterangan: "Tepat Waktu",
          pesan: "Absensi pulang pegawai tercatat.",
        },
      });
    });

    const input = page.locator("#qr-reader-input");
    await input.fill("EMP-005|TOKEN_EMP");
    await input.press("Enter");

    await expect(page.getByText("Hendra Wijaya").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Pegawai").first()).toBeVisible();
    await expect(
      page.getByText("Absensi pulang pegawai tercatat.").first(),
    ).toBeVisible();
  });

  test("Scan Ditolak — Belum Waktunya Absen (Sesi Belum Dibuka)", async ({
    page,
  }) => {
    await page.route("**/api/scanner", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          sukses: false,
          status: "Ditolak",
          jenisScan: "Scan Ditolak",
          idKaryawan: "SISWA-003",
          nama: "Dewi Lestari",
          divisi: "Kelas X-AKL-1",
          pesan: "Belum masuk rentang waktu absensi masuk untuk shift ini.",
        },
      });
    });

    const input = page.locator("#qr-reader-input");
    await input.fill("SISWA-003|TOKEN_DEWI");
    await input.press("Enter");

    await expect(
      page
        .getByText("Belum masuk rentang waktu absensi masuk untuk shift ini.")
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Scan Ditolak — Format QR Tidak Dikenali / Kosong", async ({ page }) => {
    await page.route("**/api/scanner", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          sukses: false,
          status: "Ditolak",
          jenisScan: "Scan Ditolak",
          idKaryawan: "",
          nama: "-",
          divisi: "-",
          pesan: "Format QR Code tidak dikenali atau kosong.",
        },
      });
    });

    const input = page.locator("#qr-reader-input");
    await input.fill("QR_TIDAK_VALID_FORMAT");
    await input.press("Enter");

    await expect(
      page.getByText("Format QR Code tidak dikenali atau kosong.").first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Scan Ditolak — Personil Non-aktif", async ({ page }) => {
    await page.route("**/api/scanner", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          sukses: false,
          status: "Ditolak",
          jenisScan: "Scan Ditolak",
          idKaryawan: "EMP-099",
          nama: "Doni Nonaktif",
          divisi: "Logistik",
          pesan: "Scan ditolak: Personil berstatus non-aktif.",
        },
      });
    });

    const input = page.locator("#qr-reader-input");
    await input.fill("EMP-099|TOKEN_DONI");
    await input.press("Enter");

    await expect(
      page.getByText("Scan ditolak: Personil berstatus non-aktif.").first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Scan Ditolak — Scan Ganda / Cooldown", async ({ page }) => {
    await page.route("**/api/scanner", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          sukses: false,
          status: "Ditolak",
          jenisScan: "Scan Ditolak",
          idKaryawan: "SISWA-001",
          nama: "Ahmad Santoso",
          divisi: "Kelas X-RPL-1",
          pesan: "Scan ganda terdeteksi. Silakan tunggu cooldown.",
        },
      });
    });

    const input = page.locator("#qr-reader-input");
    await input.fill("SISWA-001|TOKEN_ABC");
    await input.press("Enter");

    await expect(
      page.getByText("Scan ganda terdeteksi. Silakan tunggu cooldown.").first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
