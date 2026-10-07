import "server-only";

import { randomUUID } from "node:crypto";
import type { Client, Row, Transaction } from "@libsql/client";
import {
  listInventory,
  listRecipients,
  recordMutationTx,
} from "@/lib/services/inventory";
import { queueWaliNotification } from "@/lib/services/wa-notification";
import type { BarangInventaris } from "@/lib/validations/inventory";
import { isValidDate, mutasiDraftSchema } from "@/lib/validations/inventory";
import {
  bukaDraftSchema,
  type DaftarKunjunganUks,
  isValidJam,
  type KunjunganUks,
  MAKS_BARIS_RIWAYAT,
  MAKS_SEDANG_DI_UKS,
  type ObatKunjungan,
  obatKeMutasi,
  simpanDraftSchema,
  validateBuka,
  validateSimpan,
} from "@/lib/validations/uks";
import { WA_NOTIFY_UKS_KEY } from "@/lib/validations/wa-notification";

/**
 * Cermin Web dari `desktop/uks.rs`. Web menulis langsung ke cloud, jadi tidak
 * ada salinan lokal: setiap baris berstatus `lokal` (bisa diubah) dan tidak
 * pernah `belum_terkirim`.
 */

const KOLOM =
  "id_kunjungan, id_personil, nama_personil, kelas, tanggal, jam_masuk, jam_keluar, keluhan, tindakan, tindak_lanjut, catatan, dicatat_oleh, ditutup_oleh, created_at, updated_at";

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function rowToKunjungan(row: Row): KunjunganUks {
  return {
    id_kunjungan: String(row.id_kunjungan),
    id_personil: String(row.id_personil),
    nama_personil: String(row.nama_personil),
    kelas: text(row.kelas),
    tanggal: String(row.tanggal),
    jam_masuk: String(row.jam_masuk),
    jam_keluar: text(row.jam_keluar),
    keluhan: String(row.keluhan),
    tindakan: text(row.tindakan),
    tindak_lanjut: text(row.tindak_lanjut),
    catatan: text(row.catatan),
    dicatat_oleh: String(row.dicatat_oleh),
    ditutup_oleh: text(row.ditutup_oleh),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    lokal: true,
    belum_terkirim: false,
  };
}

