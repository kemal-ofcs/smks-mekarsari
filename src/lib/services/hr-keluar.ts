import "server-only";

import type { Client, Row } from "@libsql/client";
import { hasPermission } from "@/lib/auth/access";
import type { OperatorUser } from "@/lib/auth/operator-user";
import type { PermissionKey } from "@/lib/rbac/catalog";
import { ApiRequestError } from "@/lib/server/http/api-response";
import {
  akhirMasaSp,
  CABUT_SP_SQL,
  type DaftarSp,
  type HasilSimpanSp,
  MAKS_TEKS_SP,
  MASA_SP_SQL,
  masaSpBerlaku,
  NOMOR_KEMBAR_SQL,
  PEGAWAI_SP_SQL,
  PESAN_SP_DICABUT,
  periksaTingkat,
  periksaWewenangSp,
  SIMPAN_SP_SQL,
  SP_PEGAWAI_SQL,
  SP_SATU_SQL,
  type SpBaris,
  type SpDraft,
  type SpRingkas,
  statusSp,
  type TingkatSp,
  UBAH_SP_SQL,
  usulanTingkat,
  validasiSp,
} from "@/lib/validations/hr-keluar";
import {
  dalamCakupan,
  UNIT_PERSONIL_SQL,
} from "@/lib/validations/hr-pengajuan";
import {
  HARI_INI_SQL,
  PESAN_PEGAWAI_BELUM_DI_CLOUD,
} from "@/lib/validations/hris";

// Cermin I/O cloud `desktop/hr_keluar.rs`. Tabelnya cloud-only, jadi Web dan
// Desktop menulis ke database yang sama tanpa outbox.

const teks = (row: Row | undefined, kolom: string) =>
  String(row?.[kolom] ?? "");

function galat(pesan: string): never {
  throw new ApiRequestError(pesan, 400);
}

