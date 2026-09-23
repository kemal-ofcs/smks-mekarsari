import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

/**
 * Jalankan setiap berkas test di PROSES `bun test` sendiri, beberapa sekaligus.
 *
 * Satu proses untuk semua berkas tidak bisa dipakai di sini dan itu sudah
 * dibuktikan: `mock.module("server-only")` bersifat global di bun, dan beberapa
 * berkas berbagi klien libsql yang ditutup pada `afterAll`-nya sendiri.
 * Menggabungkannya membuat puluhan test gagal dengan `CLIENT_CLOSED` — bukan
 * karena kodenya salah, melainkan karena isolasinya hilang. Isolasi per-berkas
 * itu WAJIB dipertahankan.
 *
 * Yang tidak wajib adalah menjalankannya satu per satu. Biaya terbesar suite
 * ini adalah start-up proses, dan menunggu satu berkas selesai sebelum memulai
 * berikutnya membuat semua inti selain satu menganggur.
 *
 * Keluaran tiap berkas ditahan lalu dicetak utuh saat berkas itu selesai,
 * sehingga laporan beberapa proses tidak saling menyisip. Kegagalan pertama
 * menghentikan penjadwalan berkas baru, sama seperti versi berurutannya.
 */
function collectTests(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(path);
    return entry.isFile() &&
      (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx"))
      ? [path]
      : [];
  });
}

const tests = collectTests(join(process.cwd(), "src"));

if (tests.length === 0) {
  throw new Error("Tidak ada file test aplikasi utama yang ditemukan.");
}

// Berkas terbesar dijadwalkan lebih dulu. Beberapa berkas jauh lebih lama
// daripada sisanya — yang membangun skema database lengkap berkali-kali — dan
// bila baru dimulai di akhir, seluruh worker lain sudah selesai dan menunggu
// berkas itu seorang diri. Ukuran berkas
// hanya perkiraan kasar durasi, tetapi perkiraan yang gratis dan tidak pernah
// membuat urutannya lebih buruk daripada urutan direktori.
tests.sort((a, b) => statSync(b).size - statSync(a).size);

const workers = Math.max(1, Math.min(availableParallelism(), tests.length));

function runTest(test: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["test", "--timeout", "30000", test],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );

    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));

    child.on("error", reject);
    child.on("close", (code) => {
      process.stdout.write(Buffer.concat(chunks));
      resolve(code ?? 1);
    });
  });
}

let next = 0;
let failure = 0;

async function worker() {
  while (next < tests.length && failure === 0) {
    const test = tests[next++];
    const code = await runTest(test);
    if (code !== 0 && failure === 0) failure = code;
  }
}

await Promise.all(Array.from({ length: workers }, worker));

if (failure !== 0) process.exit(failure);