async function withTransaction<T>(
  client: Client,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const tx = await client.transaction("write");
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

async function beriObat(
  tx: Transaction,
  dicatatOleh: string,
  idKunjungan: string,
  obat: ReturnType<typeof bukaDraftSchema.parse>["obat"],
) {
  for (const item of obat) {
    await recordMutationTx(
      tx,
      dicatatOleh,
      mutasiDraftSchema.parse(obatKeMutasi(item)),
      idKunjungan,
    );
  }
}

function cocokCari(row: KunjunganUks, cari: string): boolean {
  if (!cari) return true;
  return [row.nama_personil, row.kelas, row.keluhan, row.tindak_lanjut].some(
    (value) => value?.toLowerCase().includes(cari),
  );
}

/** Cermin `list_visits`. */
export async function listVisits(
  client: Client,
  dari: string,
  sampai: string,
  cari: string | null,
): Promise<DaftarKunjunganUks> {
  if (!isValidDate(dari) || !isValidDate(sampai)) {
    throw new Error("Rentang tanggal tidak valid.");
  }
  if (dari > sampai) {
    throw new Error("Tanggal awal tidak boleh setelah tanggal akhir.");
  }
  const kata = (cari ?? "").trim().toLowerCase();
  const riwayat = await client.execute({
    sql: `SELECT ${KOLOM} FROM uks_kunjungan WHERE tanggal >= ? AND tanggal <= ?
          ORDER BY tanggal DESC, jam_masuk DESC LIMIT 501;`,
    args: [dari, sampai],
  });
  const sedang = await client.execute(
    `SELECT ${KOLOM} FROM uks_kunjungan WHERE jam_keluar IS NULL
     ORDER BY tanggal DESC, jam_masuk DESC LIMIT 200;`,
  );
  return {
    baris: riwayat.rows
      .slice(0, MAKS_BARIS_RIWAYAT)
      .map(rowToKunjungan)
      .filter((row) => cocokCari(row, kata)),
    sedang: sedang.rows
      .slice(0, MAKS_SEDANG_DI_UKS)
      .map(rowToKunjungan)
      .filter((row) => cocokCari(row, kata)),
    offline: false,
    detik_sejak_sync: null,
    terpotong: riwayat.rows.length > MAKS_BARIS_RIWAYAT,
  };
}

/** Cermin `form_data`. */
export async function formData(client: Client): Promise<{
  personil: Awaited<ReturnType<typeof listRecipients>>["personil"];
  barang: BarangInventaris[];
  tindak_lanjut: string[];
  hari_ini: string;
  wa_uks_aktif: boolean;
}> {
  const penerima = await listRecipients(client);
  const stok = await listInventory(client);
  const saran = await client.execute(
    `SELECT tindak_lanjut FROM uks_kunjungan
     WHERE tindak_lanjut IS NOT NULL
     GROUP BY tindak_lanjut
     ORDER BY MAX(updated_at) DESC
     LIMIT 20;`,
  );
  // Kotak centang WA hanya tampil bila sakelarnya menyala; belum ditulis = MATI.
  const sakelar = await client.execute({
    sql: "SELECT value FROM setting_gex_system WHERE key = ?;",
    args: [WA_NOTIFY_UKS_KEY],
  });
  return {
    personil: penerima.personil,
    barang: stok.barang,
    tindak_lanjut: saran.rows.map((row) => String(row.tindak_lanjut)),
    hari_ini: stok.hari_ini,
    wa_uks_aktif:
      String(sakelar.rows[0]?.value ?? "")
        .trim()
        .toLowerCase() === "true",
  };
}

/** Cermin `open_visit`. */
export async function openVisit(
  client: Client,
  dicatatOleh: string,
  rawDraft: unknown,
): Promise<{ sukses: true; id_kunjungan: string }> {
  const parsed = bukaDraftSchema.safeParse(rawDraft);
  if (!parsed.success) throw new Error("Data kunjungan tidak valid.");
  return withTransaction(client, async (tx) => {
    const hari = await tx.execute("SELECT date('now', '+7 hours') AS hari;");
    const checked = validateBuka(parsed.data, String(hari.rows[0]?.hari ?? ""));
    if (!checked.ok) throw new Error(checked.error);
    const valid = checked.value;
    const personil = await tx.execute({
      sql: `SELECT m.nama, r.nama_rombel
            FROM master_data m
            LEFT JOIN siswa_data s ON s.id_siswa = m.id_unik
            LEFT JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
            WHERE m.id_unik = ?;`,
      args: [valid.id_personil],
    });
    const orang = personil.rows[0];
    if (!orang) throw new Error("Personil tidak ditemukan.");
    const id = `uks-${randomUUID().replaceAll("-", "")}`;
    await tx.execute({
      sql: `INSERT INTO uks_kunjungan (
              id_kunjungan, id_personil, nama_personil, kelas, tanggal, jam_masuk, keluhan,
              catatan, dicatat_oleh, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, COALESCE(?5, date('now', '+7 hours')),
                      COALESCE(?6, strftime('%H:%M', 'now', '+7 hours')), ?7, ?8, ?9,
                      datetime('now'), datetime('now'));`,
      args: [
        id,
        valid.id_personil,
        String(orang.nama),
        text(orang.nama_rombel),
        valid.tanggal,
        valid.jam_masuk,
        valid.keluhan,
        valid.catatan,
        dicatatOleh,
      ],
    });
    await beriObat(tx, dicatatOleh, id, parsed.data.obat);
    return { sukses: true as const, id_kunjungan: id };
  });
}

/** Cermin `save_visit`. */
export async function saveVisit(
  client: Client,
  operator: string,
  idKunjungan: string,
  rawDraft: unknown,
): Promise<{ sukses: true; ditutup: boolean; wa_diantre: boolean | null }> {
  const parsed = simpanDraftSchema.safeParse(rawDraft);
  if (!parsed.success) throw new Error("Data kunjungan tidak valid.");
  const id = idKunjungan.trim();
  return withTransaction(client, async (tx) => {
    const row = await tx.execute({
      sql: `SELECT jam_masuk, id_personil, tanggal, keluhan, jam_keluar IS NOT NULL AS sudah_ditutup
            FROM uks_kunjungan WHERE id_kunjungan = ?;`,
      args: [id],
    });
    const kunjungan = row.rows[0];
    const jamMasuk = text(kunjungan?.jam_masuk);
    if (jamMasuk === null || !isValidJam(jamMasuk)) {
      throw new Error("Kunjungan tidak ditemukan.");
    }
    const checked = validateSimpan(parsed.data, jamMasuk);
    if (!checked.ok) throw new Error(checked.error);
    const valid = checked.value;
    await tx.execute({
      sql: `UPDATE uks_kunjungan SET
              tindakan = ?2,
              tindak_lanjut = ?3,
              catatan = ?4,
              jam_keluar = COALESCE(?5, jam_keluar),
              ditutup_oleh = CASE WHEN ?5 IS NOT NULL THEN COALESCE(ditutup_oleh, ?6) ELSE ditutup_oleh END,
              updated_at = datetime('now')
            WHERE id_kunjungan = ?1;`,
      args: [
        id,
        valid.tindakan,
        valid.tindak_lanjut,
        valid.catatan,
        valid.jam_keluar,
        operator,
      ],
    });
    await beriObat(tx, operator, id, parsed.data.obat);

    // Cermin save_visit: diantrekan di transaksi penutupan yang sama, paling
    // banyak satu pesan per kunjungan (dedupe `uks:<id>`).
    const jamKeluar = valid.jam_keluar;
    const sudahDitutup = Number(kunjungan?.sudah_ditutup ?? 0) === 1;
    const waDiantre =
      jamKeluar !== null && parsed.data.kabari_wali && !sudahDitutup
        ? await queueWaliNotification(
            tx,
            "uks",
            String(kunjungan?.id_personil ?? ""),
            `uks:${id}`,
            () => ({
              tanggal: String(kunjungan?.tanggal ?? ""),
              jam_masuk: jamMasuk,
              jam_keluar: jamKeluar,
              tindak_lanjut: valid.tindak_lanjut ?? "",
              keluhan: String(kunjungan?.keluhan ?? ""),
            }),
          )
        : null;
    return {
      sukses: true as const,
      ditutup: jamKeluar !== null,
      wa_diantre: waDiantre,
    };
  });
}

/** Cermin `delete_visit`. Mutasi obatnya tidak ikut terhapus. */
export async function deleteVisit(
  client: Client,
  idKunjungan: string,
): Promise<{ sukses: true }> {
  const result = await client.execute({
    sql: "DELETE FROM uks_kunjungan WHERE id_kunjungan = ?;",
    args: [idKunjungan.trim()],
  });
  if (result.rowsAffected === 0) throw new Error("Kunjungan tidak ditemukan.");
  return { sukses: true };
}

/** Cermin `visit_medicines`. */
export async function visitMedicines(
  client: Client,
  idKunjungan: string,
): Promise<{ obat: ObatKunjungan[] }> {
  const result = await client.execute({
    sql: `SELECT m.id_mutasi, b.nama_barang, m.jumlah, b.satuan, m.tanggal,
                 EXISTS(SELECT 1 FROM inventory_mutasi x WHERE x.id_mutasi = 'batal-' || m.id_mutasi) AS dibatalkan
          FROM inventory_mutasi m
          JOIN inventory_barang b ON b.id_barang = m.id_barang
          WHERE m.id_ref = ? AND m.alasan = 'Pemakaian'
          ORDER BY m.created_at
          LIMIT 100;`,
    args: [idKunjungan.trim()],
  });
  return {
    obat: result.rows.map((row) => ({
      id_mutasi: String(row.id_mutasi),
      nama_barang: String(row.nama_barang),
      jumlah: Number(row.jumlah),
      satuan: String(row.satuan),
      tanggal: String(row.tanggal),
      dibatalkan: Number(row.dibatalkan) === 1,
    })),
  };
}
