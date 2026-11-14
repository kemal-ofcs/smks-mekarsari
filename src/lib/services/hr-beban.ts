import "server-only";

import type { Client, Row } from "@libsql/client";
import { ApiRequestError } from "@/lib/server/http/api-response";
import {
  BEBAN_GURU_SQL,
  BEBAN_JADWAL_SQL,
  BEBAN_PENUGASAN_SQL,
  BEBAN_TUGAS_SQL,
  type DataBeban,
  type GuruBeban,
  type JadwalBeban,
  type PenugasanBeban,
  SEMESTER_SQL,
  type SemesterBeban,
  type TugasBeban,
} from "@/lib/validations/hr-beban";
import { STATUS_KINI_SQL } from "@/lib/validations/hris";
import { hariIni, pengaturanKontrak } from "./hris";

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
