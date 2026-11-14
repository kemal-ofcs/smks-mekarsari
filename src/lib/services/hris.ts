import "server-only";

import type { Client, ResultSet, Row, Transaction } from "@libsql/client";
import type { z } from "zod";
import { hasPermission } from "@/lib/auth/access";
import type { OperatorUser } from "@/lib/auth/operator-user";
import type { PermissionKey } from "@/lib/rbac/catalog";
import { ApiRequestError } from "@/lib/server/http/api-response";
import {
  type BarisJenis,
  JENIS_SQL,
  samaOrang,
} from "@/lib/validations/hr-pengajuan";
import {
  AMBIL_BERKAS_SQL,
  AMBIL_LAMPIRAN_SQL,
  ATURAN_PERCOBAAN,
  ATURAN_PKWT,
  angkaPengaturan,
  BATAL_TUGAS_SQL,
  type BarisLampiran,
  type BarisPtk,
  BENTROK_BAGIAN_SQL,
  BENTROK_JABATAN_SQL,
  BENTROK_JENIS_DOKUMEN_SQL,
  BENTROK_JENIS_TUGAS_SQL,
  BERKAS_DOKUMEN_SQL,
  type BerkasDokumenBaris,
  batasBeban,
  type berkasDokumenSchema,
  CATAT_NAMA_BAGIAN_SQL,
  CERMIN_STATUS_SQL,
  type DaftarDokumen,
  type DaftarKontrak,
  type DaftarLampiran,
  type DaftarTugas,
  DOKUMEN_SQL,
  type DokumenBaris,
  type dokumenDraftSchema,
  GABUNG_BAGIAN_SQL,
  HAPUS_DOKUMEN_SQL,
  HAPUS_LAMPIRAN_SQL,
  HARI_INI_SQL,
  ID_WALI_KELAS,
  type IsiBerkasDokumen,
  idNamaBagian,
  JENIS_DOKUMEN_SQL,
  JENIS_TUGAS_SQL,
  type JenisDokumen,
  type JenisTugas,
  type JenisTugasDraft,
  type jenisDokumenDraftSchema,
  type KelompokProfil,
  KONTRAK_SQL,
  type KontrakBaris,
  type KontrakDraft,
  KUNCI_BEBAN_MAKS_JP,
  KUNCI_BEBAN_MIN_JP,
  KUNCI_PERCOBAAN_MAKS,
  KUNCI_PKWT_MAKS,
  type keuanganDraftSchema,
  LAMPIRAN_SQL,
  type LaporanPtk,
  type lampiranSchema,
  type MasterDraft,
  normalisasiNama,
  ORG_BAGIAN_NAMA_SQL,
  ORG_BAGIAN_SQL,
  ORG_JABATAN_SQL,
  ORG_PEGAWAI_SQL,
  type OrgKepegawaian,
  PEGAWAI_SQL,
  PEMILIK_LAMPIRAN_SQL,
  PENDIDIKAN_SQL,
  PENGAJUAN_LAMPIRAN_SQL,
  PENGATURAN_KONTRAK_SQL,
  PESAN_BERKAS_PENUH,
  PESAN_DOKUMEN_DITOLAK,
  PESAN_LAMPIRAN_DITOLAK,
  PESAN_LAMPIRAN_PENUH,
  PESAN_PEGAWAI_BELUM_DI_CLOUD,
  PESAN_PENGAJUAN_BELUM_DI_CLOUD,
  type PegawaiKepegawaian,
  type PendidikanBaris,
  type PengaturanKontrak,
  type PengaturanKontrakDraft,
  PROFIL_KEUANGAN_SQL,
  PROFIL_PRIBADI_SQL,
  type ProfilPegawai,
  PTK_SQL,
  type pendidikanDraftSchema,
  periksaAtasan,
  type pribadiDraftSchema,
  SERTIFIKASI_SQL,
  type SertifikasiBaris,
  SIMPAN_BAGIAN_SQL,
  SIMPAN_DOKUMEN_SQL,
  SIMPAN_JABATAN_SQL,
  SIMPAN_JENIS_DOKUMEN_SQL,
  SIMPAN_JENIS_TUGAS_SQL,
  SIMPAN_KEUANGAN_SQL,
  SIMPAN_KONTRAK_SQL,
  SIMPAN_PENDIDIKAN_SQL,
  SIMPAN_PRIBADI_SQL,
  SIMPAN_SERTIFIKASI_SQL,
  SIMPAN_TUGAS_SQL,
  STATUS_KINI_SQL,
  STATUS_PEMBATALAN,
  type sertifikasiDraftSchema,
  statusTugas,
  susunKontrak,
  susunOrg,
  TAHUN_AJARAN_SQL,
  TAMBAH_BERKAS_SQL,
  TAMBAH_LAMPIRAN_SQL,
  TUGAS_BERLAKU_SQL,
  TUGAS_SQL,
  TULIS_ULANG_BAGIAN_SQL,
  TULIS_ULANG_JABATAN_SQL,
  type TugasDraft,
  tandaLampiran,
  uraiBerkasDokumen,
  validasiAlasan,
  validasiAngkaPengaturan,
  validasiBatasBeban,
  validasiDokumen,
  validasiJenisTugas,
  validasiKeuangan,
  validasiKontrak,
  validasiNamaMaster,
  validasiPendidikan,
  validasiPribadi,
  validasiSertifikasi,
  validasiTugas,
  WALI_KELAS_SQL,
} from "@/lib/validations/hris";

// Cermin penulisan lokal `desktop/hris.rs`. Web menulis langsung ke database
// cloud; perangkat menerima hasilnya lewat tarikan (`sync_pulse`).

type Db = Client | Transaction;

const teks = (row: Row, kolom: string) => String(row[kolom] ?? "");

