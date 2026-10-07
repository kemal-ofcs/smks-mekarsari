import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { initDatabaseSchema } from "@/lib/db-schema";

mock.module("server-only", () => ({}));
const { recordMutation, saveItem } = await import("./inventory");
const { deleteVisit, listVisits, openVisit, saveVisit, visitMedicines } =
  await import("./uks");

// Berkas sungguhan: transaksi libSQL lokal membuka koneksi baru, dan database
// memori di koneksi baru selalu kosong.
let client: Client;
let testDirectory: string;

beforeAll(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "kos-uks-web-"));
  client = createClient({ url: `file:${join(testDirectory, "test.db")}` });
  await initDatabaseSchema(client);
  await client.batch(
    [
      `INSERT INTO akademik_tahun_ajaran (id_tahun_ajaran, nama_tahun, semester, tanggal_mulai, tanggal_selesai, is_aktif, created_at, updated_at)
       VALUES ('ta', '2026/2027', 'Ganjil', '2026-07-01', '2026-12-31', 1, '2026-07-01', '2026-07-01');`,
      `INSERT INTO akademik_rombel (id_rombel, id_tahun_ajaran, tingkat, nama_rombel, kapasitas, is_aktif)
       VALUES ('r-10a', 'ta', 10, 'X-A', 36, 1);`,
      `INSERT INTO master_data (id_unik, kode_karyawan, nama, divisi, status_aktif, id_shift, jenis_personil)
       VALUES ('sis-1', 'S-1', 'Budi', 'Siswa', 'Aktif', 1, 'SISWA');`,
      `INSERT INTO siswa_data (id_siswa, nama_lengkap, id_rombel, angkatan, created_at, updated_at)
       VALUES ('sis-1', 'Budi', 'r-10a', 2026, '2026-07-01', '2026-07-01');`,
    ],
    "write",
  );
});

beforeEach(async () => {
  await client.batch(
    [
      "DELETE FROM uks_kunjungan;",
      "DELETE FROM inventory_mutasi;",
      "DELETE FROM inventory_barang;",
    ],
    "write",
  );
});

afterAll(async () => {
  client.close();
  await Bun.sleep(50);
  try {
    rmSync(testDirectory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EBUSY"
    ) {
      throw error;
    }
  }
});

async function obatUks(): Promise<{ idBarang: string; batch: string }> {
  const { id_barang: idBarang } = await saveItem(client, {
    nama_barang: "Paracetamol",
    tipe: "Habis Pakai",
    satuan: "tablet",
    bisa_expired: true,
    tempat_utama: "UKS",
  });
  const { id_mutasi: batch } = await recordMutation(client, "admin", {
    id_barang: idBarang,
    jenis: "Masuk",
    alasan: "Pengadaan",
    jumlah: 10,
    tempat_tujuan: "UKS",
    tanggal_expired: "2027-06-30",
  });
  return { idBarang, batch };
}

