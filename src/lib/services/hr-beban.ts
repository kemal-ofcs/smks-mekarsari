import "server-only";

import type { Client, Row } from "@libsql/client";
import { ApiRequestError } from "@/lib/server/http/api-response";
import { tanggalValid } from "@/lib/validations/hari-kerja";
import {
  BEBAN_GURU_SQL,
  BEBAN_JADWAL_SQL,
  BEBAN_PENUGASAN_SQL,
  BEBAN_TUGAS_SQL,
  type DataBeban,
  type GuruBeban,
  IDENTITAS_PEGAWAI_SQL,
  type IdentitasPegawai,
  type JadwalBeban,
  KEPALA_UNIT_SQL,
  type KepalaUnit,
  PENGATURAN_SURAT_SQL,
  type PenugasanBeban,
  SEMESTER_SQL,
  type SemesterBeban,
  type SetupSurat,
  type TugasBeban,
  validasiPengaturanSurat,
} from "@/lib/validations/hr-beban";
import { STATUS_KINI_SQL } from "@/lib/validations/hris";
import { hariIni, pengaturanKontrak } from "./hris";
import { kopSekolah } from "./inventory";

// Cermin `teaching_load` di `desktop/hr_beban.rs`: data mentah saja, rekap
// disusun di layar (`susunBebanMengajar`).

const teks = (row: Row, kolom: string) => String(row[kolom] ?? "");
const angka = (row: Row, kolom: string) => Number(row[kolom] ?? 0);

/** `idTahunAjaran` kosong = semester aktif, lalu yang terbaru. */
export async function getBebanMengajar(
  client: Client,
  idTahunAjaran: string,
): Promise<DataBeban> {
  const semester: SemesterBeban[] = (
    await client.execute(SEMESTER_SQL)
  ).rows.map((r) => ({
    id_tahun_ajaran: teks(r, "id_tahun_ajaran"),
    nama_tahun: teks(r, "nama_tahun"),
    semester: teks(r, "semester"),
    tanggal_mulai: teks(r, "tanggal_mulai"),
    tanggal_selesai: teks(r, "tanggal_selesai"),
    is_aktif: angka(r, "is_aktif"),
  }));
  const pilihan = idTahunAjaran.trim();
  const dipilih =
    pilihan === ""
      ? (semester.find((s) => s.is_aktif === 1) ?? semester[0])
      : semester.find((s) => s.id_tahun_ajaran === pilihan);
  if (pilihan !== "" && !dipilih)
    throw new ApiRequestError("Semester tidak ditemukan.", 400);
  const pengaturan = await pengaturanKontrak(client);
  const batas = {
    min: pengaturan.berlaku.beban_min_jp,
    maks: pengaturan.berlaku.beban_maks_jp,
  };
  const hari = await hariIni(client);
  if (!dipilih)
    return {
      semester,
      id_tahun_ajaran: "",
      guru: [],
      jadwal: [],
      tugas: [],
      penugasan: [],
      status: [],
      batas,
      hari_ini: hari,
    };
  const id = dipilih.id_tahun_ajaran;
  const [guru, jadwal, tugas, penugasan, status] = await Promise.all([
    client.execute({ sql: BEBAN_GURU_SQL, args: [id] }),
    client.execute({ sql: BEBAN_JADWAL_SQL, args: [id] }),
    client.execute({
      sql: BEBAN_TUGAS_SQL,
      args: [dipilih.tanggal_mulai, dipilih.tanggal_selesai],
    }),
    client.execute({ sql: BEBAN_PENUGASAN_SQL, args: [id] }),
    client.execute({
      sql: STATUS_KINI_SQL,
      args: [dipilih.tanggal_selesai],
    }),
  ]);
  return {
    semester,
    id_tahun_ajaran: id,
    guru: guru.rows.map(
      (r): GuruBeban => ({
        id_unik: teks(r, "id_unik"),
        nama: teks(r, "nama"),
        gelar: teks(r, "gelar"),
        nip: teks(r, "nip"),
        nuptk: teks(r, "nuptk"),
        unit: teks(r, "unit"),
        aktif: angka(r, "aktif"),
      }),
    ),
    jadwal: jadwal.rows.map(
      (r): JadwalBeban => ({
        id_jadwal: teks(r, "id_jadwal"),
        id_guru: teks(r, "id_guru"),
        hari: angka(r, "hari"),
        jam_ke: teks(r, "jam_ke"),
        id_rombel: teks(r, "id_rombel"),
        nama_rombel: teks(r, "nama_rombel"),
        id_mapel: teks(r, "id_mapel"),
        nama_mapel: teks(r, "nama_mapel"),
        unit: teks(r, "unit"),
      }),
    ),
    tugas: tugas.rows.map(
      (r): TugasBeban => ({
        id_tugas: teks(r, "id_tugas"),
        id_karyawan: teks(r, "id_karyawan"),
        id_jenis: teks(r, "id_jenis"),
        nama_jenis: teks(r, "nama_jenis"),
        ekuivalen_jp: angka(r, "ekuivalen_jp"),
        unit: teks(r, "unit"),
        nama_rombel: teks(r, "nama_rombel"),
        nomor_sk: teks(r, "nomor_sk"),
        tanggal_sk: teks(r, "tanggal_sk"),
      }),
    ),
    penugasan: penugasan.rows.map(
      (r): PenugasanBeban => ({
        id_guru: teks(r, "id_guru"),
        id_rombel: teks(r, "id_rombel"),
        nama_rombel: teks(r, "nama_rombel"),
        id_mapel: teks(r, "id_mapel"),
        nama_mapel: teks(r, "nama_mapel"),
        beban_jam: angka(r, "beban_jam"),
      }),
    ),
    status: status.rows.map((r) => ({
      id_unik: teks(r, "id_unik"),
      status: teks(r, "status"),
    })),
    batas,
    hari_ini: hari,
  };
}