function idBaru(awalan: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return (
    awalan + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}

const punya = (operator: OperatorUser, izin: PermissionKey) =>
  hasPermission(operator, izin);
const tautan = (operator: OperatorUser) => (operator.idKaryawan ?? "").trim();

async function satu(client: Client, sql: string, args: string[] = []) {
  return (await client.execute({ sql, args })).rows[0];
}

async function hariIni(client: Client) {
  return teks(await satu(client, HARI_INI_SQL), "hari_ini");
}

async function masaSp(client: Client) {
  const baris = await satu(client, MASA_SP_SQL);
  return masaSpBerlaku(baris ? teks(baris, "value") : null);
}

/** "Diri sendiri" dan cakupan unit dari SESI, cermin `wewenang`. */
async function wewenang(
  client: Client,
  operator: OperatorUser,
  idKaryawan: string,
  unitSasaran: string,
  tingkat: string,
) {
  const sesi = tautan(operator);
  const unitAkun =
    sesi === ""
      ? ""
      : teks(await satu(client, UNIT_PERSONIL_SQL, [sesi]), "unit");
  const cek = periksaWewenangSp(
    tingkat,
    sesi !== "" && sesi === idKaryawan,
    dalamCakupan(punya(operator, "hr.scope.all"), unitAkun, unitSasaran),
    punya(operator, "hr.warning.sp3"),
  );
  if (!cek.ok) galat(cek.galat);
}

const ringkas = (rows: Row[]): SpRingkas[] =>
  rows.map((r) => ({
    tingkat: teks(r, "tingkat"),
    tanggal: teks(r, "tanggal"),
    berlaku_sampai: teks(r, "berlaku_sampai"),
    dicabut: teks(r, "dicabut_pada") !== "",
  }));

/** Cermin `daftar_sp`. */
export async function daftarSp(
  client: Client,
  idKaryawan: string,
): Promise<DaftarSp> {
  const id = idKaryawan.trim();
  if (!id) galat("Pegawai wajib dipilih.");
  const hari = await hariIni(client);
  const rows = (await client.execute({ sql: SP_PEGAWAI_SQL, args: [id] })).rows;
  const sp: SpBaris[] = rows.map((r) => {
    const baris = Object.fromEntries(
      Object.keys(r)
        .filter((k) => Number.isNaN(Number(k)))
        .map((k) => [k, teks(r, k)]),
    );
    return {
      ...(baris as unknown as SpBaris),
      tingkat: teks(r, "tingkat") as TingkatSp,
      usulan_tingkat: teks(r, "usulan_tingkat") as TingkatSp,
      masa_bulan: Number(r.masa_bulan ?? 0),
      status: statusSp(
        teks(r, "tanggal"),
        teks(r, "berlaku_sampai"),
        teks(r, "dicabut_pada") !== "",
        hari,
      ),
    };
  });
  return {
    sp,
    usulan: usulanTingkat(ringkas(rows), hari),
    masa_bulan: await masaSp(client),
    hari_ini: hari,
  };
}

async function nomorKembar(client: Client, nomor: string | null, idSp: string) {
  if (!nomor) return false;
  const r = await satu(client, NOMOR_KEMBAR_SQL, [nomor, idSp]);
  return Number(r?.jumlah ?? 0) > 0;
}

/** Cermin `simpan_sp`: SP baru, atau ubah teks SP yang belum dicabut. */
export async function simpanSp(
  client: Client,
  operator: OperatorUser,
  draft: SpDraft,
): Promise<HasilSimpanSp> {
  const hari = await hariIni(client);
  const cek = validasiSp(draft, hari);
  if (!cek.ok) galat(cek.galat);
  const sah = cek.nilai;
  if (sah.id_sp) {
    const lama = await satu(client, SP_SATU_SQL, [sah.id_sp]);
    if (!lama) galat("SP tidak ditemukan.");
    if (teks(lama, "dicabut_pada") !== "") galat(PESAN_SP_DICABUT);
    if (
      teks(lama, "id_karyawan") !== sah.id_karyawan ||
      teks(lama, "tingkat") !== sah.tingkat ||
      teks(lama, "tanggal") !== sah.tanggal
    ) {
      galat(
        "Tingkat dan tanggal SP tidak bisa diubah. Cabut SP ini lalu buat yang baru.",
      );
    }
    await wewenang(
      client,
      operator,
      sah.id_karyawan,
      teks(lama, "unit"),
      sah.tingkat,
    );
    const hasil = await client.execute({
      sql: UBAH_SP_SQL,
      args: [
        sah.id_sp,
        sah.nomor,
        sah.pelanggaran,
        sah.harapan,
        sah.penanda_nama,
        sah.penanda_jabatan,
        sah.penanda_nip,
        operator.username,
      ],
    });
    if (hasil.rowsAffected === 0) galat(PESAN_SP_DICABUT);
    return {
      sukses: true,
      id_sp: sah.id_sp,
      nomor_kembar: await nomorKembar(client, sah.nomor, sah.id_sp),
    };
  }
  const pegawai = await satu(client, PEGAWAI_SP_SQL, [sah.id_karyawan]);
  if (!pegawai) galat(PESAN_PEGAWAI_BELUM_DI_CLOUD);
  const unit = teks(pegawai, "unit");
  await wewenang(client, operator, sah.id_karyawan, unit, sah.tingkat);
  if (teks(pegawai, "status_aktif") !== "Aktif")
    galat("SP hanya untuk pegawai aktif.");
  const masuk = teks(pegawai, "tanggal_daftar");
  if (masuk !== "" && sah.tanggal < masuk)
    galat("Tanggal SP tidak boleh sebelum tanggal masuk pegawai.");
  const riwayat = (
    await client.execute({ sql: SP_PEGAWAI_SQL, args: [sah.id_karyawan] })
  ).rows;
  const usulan = usulanTingkat(ringkas(riwayat), sah.tanggal).tingkat;
  const tingkat = periksaTingkat(sah.tingkat, usulan, sah.alasan_tingkat);
  if (!tingkat.ok) galat(tingkat.galat);
  const masaBulan = await masaSp(client);
  const berlakuSampai = akhirMasaSp(sah.tanggal, masaBulan);
  if (!berlakuSampai) galat("Tanggal SP tidak valid.");
  const idSp = idBaru("sp-");
  await client.execute({
    sql: SIMPAN_SP_SQL,
    args: [
      idSp,
      sah.id_karyawan,
      sah.tingkat,
      usulan,
      sah.tingkat !== usulan ? sah.alasan_tingkat : null,
      sah.tanggal,
      masaBulan,
      berlakuSampai,
      sah.nomor,
      sah.pelanggaran,
      sah.harapan,
      sah.penanda_nama,
      sah.penanda_jabatan,
      sah.penanda_nip,
      unit,
      operator.username,
    ],
  });
  return {
    sukses: true,
    id_sp: idSp,
    nomor_kembar: await nomorKembar(client, sah.nomor, idSp),
  };
}

/** Cermin `cabut_sp`: dengan alasan, sekali. */
export async function cabutSp(
  client: Client,
  operator: OperatorUser,
  idSp: string,
  alasan: string,
) {
  const id = idSp.trim();
  const isi = alasan.trim();
  if (!isi) galat("Alasan pencabutan wajib diisi.");
  if ([...isi].length > MAKS_TEKS_SP)
    galat(`Alasan pencabutan maksimal ${MAKS_TEKS_SP} karakter.`);
  const lama = await satu(client, SP_SATU_SQL, [id]);
  if (!lama) galat("SP tidak ditemukan.");
  if (teks(lama, "dicabut_pada") !== "") galat(PESAN_SP_DICABUT);
  await wewenang(
    client,
    operator,
    teks(lama, "id_karyawan"),
    teks(lama, "unit"),
    "",
  );
  const hasil = await client.execute({
    sql: CABUT_SP_SQL,
    args: [id, operator.username, isi],
  });
  if (hasil.rowsAffected === 0) galat(PESAN_SP_DICABUT);
  return { sukses: true as const };
}