// Skenario kembar dengan tes di `desktop/uks.rs`.
describe("service kunjungan UKS Web", () => {
  test("buka dengan obat lalu tutup", async () => {
    const { idBarang, batch } = await obatUks();
    const { id_kunjungan: id } = await openVisit(client, "petugas-uks", {
      id_personil: "sis-1",
      keluhan: "Pusing",
      jam_masuk: "08:30",
      obat: [
        { id_barang: idBarang, tempat: "UKS", id_batch: batch, jumlah: 2 },
      ],
    });
    const awal = await client.execute({
      sql: "SELECT kelas, nama_personil FROM uks_kunjungan WHERE id_kunjungan = ?;",
      args: [id],
    });
    expect(awal.rows[0]?.kelas).toBe("X-A");
    expect(awal.rows[0]?.nama_personil).toBe("Budi");

    // Nama siswa TIDAK masuk mutasi inventaris yang tersalin ke semua perangkat.
    const mutasi = await client.execute(
      "SELECT penerima_nama, keperluan, id_ref FROM inventory_mutasi WHERE alasan = 'Pemakaian';",
    );
    expect(mutasi.rows[0]?.penerima_nama).toBe("UKS");
    expect(mutasi.rows[0]?.keperluan).toBe("Kunjungan UKS");
    expect(mutasi.rows[0]?.id_ref).toBe(id);
    expect((await visitMedicines(client, id)).obat[0]?.jumlah).toBe(2);

    const tutup = await saveVisit(client, "petugas-uks", id, {
      jam_keluar: "09:10",
      tindakan: "Istirahat",
      tindak_lanjut: "Kembali ke kelas",
    });
    expect(tutup.ditutup).toBe(true);
    const daftar = await listVisits(client, "2000-01-01", "2999-12-31", null);
    expect(daftar.sedang).toHaveLength(0);
    expect(daftar.baris[0]?.ditutup_oleh).toBe("petugas-uks");
    expect(daftar.offline).toBe(false);
  });

  // Kembar `closing_queues_one_wali_message_only_when_switched_on`.
  test("menutup mengantre satu pesan wali hanya bila sakelar menyala", async () => {
    await client.batch(
      [
        "DELETE FROM notifikasi_wa;",
        "DELETE FROM setting_gex_system WHERE key = 'wa_notify_uks';",
        "UPDATE siswa_data SET no_whatsapp_wali = '081234567890' WHERE id_siswa = 'sis-1';",
      ],
      "write",
    );
    const antrean = async () =>
      Number(
        (
          await client.execute(
            "SELECT COUNT(*) AS n FROM notifikasi_wa WHERE jenis = 'uks';",
          )
        ).rows[0]?.n,
      );

    const mati = await openVisit(client, "admin", {
      id_personil: "sis-1",
      keluhan: "Demam",
      jam_masuk: "08:00",
    });
    const hasilMati = await saveVisit(client, "admin", mati.id_kunjungan, {
      jam_keluar: "09:00",
      tindak_lanjut: "Pulang",
      kabari_wali: true,
    });
    expect(hasilMati.wa_diantre).toBe(false);
    expect(await antrean()).toBe(0);

    await client.execute(
      "INSERT INTO setting_gex_system (key, value) VALUES ('wa_notify_uks', 'true');",
    );
    const { id_kunjungan: id } = await openVisit(client, "admin", {
      id_personil: "sis-1",
      keluhan: "Demam",
      jam_masuk: "08:00",
    });
    const hasil = await saveVisit(client, "admin", id, {
      jam_keluar: "09:00",
      tindak_lanjut: "Pulang dijemput ayah",
      kabari_wali: true,
    });
    expect(hasil.wa_diantre).toBe(true);
    const baris = await client.execute(
      "SELECT isi_pesan, dedupe_key FROM notifikasi_wa WHERE jenis = 'uks';",
    );
    expect(baris.rows[0]?.dedupe_key).toBe(`uks:${id}`);
    expect(String(baris.rows[0]?.isi_pesan)).toContain("Pulang dijemput ayah");
    expect(String(baris.rows[0]?.isi_pesan)).not.toContain("Demam");

    // Menyimpan ulang kunjungan yang sudah ditutup tidak mengantre lagi.
    const ulang = await saveVisit(client, "admin", id, {
      jam_keluar: "09:00",
      tindak_lanjut: "Pulang",
      kabari_wali: true,
    });
    expect(ulang.wa_diantre).toBeNull();
    expect(await antrean()).toBe(1);
  });

  test("stok obat kurang membatalkan seluruh kunjungan", async () => {
    const { idBarang, batch } = await obatUks();
    await expect(
      openVisit(client, "petugas-uks", {
        id_personil: "sis-1",
        keluhan: "Pusing",
        obat: [
          { id_barang: idBarang, tempat: "UKS", id_batch: batch, jumlah: 99 },
        ],
      }),
    ).rejects.toThrow("Stok di UKS");
    const jumlah = await client.execute(
      "SELECT COUNT(*) AS n FROM uks_kunjungan;",
    );
    expect(Number(jumlah.rows[0]?.n)).toBe(0);
  });

  test("jam keluar sebelum jam masuk ditolak dan hapus tidak menyentuh stok", async () => {
    const { idBarang, batch } = await obatUks();
    const { id_kunjungan: id } = await openVisit(client, "admin", {
      id_personil: "sis-1",
      keluhan: "Luka",
      jam_masuk: "10:00",
      obat: [
        { id_barang: idBarang, tempat: "UKS", id_batch: batch, jumlah: 1 },
      ],
    });
    await expect(
      saveVisit(client, "admin", id, {
        jam_keluar: "09:00",
        tindak_lanjut: "Pulang",
      }),
    ).rejects.toThrow("Jam keluar tidak boleh lebih awal dari jam masuk.");
    await deleteVisit(client, id);
    const obatTetap = await client.execute(
      "SELECT COUNT(*) AS n FROM inventory_mutasi WHERE alasan = 'Pemakaian';",
    );
    expect(Number(obatTetap.rows[0]?.n)).toBe(1);
    await expect(deleteVisit(client, id)).rejects.toThrow(
      "Kunjungan tidak ditemukan.",
    );
  });
});