// HRIS Fase 3b: cermin `letter_setup` / `letter_settings_save` di
// `desktop/hr_beban.rs`.

async function pengaturanSurat(
  client: Client,
): Promise<Record<string, string>> {
  return Object.fromEntries(
    (await client.execute(PENGATURAN_SURAT_SQL)).rows.map((r) => [
      teks(r, "key"),
      teks(r, "value"),
    ]),
  );
}

/** Bahan surat pada `tanggal` (kosong = hari ini WIB). */
export async function getSetupSurat(
  client: Client,
  tanggal: string,
): Promise<SetupSurat> {
  const hari = await hariIni(client);
  const pilihan = tanggal.trim();
  if (pilihan !== "" && !tanggalValid(pilihan))
    throw new ApiRequestError("Tanggal surat tidak valid.", 400);
  const pada = pilihan || hari;
  const [kop, pengaturan, kepala, pegawai, status] = await Promise.all([
    kopSekolah(client),
    pengaturanSurat(client),
    client.execute({ sql: KEPALA_UNIT_SQL, args: [pada] }),
    client.execute(IDENTITAS_PEGAWAI_SQL),
    client.execute({ sql: STATUS_KINI_SQL, args: [pada] }),
  ]);
  return {
    kop,
    pengaturan,
    kepala: kepala.rows.map(
      (r): KepalaUnit => ({
        kunci_unit: teks(r, "kunci_unit"),
        unit: teks(r, "unit"),
        id_karyawan: teks(r, "id_karyawan"),
        nama: teks(r, "nama"),
        gelar: teks(r, "gelar"),
        nip: teks(r, "nip"),
      }),
    ),
    pegawai: pegawai.rows.map(
      (r): IdentitasPegawai => ({
        id_unik: teks(r, "id_unik"),
        nama: teks(r, "nama"),
        gelar: teks(r, "gelar"),
        nip: teks(r, "nip"),
        nuptk: teks(r, "nuptk"),
        jabatan: teks(r, "jabatan"),
        unit: teks(r, "unit"),
        tmt: teks(r, "tmt"),
        guru: angka(r, "guru"),
      }),
    ),
    status: status.rows.map((r) => ({
      id_unik: teks(r, "id_unik"),
      status: teks(r, "status"),
    })),
    tanggal: pada,
    hari_ini: hari,
  };
}

const UPSERT_SETTING_SQL =
  "INSERT INTO setting_gex_system (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value;";

/** Kedua belas kunci dalam satu batch atomik. */
export async function simpanPengaturanSurat(
  client: Client,
  draft: Record<string, string>,
): Promise<Record<string, string>> {
  const hasil = validasiPengaturanSurat(draft);
  if (!hasil.ok) throw new ApiRequestError(hasil.galat, 400);
  await client.batch(
    hasil.nilai.map(([key, value]) => ({
      sql: UPSERT_SETTING_SQL,
      args: [key, value],
    })),
    "write",
  );
  return pengaturanSurat(client);
}
