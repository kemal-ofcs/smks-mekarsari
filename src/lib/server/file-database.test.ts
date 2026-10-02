import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import {
  FILE_DATABASE_BUSY_TIMEOUT_MS,
  fileDatabaseOptions,
  resolveServerDatabaseConfig,
} from "@/lib/server/database-config";

/**
 * Pemasangan berkas SQLite dipakai DUA proses: aplikasi admin dan situs publik.
 * Tes ini memakai proses kedua yang sungguhan. Di dalam satu proses kuncinya
 * tidak bisa diuji: klien libSQL memblokir thread saat menunggu, sehingga
 * pemegang kunci tidak pernah sempat melepaskannya.
 */
// Folder tetap, dibersihkan di AWAL. Windows baru melepas berkas SQLite saat
// prosesnya berakhir, jadi menghapusnya di `afterAll` selalu gagal terkunci;
// pada run berikutnya proses lama sudah mati dan sisanya bisa dibuang.
const folder = join(tmpdir(), "kos-berkas-uji");
rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });
const berkas = join(folder, "uji.db").replace(/\\/g, "/");
const url = `file:${berkas}`;
const config = resolveServerDatabaseConfig({
  NODE_ENV: "production",
  KOS_DATABASE_URL: url,
});

let denganTunggu: Client;
let tanpaTunggu: Client;

beforeAll(async () => {
  denganTunggu = createClient({ url, ...fileDatabaseOptions(config) });
  tanpaTunggu = createClient({ url });
  await denganTunggu.execute("PRAGMA journal_mode = WAL;");
  await denganTunggu.execute(
    "CREATE TABLE catatan (id INTEGER PRIMARY KEY, isi TEXT);",
  );
});

afterAll(() => {
  denganTunggu.close();
  tanpaTunggu.close();
});

describe("opsi berkas SQLite", () => {
  test("berkas diberi waktu tunggu, database remote tidak", () => {
    expect(config.isRemote).toBe(false);
    expect(fileDatabaseOptions(config)).toEqual({
      timeout: FILE_DATABASE_BUSY_TIMEOUT_MS,
    });
    expect(
      fileDatabaseOptions(
        resolveServerDatabaseConfig({
          NODE_ENV: "production",
          KOS_DATABASE_URL: "libsql://db.turso.io",
          KOS_DATABASE_AUTH_TOKEN: "token",
        }),
      ),
    ).toEqual({});
  });

  test("mode WAL tersimpan di berkasnya", async () => {
    const hasil = await tanpaTunggu.execute("PRAGMA journal_mode;");
    expect(String(hasil.rows[0]?.journal_mode)).toBe("wal");
  });
});

describe("dua proses menulis ke berkas yang sama", () => {
  test("tanpa waktu tunggu gagal terkunci; dengan waktu tunggu berhasil", async () => {
    // Proses kedua memegang kunci tulis selama 1,5 detik, seperti aplikasi
    // admin yang sedang menyimpan sesuatu saat situs publik menerima PMB.
    const pemegang = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { createClient } from "@libsql/client";
         const client = createClient({ url: ${JSON.stringify(url)} });
         const tx = await client.transaction("write");
         await tx.execute("INSERT INTO catatan (isi) VALUES ('proses kedua');");
         console.log("terkunci");
         await new Promise((selesai) => setTimeout(selesai, 1500));
         await tx.commit();
         client.close();`,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "inherit" },
    );
    const pembaca = pemegang.stdout.getReader();
    let keluaran = "";
    while (!keluaran.includes("terkunci")) {
      const potongan = await pembaca.read();
      if (potongan.done) break;
      keluaran += new TextDecoder().decode(potongan.value);
    }
    expect(keluaran).toContain("terkunci");

    // Bawaan klien: langsung menyerah.
    await expect(
      tanpaTunggu.execute("INSERT INTO catatan (isi) VALUES ('tanpa tunggu');"),
    ).rejects.toThrow(/locked|busy/i);

    // Dengan opsi aplikasi: menunggu sampai proses kedua selesai, lalu masuk.
    await denganTunggu.execute(
      "INSERT INTO catatan (isi) VALUES ('dengan tunggu');",
    );
    expect(await pemegang.exited).toBe(0);

    const baris = await denganTunggu.execute(
      "SELECT isi FROM catatan ORDER BY id;",
    );
    expect(baris.rows.map((row) => String(row.isi))).toEqual([
      "proses kedua",
      "dengan tunggu",
    ]);
  }, 20_000);
});