function galat(pesan: string): never {
  throw new ApiRequestError(pesan, 400);
}

function idBaru(awalan: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return (
    awalan + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}

async function ada(db: Db, sql: string, args: (string | number)[]) {
  return (await db.execute({ sql, args })).rows.length > 0;
}

export async function getOrg(client: Client): Promise<OrgKepegawaian> {
  const [pegawai, bagian, nama, jabatan] = await Promise.all(
    [ORG_PEGAWAI_SQL, ORG_BAGIAN_SQL, ORG_BAGIAN_NAMA_SQL, ORG_JABATAN_SQL].map(
      (sql) => client.execute(sql),
    ),
  );
  const daftar: PegawaiKepegawaian[] = pegawai.rows.map((r) => ({
    id_unik: teks(r, "id_unik"),
    kode_karyawan: teks(r, "kode_karyawan"),
    nama: teks(r, "nama"),
    unit: teks(r, "unit"),
    divisi: teks(r, "divisi"),
    jabatan_status: teks(r, "jabatan_status"),
    id_bagian: teks(r, "id_bagian"),
    id_jabatan: teks(r, "id_jabatan"),
    id_atasan: teks(r, "id_atasan"),
    status_aktif: teks(r, "status_aktif"),
    tmt: teks(r, "tmt"),
    kelompok: teks(r, "kelompok") === "Guru" ? "Guru" : "Tendik",
    status_kepegawaian: teks(r, "status_kepegawaian"),
  }));
  const master = (rows: Row[], kolom: string) =>
    rows.map((r) => ({
      id: teks(r, kolom),
      nama: teks(r, "nama"),
      is_aktif: Number(r.is_aktif ?? 1),
    }));
  const kini = await statusKini(client, await hariIni(client));
  for (const p of daftar) {
    const status = kini.get(p.id_unik);
    if (status !== undefined) p.status_kepegawaian = status;
  }
  return {
    ...susunOrg(
      daftar,
      master(bagian.rows, "id_bagian"),
      nama.rows.map((r) => ({
        id_bagian: teks(r, "id_bagian"),
        nama: teks(r, "nama"),
      })),
      master(jabatan.rows, "id_jabatan"),
    ),
    pegawai: daftar,
    jenis_tugas: await jenisTugas(client),
    jenis_pengajuan: (await client.execute(JENIS_SQL)).rows.map(
      (r) => ({ ...r }) as unknown as BarisJenis,
    ),
    pengaturan: await pengaturanKontrak(client),
  };
}

// Fase 1b: kontrak, tugas, pengaturan (cermin desktop/hris.rs)

export async function hariIni(db: Db): Promise<string> {
  return teks((await db.execute(HARI_INI_SQL)).rows[0], "hari_ini");
}

/** `STATUS_KINI_SQL` pada `tanggal`: id pegawai → status kepegawaian. */
export async function statusKini(
  db: Db,
  tanggal: string,
): Promise<Map<string, string>> {
  const rows = (await db.execute({ sql: STATUS_KINI_SQL, args: [tanggal] }))
    .rows;
  return new Map(rows.map((r) => [teks(r, "id_unik"), teks(r, "status")]));
}

/** `TUGAS_BERLAKU_SQL` pada [awal, akhir]: id pegawai → id jenis tugas. */
export async function tugasBerlaku(
  db: Db,
  awal: string,
  akhir: string,
): Promise<Map<string, string[]>> {
  const hasil = new Map<string, string[]>();
  for (const r of (
    await db.execute({ sql: TUGAS_BERLAKU_SQL, args: [awal, akhir] })
  ).rows) {
    const id = teks(r, "id_karyawan");
    hasil.set(id, [...(hasil.get(id) ?? []), teks(r, "id_jenis")]);
  }
  return hasil;
}

async function jenisTugas(db: Db): Promise<JenisTugas[]> {
  return (await db.execute(JENIS_TUGAS_SQL)).rows.map((r) => ({
    id_jenis: teks(r, "id_jenis"),
    nama: teks(r, "nama"),
    ekuivalen_jp: Number(r.ekuivalen_jp ?? 0),
    is_aktif: Number(r.is_aktif ?? 1),
  }));
}

/** Angka kontrak dan batas JP; cermin `pengaturan_kontrak`. */
export async function pengaturanKontrak(db: Db): Promise<PengaturanKontrak> {
  const nilai = new Map(
    (await db.execute(PENGATURAN_KONTRAK_SQL)).rows.map((r) => [
      teks(r, "key"),
      teks(r, "value"),
    ]),
  );
  const percobaan = nilai.get(KUNCI_PERCOBAAN_MAKS) ?? "";
  const pkwt = nilai.get(KUNCI_PKWT_MAKS) ?? "";
  const bebanMin = nilai.get(KUNCI_BEBAN_MIN_JP) ?? "";
  const bebanMaks = nilai.get(KUNCI_BEBAN_MAKS_JP) ?? "";
  const [min, maks] = batasBeban(bebanMin, bebanMaks);
  return {
    percobaan_maks_bulan: percobaan,
    pkwt_maks_bulan: pkwt,
    beban_min_jp: bebanMin,
    beban_maks_jp: bebanMaks,
    berlaku: {
      percobaan_maks_bulan: angkaPengaturan(percobaan, ATURAN_PERCOBAAN),
      pkwt_maks_bulan: angkaPengaturan(pkwt, ATURAN_PKWT),
      beban_min_jp: min,
      beban_maks_jp: maks,
    },
  };
}

const UPSERT_SETTING_SQL =
  "INSERT INTO setting_gex_system (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value;";

/** Pegawai (bukan siswa) yang ada; `true` bila punya `guru_data`. */
async function pegawaiGuru(db: Db, id: string): Promise<boolean | null> {
  const row = (
    await db.execute({
      sql: `SELECT EXISTS (SELECT 1 FROM guru_data WHERE id_guru = m.id_unik) AS guru FROM master_data m WHERE m.id_unik = ?1 AND ${PEGAWAI_SQL};`,
      args: [id],
    })
  ).rows[0];
  return row ? Number(row.guru) === 1 : null;
}

function kontrakBaris(r: Row): KontrakBaris {
  return {
    id_kontrak: teks(r, "id_kontrak"),
    id_karyawan: teks(r, "id_karyawan"),
    status: teks(r, "status"),
    id_ref: teks(r, "id_ref"),
    nomor: teks(r, "nomor"),
    tanggal_mulai: teks(r, "tanggal_mulai"),
    tanggal_selesai: teks(r, "tanggal_selesai"),
    percobaan_selesai: teks(r, "percobaan_selesai"),
    catatan: teks(r, "catatan"),
    dicatat_oleh: teks(r, "dicatat_oleh"),
    created_at: teks(r, "created_at"),
  };
}

export async function getKontrak(client: Client): Promise<DaftarKontrak> {
  const kontrak = (await client.execute(KONTRAK_SQL)).rows.map(kontrakBaris);
  const hari = await hariIni(client);
  const pengaturan = await pengaturanKontrak(client);
  return {
    ...susunKontrak(kontrak, hari, pengaturan.berlaku),
    kontrak,
    hari_ini: hari,
    pengaturan,
  };
}

async function tulisKontrak(tx: Transaction, k: KontrakBaris) {
  await tx.execute({
    sql: SIMPAN_KONTRAK_SQL,
    args: [
      k.id_kontrak,
      k.id_karyawan,
      k.status,
      k.id_ref,
      k.nomor,
      k.tanggal_mulai,
      k.tanggal_selesai,
      k.percobaan_selesai,
      k.catatan,
      k.dicatat_oleh,
    ],
  });
  await tx.execute({ sql: CERMIN_STATUS_SQL, args: [k.id_karyawan] });
}

export async function simpanKontrak(
  client: Client,
  oleh: string,
  draft: KontrakDraft,
) {
  const tx = await client.transaction("write");
  try {
    const guru = await pegawaiGuru(tx, draft.id_karyawan.trim());
    if (guru === null) galat("Kontrak hanya untuk pegawai (guru dan tendik).");
    const valid = validasiKontrak(
      {
        status: draft.status,
        nomor: draft.nomor ?? "",
        tanggal_mulai: draft.tanggal_mulai,
        tanggal_selesai: draft.tanggal_selesai ?? "",
        percobaan_selesai: draft.percobaan_selesai ?? "",
        catatan: draft.catatan ?? "",
      },
      guru,
    );
    if (!valid.ok) galat(valid.galat);
    const baris: KontrakBaris = {
      ...valid.nilai,
      id_kontrak: idBaru("kon-"),
      id_karyawan: draft.id_karyawan.trim(),
      id_ref: "",
      dicatat_oleh: oleh,
      created_at: "",
    };
    await tulisKontrak(tx, baris);
    await tx.commit();
    return baris;
  } finally {
    tx.close();
  }
}

export async function batalKontrak(
  client: Client,
  oleh: string,
  idKontrak: string,
  alasan: string,
) {
  const valid = validasiAlasan(alasan);
  if (!valid.ok) galat(valid.galat);
  const id = idKontrak.trim();
  const tx = await client.transaction("write");
  try {
    const asal = (
      await tx.execute({
        sql: "SELECT id_karyawan, tanggal_mulai FROM hr_kontrak WHERE id_kontrak = ?1 AND status <> 'Pembatalan';",
        args: [id],
      })
    ).rows[0];
    if (!asal) galat("Kontrak tidak ditemukan.");
    if (
      await ada(
        tx,
        "SELECT 1 FROM hr_kontrak WHERE status = 'Pembatalan' AND id_ref = ?1;",
        [id],
      )
    )
      galat("Kontrak ini sudah dibatalkan.");
    const baris: KontrakBaris = {
      id_kontrak: `batal-${id}`,
      id_karyawan: teks(asal, "id_karyawan"),
      status: STATUS_PEMBATALAN,
      id_ref: id,
      nomor: "",
      tanggal_mulai: teks(asal, "tanggal_mulai"),
      tanggal_selesai: "",
      percobaan_selesai: "",
      catatan: valid.nilai,
      dicatat_oleh: oleh,
      created_at: "",
    };
    await tulisKontrak(tx, baris);
    await tx.commit();
    return baris;
  } finally {
    tx.close();
  }
}

export async function simpanPengaturan(
  client: Client,
  draft: PengaturanKontrakDraft,
): Promise<PengaturanKontrak> {
  const percobaan = validasiAngkaPengaturan(
    draft.percobaan_maks_bulan,
    ATURAN_PERCOBAAN,
    "Masa percobaan",
  );
  if (!percobaan.ok) galat(percobaan.galat);
  const pkwt = validasiAngkaPengaturan(
    draft.pkwt_maks_bulan,
    ATURAN_PKWT,
    "Batas GTT/PTT",
  );
  if (!pkwt.ok) galat(pkwt.galat);
  const beban = validasiBatasBeban(draft.beban_min_jp, draft.beban_maks_jp);
  if (!beban.ok) galat(beban.galat);
  await client.batch(
    [
      {
        sql: UPSERT_SETTING_SQL,
        args: [KUNCI_PERCOBAAN_MAKS, percobaan.nilai],
      },
      { sql: UPSERT_SETTING_SQL, args: [KUNCI_PKWT_MAKS, pkwt.nilai] },
      { sql: UPSERT_SETTING_SQL, args: [KUNCI_BEBAN_MIN_JP, beban.nilai[0]] },
      { sql: UPSERT_SETTING_SQL, args: [KUNCI_BEBAN_MAKS_JP, beban.nilai[1]] },
    ],
    "write",
  );
  return pengaturanKontrak(client);
}

/** Kunci `pajak_status_tidak_tetap` dari centang kartu konstanta pajak. */
export async function simpanSetting(
  client: Client,
  key: string,
  value: string,
) {
  await client.execute({ sql: UPSERT_SETTING_SQL, args: [key, value] });
}

export async function simpanJenisTugas(client: Client, draft: JenisTugasDraft) {
  const valid = validasiJenisTugas({
    nama: draft.nama,
    ekuivalen_jp: draft.ekuivalen_jp,
  });
  if (!valid.ok) galat(valid.galat);
  const isAktif = draft.is_aktif ?? 1;
  const tx = await client.transaction("write");
  try {
    let id = draft.id?.trim() ?? "";
    if (id) {
      if (
        !(await ada(tx, "SELECT 1 FROM hr_tugas_jenis WHERE id_jenis = ?1;", [
          id,
        ]))
      )
        galat("Jenis tugas tidak ditemukan.");
    } else {
      id = idBaru("tgs-");
    }
    if (await ada(tx, BENTROK_JENIS_TUGAS_SQL, [valid.nilai.nama, id]))
      galat(`Nama "${valid.nilai.nama}" sudah dipakai jenis tugas lain.`);
    await tx.execute({
      sql: SIMPAN_JENIS_TUGAS_SQL,
      args: [id, valid.nilai.nama, valid.nilai.ekuivalen_jp, isAktif],
    });
    await tx.commit();
    return {
      id_jenis: id,
      nama: valid.nilai.nama,
      ekuivalen_jp: valid.nilai.ekuivalen_jp,
      is_aktif: isAktif,
    };
  } finally {
    tx.close();
  }
}

export async function getTugas(client: Client): Promise<DaftarTugas> {
  const hari = await hariIni(client);
  const [tugas, wali, tahun] = await Promise.all(
    [TUGAS_SQL, WALI_KELAS_SQL, TAHUN_AJARAN_SQL].map((sql) =>
      client.execute(sql),
    ),
  );
  return {
    jenis: await jenisTugas(client),
    tugas: tugas.rows.map((r) => {
      const baris = {
        id_tugas: teks(r, "id_tugas"),
        id_karyawan: teks(r, "id_karyawan"),
        id_jenis: teks(r, "id_jenis"),
        unit: teks(r, "unit"),
        tahun_ajaran: teks(r, "tahun_ajaran"),
        id_rombel: teks(r, "id_rombel"),
        nomor_sk: teks(r, "nomor_sk"),
        tanggal_sk: teks(r, "tanggal_sk"),
        ekuivalen_jp: r.ekuivalen_jp === null ? null : Number(r.ekuivalen_jp),
        tanggal_mulai: teks(r, "tanggal_mulai"),
        tanggal_selesai: teks(r, "tanggal_selesai"),
        dicatat_oleh: teks(r, "dicatat_oleh"),
        dibatalkan_pada: teks(r, "dibatalkan_pada"),
        dibatalkan_oleh: teks(r, "dibatalkan_oleh"),
        alasan_batal: teks(r, "alasan_batal"),
      };
      return { ...baris, status: statusTugas(baris, hari) };
    }),
    wali_kelas: wali.rows.map((r) => ({
      id_rombel: teks(r, "id_rombel"),
      nama_rombel: teks(r, "nama_rombel"),
      id_wali_kelas: teks(r, "id_wali_kelas"),
      nama_tahun: teks(r, "nama_tahun"),
      semester: teks(r, "semester"),
      tanggal_mulai: teks(r, "tanggal_mulai"),
      tanggal_selesai: teks(r, "tanggal_selesai"),
    })),
    tahun_ajaran: tahun.rows.map((r) => ({
      nama_tahun: teks(r, "nama_tahun"),
      tanggal_mulai: teks(r, "tanggal_mulai"),
      tanggal_selesai: teks(r, "tanggal_selesai"),
    })),
    hari_ini: hari,
  };
}

export async function simpanTugas(
  client: Client,
  oleh: string,
  draft: TugasDraft,
) {
  const valid = validasiTugas({
    id_karyawan: draft.id_karyawan,
    id_jenis: draft.id_jenis,
    unit: draft.unit ?? "",
    tahun_ajaran: draft.tahun_ajaran,
    id_rombel: draft.id_rombel ?? "",
    nomor_sk: draft.nomor_sk ?? "",
    tanggal_sk: draft.tanggal_sk ?? "",
    ekuivalen_jp: draft.ekuivalen_jp ?? null,
    tanggal_mulai: draft.tanggal_mulai,
    tanggal_selesai: draft.tanggal_selesai ?? "",
  });
  if (!valid.ok) galat(valid.galat);
  const t = valid.nilai;
  const idLama = draft.id?.trim() ?? "";
  const tx = await client.transaction("write");
  try {
    let jenisLama: string | null = null;
    if (idLama) {
      const lama = (
        await tx.execute({
          sql: "SELECT id_jenis, dibatalkan_pada FROM hr_tugas_tambahan WHERE id_tugas = ?1;",
          args: [idLama],
        })
      ).rows[0];
      if (!lama) galat("Tugas tidak ditemukan.");
      if (lama.dibatalkan_pada !== null)
        galat("Tugas yang sudah dibatalkan tidak bisa diubah.");
      jenisLama = teks(lama, "id_jenis");
    }
    if ((await pegawaiGuru(tx, t.id_karyawan)) === null)
      galat("Tugas tambahan hanya untuk pegawai (guru dan tendik).");
    const jenis = (
      await tx.execute({
        sql: "SELECT nama, is_aktif FROM hr_tugas_jenis WHERE id_jenis = ?1;",
        args: [t.id_jenis],
      })
    ).rows[0];
    if (!jenis) galat("Jenis tugas tidak ditemukan.");
    if (Number(jenis.is_aktif) !== 1 && jenisLama !== t.id_jenis)
      galat(`Jenis tugas "${teks(jenis, "nama")}" sudah nonaktif.`);
    if (
      t.id_jenis === ID_WALI_KELAS &&
      !(await ada(
        tx,
        "SELECT 1 FROM akademik_rombel WHERE id_rombel = ?1 AND id_wali_kelas = ?2;",
        [t.id_rombel, t.id_karyawan],
      ))
    )
      galat("Rombel ini tidak berwali pegawai tersebut.");
    const id = idLama || idBaru("tgt-");
    await tx.execute({
      sql: SIMPAN_TUGAS_SQL,
      args: [
        id,
        t.id_karyawan,
        t.id_jenis,
        t.unit,
        t.tahun_ajaran,
        t.id_rombel,
        t.nomor_sk,
        t.tanggal_sk,
        t.ekuivalen_jp,
        t.tanggal_mulai,
        t.tanggal_selesai,
        oleh,
      ],
    });
    await tx.commit();
    return { id_tugas: id, ...t, dicatat_oleh: oleh };
  } finally {
    tx.close();
  }
}

export async function batalTugas(
  client: Client,
  oleh: string,
  idTugas: string,
  alasan: string,
) {
  const valid = validasiAlasan(alasan);
  if (!valid.ok) galat(valid.galat);
  const id = idTugas.trim();
  const tx = await client.transaction("write");
  try {
    const lama = (
      await tx.execute({
        sql: "SELECT dibatalkan_pada FROM hr_tugas_tambahan WHERE id_tugas = ?1;",
        args: [id],
      })
    ).rows[0];
    if (!lama) galat("Tugas tidak ditemukan.");
    if (lama.dibatalkan_pada !== null) galat("Tugas ini sudah dibatalkan.");
    await tx.execute({ sql: BATAL_TUGAS_SQL, args: [id, oleh, valid.nilai] });
    await tx.commit();
    return { id_tugas: id, dibatalkan_oleh: oleh, alasan_batal: valid.nilai };
  } finally {
    tx.close();
  }
}

export async function simpanBagian(client: Client, draft: MasterDraft) {
  const valid = validasiNamaMaster(draft.nama, "bagian");
  if (!valid.ok) galat(valid.galat);
  const isAktif = draft.is_aktif ?? 1;
  const tx = await client.transaction("write");
  try {
    let id = draft.id?.trim() ?? "";
    if (id) {
      if (
        !(await ada(tx, "SELECT 1 FROM hr_bagian WHERE id_bagian = ?1;", [id]))
      )
        galat("Bagian tidak ditemukan.");
    } else {
      id = idBaru("bag-");
    }
    if (await ada(tx, BENTROK_BAGIAN_SQL, [valid.nama, id])) {
      galat(
        `Nama "${valid.nama}" sudah dipakai bagian lain (nama sekarang atau nama lamanya).`,
      );
    }
    await tx.execute({
      sql: SIMPAN_BAGIAN_SQL,
      args: [id, valid.nama, isAktif],
    });
    await tx.execute({
      sql: CATAT_NAMA_BAGIAN_SQL,
      args: [idNamaBagian(id, valid.nama), id, valid.nama],
    });
    for (const sql of TULIS_ULANG_BAGIAN_SQL) {
      await tx.execute({ sql, args: [id] });
    }
    await tx.commit();
    return { id_bagian: id, nama: valid.nama, is_aktif: isAktif };
  } finally {
    tx.close();
  }
}

export async function gabungBagian(
  client: Client,
  idAsal: string,
  idTujuan: string,
) {
  const asal = idAsal.trim();
  const tujuan = idTujuan.trim();
  if (!asal || !tujuan || asal === tujuan)
    galat("Pilih dua bagian yang berbeda.");
  const tx = await client.transaction("write");
  try {
    if (
      !(await ada(tx, "SELECT 1 FROM hr_bagian WHERE id_bagian = ?1;", [asal]))
    )
      galat("Bagian asal tidak ditemukan.");
    if (
      !(await ada(
        tx,
        "SELECT 1 FROM hr_bagian WHERE id_bagian = ?1 AND is_aktif = 1;",
        [tujuan],
      ))
    )
      galat("Bagian tujuan harus bagian aktif.");
    for (const sql of GABUNG_BAGIAN_SQL) {
      await tx.execute({ sql, args: [asal, tujuan] });
    }
    for (const sql of TULIS_ULANG_BAGIAN_SQL) {
      await tx.execute({ sql, args: [tujuan] });
    }
    await tx.commit();
    return { id_asal: asal, id_tujuan: tujuan };
  } finally {
    tx.close();
  }
}

export async function simpanJabatan(client: Client, draft: MasterDraft) {
  const valid = validasiNamaMaster(draft.nama, "jabatan");
  if (!valid.ok) galat(valid.galat);
  const isAktif = draft.is_aktif ?? 1;
  const tx = await client.transaction("write");
  try {
    let id = draft.id?.trim() ?? "";
    if (id) {
      if (
        !(await ada(tx, "SELECT 1 FROM hr_jabatan WHERE id_jabatan = ?1;", [
          id,
        ]))
      )
        galat("Jabatan tidak ditemukan.");
    } else {
      id = idBaru("jab-");
    }
    if (await ada(tx, BENTROK_JABATAN_SQL, [valid.nama, id])) {
      galat(`Nama "${valid.nama}" sudah dipakai jabatan lain.`);
    }
    await tx.execute({
      sql: SIMPAN_JABATAN_SQL,
      args: [id, valid.nama, isAktif],
    });
    await tx.execute({ sql: TULIS_ULANG_JABATAN_SQL, args: [id] });
    await tx.commit();
    return { id_jabatan: id, nama: valid.nama, is_aktif: isAktif };
  } finally {
    tx.close();
  }
}

export interface OrganisasiValid {
  id_bagian: string;
  divisi: string;
  id_jabatan: string;
  jabatan_status: string;
  id_atasan: string;
}

/**
 * Pilihan bagian/jabatan/atasan dari form Karyawan dan Guru; cermin
 * `periksa_organisasi`. Master baru wajib aktif; master nonaktif yang SUDAH
 * dipegang orang itu boleh tetap. Tanpa `id_bagian`, teks `divisi` berlaku.
 */
export async function periksaOrganisasi(
  db: Db,
  idKaryawan: string,
  draft: {
    divisi?: string | null;
    jabatan_status?: string | null;
    id_bagian?: string | null;
    id_jabatan?: string | null;
    id_atasan?: string | null;
  },
  bagianWajib: boolean,
): Promise<OrganisasiValid> {
  const lama = (
    await db.execute({
      sql: "SELECT COALESCE(id_bagian, '') AS id_bagian, COALESCE(id_jabatan, '') AS id_jabatan FROM master_data WHERE id_unik = ?1;",
      args: [idKaryawan],
    })
  ).rows[0];
  const hasil: OrganisasiValid = {
    id_bagian: "",
    divisi: normalisasiNama(draft.divisi ?? ""),
    id_jabatan: "",
    jabatan_status: normalisasiNama(draft.jabatan_status ?? ""),
    id_atasan: "",
  };
  const idBagian = draft.id_bagian?.trim() ?? "";
  if (!idBagian) {
    if (bagianWajib) galat("Bagian wajib dipilih.");
  } else {
    const b = (
      await db.execute({
        sql: "SELECT nama, is_aktif FROM hr_bagian WHERE id_bagian = ?1;",
        args: [idBagian],
      })
    ).rows[0];
    if (!b) galat("Bagian tidak ditemukan.");
    if (Number(b.is_aktif) !== 1 && idBagian !== String(lama?.id_bagian ?? ""))
      galat(`Bagian "${teks(b, "nama")}" sudah nonaktif.`);
    hasil.id_bagian = idBagian;
    hasil.divisi = teks(b, "nama");
  }
  const idJabatan = draft.id_jabatan?.trim() ?? "";
  if (idJabatan) {
    const j = (
      await db.execute({
        sql: "SELECT nama, is_aktif FROM hr_jabatan WHERE id_jabatan = ?1;",
        args: [idJabatan],
      })
    ).rows[0];
    if (!j) galat("Jabatan tidak ditemukan.");
    if (
      Number(j.is_aktif) !== 1 &&
      idJabatan !== String(lama?.id_jabatan ?? "")
    )
      galat(`Jabatan "${teks(j, "nama")}" sudah nonaktif.`);
    hasil.id_jabatan = idJabatan;
    hasil.jabatan_status = teks(j, "nama");
  }
  const idAtasan = draft.id_atasan?.trim() ?? "";
  if (idAtasan) {
    if (
      !(await ada(
        db,
        `SELECT 1 FROM master_data m WHERE m.id_unik = ?1 AND ${PEGAWAI_SQL};`,
        [idAtasan],
      ))
    )
      galat("Atasan harus pegawai yang terdaftar.");
    const peta = new Map(
      (
        await db.execute(
          "SELECT id_unik, COALESCE(id_atasan, '') AS id_atasan FROM master_data WHERE COALESCE(id_atasan, '') <> ''\n-- batas: pegawai yang punya atasan, dibatasi jumlah personil lembaga\n;",
        )
      ).rows.map((r) => [teks(r, "id_unik"), teks(r, "id_atasan")]),
    );
    const salah = periksaAtasan(idKaryawan, idAtasan, peta);
    if (salah) galat(salah);
    hasil.id_atasan = idAtasan;
  }
  return hasil;
}

/** Kolom organisasi satu pegawai di cloud; kosong = NULL. */
export async function tulisOrganisasi(
  db: Db,
  idKaryawan: string,
  org: OrganisasiValid,
) {
  await db.execute({
    sql: "UPDATE master_data SET id_bagian = NULLIF(?2, ''), id_jabatan = NULLIF(?3, ''), id_atasan = NULLIF(?4, '') WHERE id_unik = ?1;",
    args: [idKaryawan, org.id_bagian, org.id_jabatan, org.id_atasan],
  });
}

// ── HRIS 1c: data cloud-only (kembar `desktop/hris_cloud.rs`) ──
//
// Web menulis langsung ke database cloud; tabel ini tidak pernah tersalin ke
// perangkat, jadi tidak ada outbox.

function objek(hasil: ResultSet): Record<string, unknown>[] {
  return hasil.rows.map((row) =>
    Object.fromEntries(hasil.columns.map((kolom) => [kolom, row[kolom]])),
  );
}

function ambilValid<T>(
  hasil: { ok: true; nilai: T } | { ok: false; galat: string },
): T {
  if (!hasil.ok) galat(hasil.galat);
  return hasil.nilai;
}

async function tulisPegawai(
  client: Client,
  sql: string,
  args: (string | number | null)[],
  pesan = PESAN_PEGAWAI_BELUM_DI_CLOUD,
) {
  const hasil = await client.execute({ sql, args });
  if (hasil.rowsAffected === 0) galat(pesan);
}

export async function getProfil(
  client: Client,
  idKaryawan: string,
  kelompok: KelompokProfil,
): Promise<ProfilPegawai> {
  const id = idKaryawan.trim();
  const baca = async (sql: string) =>
    objek(await client.execute({ sql, args: [id] }));
  const profil: ProfilPegawai = { id_karyawan: id };
  if (kelompok.pribadi) {
    profil.pribadi = ((await baca(PROFIL_PRIBADI_SQL))[0] ??
      null) as unknown as ProfilPegawai["pribadi"];
  }
  if (kelompok.keuangan) {
    profil.keuangan = ((await baca(PROFIL_KEUANGAN_SQL))[0] ??
      null) as unknown as ProfilPegawai["keuangan"];
  }
  if (kelompok.pendidik) {
    profil.pendidik = {
      pendidikan: (await baca(PENDIDIKAN_SQL)) as unknown as PendidikanBaris[],
      sertifikasi: (await baca(
        SERTIFIKASI_SQL,
      )) as unknown as SertifikasiBaris[],
    };
  }
  return profil;
}

export async function simpanPribadi(
  client: Client,
  operator: string,
  draft: z.output<typeof pribadiDraftSchema>,
) {
  const p = ambilValid(validasiPribadi(draft));
  await tulisPegawai(client, SIMPAN_PRIBADI_SQL, [
    draft.id_karyawan,
    p.nik,
    p.no_kk,
    p.tempat_lahir,
    p.tanggal_lahir,
    p.agama,
    p.status_nikah,
    p.nama_ibu_kandung,
    p.alamat_ktp,
    p.alamat_domisili,
    p.darurat_nama,
    p.darurat_hubungan,
    p.darurat_hp,
    operator,
  ]);
  return { sukses: true };
}

export async function simpanKeuangan(
  client: Client,
  operator: string,
  draft: z.output<typeof keuanganDraftSchema>,
) {
  const k = ambilValid(validasiKeuangan(draft));
  await tulisPegawai(client, SIMPAN_KEUANGAN_SQL, [
    draft.id_karyawan,
    k.bank,
    k.no_rekening,
    k.nama_rekening,
    k.npwp,
    k.bpjs_kesehatan,
    k.bpjs_ketenagakerjaan,
    operator,
  ]);
  return { sukses: true };
}

const idAtauBaru = (id: string | undefined, awalan: string) =>
  id?.trim() || idBaru(awalan);

export async function simpanPendidikan(
  client: Client,
  operator: string,
  draft: z.output<typeof pendidikanDraftSchema>,
) {
  const p = ambilValid(validasiPendidikan(draft));
  const id = idAtauBaru(draft.id, "pdk-");
  await tulisPegawai(client, SIMPAN_PENDIDIKAN_SQL, [
    id,
    draft.id_karyawan,
    p.jenjang,
    p.prodi,
    p.perguruan_tinggi,
    p.tahun_lulus,
    p.linier,
    p.catatan,
    operator,
  ]);
  return { id_pendidikan: id };
}

export async function simpanSertifikasi(
  client: Client,
  operator: string,
  draft: z.output<typeof sertifikasiDraftSchema>,
) {
  const s = ambilValid(validasiSertifikasi(draft));
  const id = idAtauBaru(draft.id, "srt-");
  await tulisPegawai(client, SIMPAN_SERTIFIKASI_SQL, [
    id,
    draft.id_karyawan,
    s.nomor_sertifikat,
    s.nrg,
    s.tahun,
    s.bidang_studi,
    s.catatan,
    operator,
  ]);
  return { id_sertifikasi: id };
}

/** Hapus satu baris cloud-only berdasarkan id (pendidikan, sertifikat, berkas). */
export async function hapusBaris(client: Client, sql: string, id: string) {
  await client.execute({ sql, args: [id.trim()] });
  return { sukses: true };
}

export async function getDokumen(
  client: Client,
  idKaryawan: string,
): Promise<DaftarDokumen> {
  const id = idKaryawan.trim();
  const jenis = objek(
    await client.execute(JENIS_DOKUMEN_SQL),
  ) as unknown as JenisDokumen[];
  if (id === "") return { jenis };
  const [dokumen, berkas] = await Promise.all([
    client.execute({ sql: DOKUMEN_SQL, args: [id] }),
    client.execute({ sql: BERKAS_DOKUMEN_SQL, args: [id] }),
  ]);
  return {
    jenis,
    dokumen: objek(dokumen) as unknown as DokumenBaris[],
    berkas: objek(berkas) as unknown as BerkasDokumenBaris[],
  };
}

export async function getBerkasDokumen(
  client: Client,
  idBerkas: string,
): Promise<IsiBerkasDokumen> {
  const baris = objek(
    await client.execute({ sql: AMBIL_BERKAS_SQL, args: [idBerkas.trim()] }),
  )[0];
  if (!baris) throw new ApiRequestError("Berkas tidak ditemukan.", 404);
  return baris as unknown as IsiBerkasDokumen;
}

export async function simpanDokumen(
  client: Client,
  operator: string,
  draft: z.output<typeof dokumenDraftSchema>,
) {
  const d = ambilValid(validasiDokumen(draft));
  const id = idAtauBaru(draft.id, "dok-");
  await tulisPegawai(
    client,
    SIMPAN_DOKUMEN_SQL,
    [
      id,
      draft.id_karyawan,
      d.id_jenis,
      d.nomor,
      d.tanggal_terbit,
      d.tanggal_kedaluwarsa,
      d.catatan,
      operator,
    ],
    PESAN_DOKUMEN_DITOLAK,
  );
  return { id_dokumen: id };
}

/** Dokumen dihapus sungguhan bersama berkasnya dalam satu transaksi. */
export async function hapusDokumen(client: Client, idDokumen: string) {
  const id = idDokumen.trim();
  await client.batch(
    HAPUS_DOKUMEN_SQL.map((sql) => ({ sql, args: [id] })),
    "write",
  );
  return { sukses: true };
}

export async function tambahBerkasDokumen(
  client: Client,
  draft: z.output<typeof berkasDokumenSchema>,
) {
  const berkas = ambilValid(
    uraiBerkasDokumen(draft.nama_berkas, draft.mime_type, draft.data_base64),
  );
  const id = idBaru("dkb-");
  await tulisPegawai(
    client,
    TAMBAH_BERKAS_SQL,
    [
      id,
      draft.id_dokumen.trim(),
      berkas.nama_berkas,
      berkas.mime_type,
      berkas.data_base64,
    ],
    PESAN_BERKAS_PENUH,
  );
  return { id_berkas: id };
}

export async function simpanJenisDokumen(
  client: Client,
  draft: z.output<typeof jenisDokumenDraftSchema>,
) {
  const valid = validasiNamaMaster(draft.nama, "jenis dokumen");
  if (!valid.ok) galat(valid.galat);
  const aktif = draft.is_aktif === 0 ? 0 : 1;
  const id = idAtauBaru(draft.id, "dok-");
  if (
    aktif === 1 &&
    (await ada(client, BENTROK_JENIS_DOKUMEN_SQL, [valid.nama, id]))
  )
    galat("Jenis dokumen dengan nama itu sudah ada.");
  await client.execute({
    sql: SIMPAN_JENIS_DOKUMEN_SQL,
    args: [id, valid.nama, aktif],
  });
  return { id_jenis: id };
}

export async function getLaporanPtk(client: Client): Promise<LaporanPtk> {
  const hari = await hariIni(client);
  const [status, ptk] = await Promise.all([
    client.execute({ sql: STATUS_KINI_SQL, args: [hari] }),
    client.execute(PTK_SQL),
  ]);
  const kini = new Map(
    status.rows.map((r) => [teks(r, "id_unik"), teks(r, "status")]),
  );
  return {
    hari_ini: hari,
    baris: objek(ptk).map((b) => ({
      ...b,
      status: kini.get(String(b.id_unik)) ?? "",
    })) as unknown as BarisPtk[],
  };
}

// Lampiran pengajuan (HRIS Fase 2 §20.3, Q-51), cermin `hris_cloud.rs`.

/** Cermin `boleh_ubah_lampiran`: pengaju atau pemegang izin pemutus jenis. */
function bolehUbahLampiran(operator: OperatorUser, baris: Row | undefined) {
  if (!baris) return false;
  return (
    samaOrang(teks(baris, "diajukan_oleh"), operator.username) ||
    hasPermission(operator, teks(baris, "izin_pemutus") as PermissionKey)
  );
}

export async function getLampiran(
  client: Client,
  operator: OperatorUser,
  idPengajuan: string,
): Promise<DaftarLampiran> {
  const id = idPengajuan.trim();
  const [pengajuan, berkas] = await Promise.all([
    client.execute({ sql: PENGAJUAN_LAMPIRAN_SQL, args: [id] }),
    client.execute({ sql: LAMPIRAN_SQL, args: [id] }),
  ]);
  const p = pengajuan.rows[0];
  if (!p) return { ada: false, boleh_ubah: false, berkas: [], tanda: [] };
  const daftar = objek(berkas) as unknown as BarisLampiran[];
  return {
    ada: true,
    boleh_ubah: bolehUbahLampiran(operator, p),
    tanda: tandaLampiran(Number(p.wajib_dokumen ?? 0) === 1, daftar.length),
    berkas: daftar,
  };
}

export async function getIsiLampiran(
  client: Client,
  idBerkas: string,
): Promise<IsiBerkasDokumen> {
  const baris = objek(
    await client.execute({ sql: AMBIL_LAMPIRAN_SQL, args: [idBerkas.trim()] }),
  )[0];
  if (!baris) throw new ApiRequestError("Berkas tidak ditemukan.", 404);
  return baris as unknown as IsiBerkasDokumen;
}

export async function tambahLampiran(
  client: Client,
  operator: OperatorUser,
  draft: z.output<typeof lampiranSchema>,
) {
  const berkas = ambilValid(
    uraiBerkasDokumen(draft.nama_berkas, draft.mime_type, draft.data_base64),
  );
  const id = draft.id_pengajuan.trim();
  const p = (await client.execute({ sql: PENGAJUAN_LAMPIRAN_SQL, args: [id] }))
    .rows[0];
  if (!p) galat(PESAN_PENGAJUAN_BELUM_DI_CLOUD);
  if (!bolehUbahLampiran(operator, p)) galat(PESAN_LAMPIRAN_DITOLAK);
  const idBerkas = idBaru("pgb-");
  await tulisPegawai(
    client,
    TAMBAH_LAMPIRAN_SQL,
    [
      idBerkas,
      id,
      berkas.nama_berkas,
      berkas.mime_type,
      berkas.data_base64,
      operator.username,
    ],
    PESAN_LAMPIRAN_PENUH,
  );
  return { id_berkas: idBerkas };
}

export async function hapusLampiran(
  client: Client,
  operator: OperatorUser,
  idBerkas: string,
) {
  const id = idBerkas.trim();
  const pemilik = (
    await client.execute({ sql: PEMILIK_LAMPIRAN_SQL, args: [id] })
  ).rows[0];
  if (!pemilik) throw new ApiRequestError("Berkas tidak ditemukan.", 404);
  if (!bolehUbahLampiran(operator, pemilik)) galat(PESAN_LAMPIRAN_DITOLAK);
  return hapusBaris(client, HAPUS_LAMPIRAN_SQL, id);
}
