import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { type Client, createClient } from "@libsql/client";

mock.module("server-only", () => ({}));

const { initDatabaseSchema } = await import("@/lib/db-schema");
const { aksiBarisAntrean, drainWaQueue, statusSetelahGagal } = await import(
  "./wa-sender"
);

// Vektor yang sama diuji di `wa_sender.rs` (`keputusan_baris_antrean`,
// `status_setelah_gagal`).
describe("aturan murni antrean", () => {
  test("keputusan per baris", () => {
    const sakelar = { scan_masuk: true, bolos: false };
    const dilihat = new Set<string>();
    expect(aksiBarisAntrean("scan_masuk", sakelar, dilihat, "d1")).toBe(
      "kirim",
    );
    expect(aksiBarisAntrean("scan_masuk", sakelar, dilihat, "d1")).toBe(
      "batal_duplikat",
    );
    expect(aksiBarisAntrean("bolos", sakelar, dilihat, "d2")).toBe(
      "batal_nonaktif",
    );
    // Jenis yang tidak dikenal peta sakelar: dibatalkan, tidak pernah dikirim.
    expect(aksiBarisAntrean("jenis_baru", sakelar, dilihat, "d3")).toBe(
      "batal_nonaktif",
    );
  });

  test("status setelah gagal", () => {
    expect(statusSetelahGagal(0)).toEqual({ status: "Menunggu", percobaan: 1 });
    expect(statusSetelahGagal(1)).toEqual({ status: "Menunggu", percobaan: 2 });
    expect(statusSetelahGagal(2)).toEqual({ status: "Gagal", percobaan: 3 });
  });
});

const fetchAsli = globalThis.fetch;
// SATU klien untuk seluruh berkas, direset per tes. Di Bun Windows, membuka
// klien libsql baru setelah klien lain ditutup membuat modul native-nya
// segfault — pola yang sama dengan `attendance-dashboard.test.ts`.
const client: Client = createClient({ url: "file::memory:" });

beforeAll(async () => {
  await initDatabaseSchema(client);
});

beforeEach(async () => {
  await client.batch(
    [
      "DELETE FROM notifikasi_wa;",
      "DELETE FROM app_wa_config;",
      "DELETE FROM setting_gex_system WHERE key = 'wa_kirim_otomatis';",
    ],
    "write",
  );
});

afterEach(() => {
  globalThis.fetch = fetchAsli;
});

afterAll(() => client.close());

describe("klaim pengirim", () => {
  test("baris yang diklaim pengirim lain tidak disentuh; klaim basi diambil alih", async () => {
    await client.execute(
      `INSERT OR REPLACE INTO app_wa_config (id, provider, api_key, is_active, created_at, updated_at)
       VALUES ('default', 'fonnte', 'KUNCI', 1, datetime('now'), datetime('now'));`,
    );
    const baris = [
      ["bebas", "bolos", null, null],
      ["diklaim", "bolos", "hp-1", "datetime('now', '+5 minutes')"],
      ["basi", "bolos", "hp-2", "datetime('now', '-1 minutes')"],
      ["nonaktif", "scan_masuk", null, null],
    ] as const;
    for (const [id, jenis, oleh, sampai] of baris) {
      await client.execute({
        sql: `INSERT INTO notifikasi_wa (id_notifikasi, dedupe_key, jenis, tujuan_nomor, isi_pesan, created_at, updated_at, klaim_oleh, klaim_sampai)
              VALUES (?, ?, ?, '62812', 'Halo', datetime('now'), datetime('now'), ?, ${sampai ?? "NULL"});`,
        args: [id, `dedupe-${id}`, jenis, oleh],
      });
    }
    const terkirim: string[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      terkirim.push(String(init.body));
      return new Response(JSON.stringify({ status: true }));
    }) as unknown as typeof fetch;

    const hasil = await drainWaQueue(client, 25);

    expect(hasil.sent).toBe(2);
    expect(hasil.cancelled_disabled).toBe(1);
    expect(terkirim).toHaveLength(2);
    const status = await client.execute(
      "SELECT id_notifikasi, status, klaim_oleh FROM notifikasi_wa ORDER BY id_notifikasi;",
    );
    expect(
      status.rows.map((row) => [row.id_notifikasi, row.status, row.klaim_oleh]),
    ).toEqual([
      ["basi", "Terkirim", null],
      ["bebas", "Terkirim", null],
      ["diklaim", "Menunggu", "hp-1"],
      ["nonaktif", "Dibatalkan", null],
    ]);
  });
});

describe("kirim otomatis", () => {
  test("runner tidak mengirim apa pun selama sakelarnya mati; tombol manual tetap jalan", async () => {
    await client.execute(
      `INSERT OR REPLACE INTO app_wa_config (id, provider, api_key, is_active, created_at, updated_at)
       VALUES ('default', 'fonnte', 'KUNCI', 1, datetime('now'), datetime('now'));`,
    );
    const antre = (id: string) =>
      client.execute({
        sql: `INSERT INTO notifikasi_wa (id_notifikasi, dedupe_key, jenis, tujuan_nomor, isi_pesan, created_at, updated_at)
              VALUES (?, ?, 'bolos', '62812', 'Halo', datetime('now'), datetime('now'));`,
        args: [id, `dedupe-${id}`],
      });
    let panggilan = 0;
    globalThis.fetch = (async () => {
      panggilan++;
      return new Response(JSON.stringify({ status: true }));
    }) as unknown as typeof fetch;

    await antre("a");
    const mati = await drainWaQueue(client, 25, { otomatis: true });
    expect(mati.message).toBe("Kirim otomatis dimatikan.");
    expect(panggilan).toBe(0);

    const manual = await drainWaQueue(client, 25);
    expect(manual.sent).toBe(1);

    await client.execute(
      "INSERT INTO setting_gex_system (key, value) VALUES ('wa_kirim_otomatis', 'true');",
    );
    await antre("b");
    const hidup = await drainWaQueue(client, 25, { otomatis: true });
    expect(hidup.sent).toBe(1);
    expect(panggilan).toBe(2);
  });
});
