import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as H from "./hris";
import vektor from "./hris.vektor.json";

// Vektor yang sama diuji di `desktop/hris.rs` (modul `tests`).

const peta = (isi: object) =>
  new Map(Object.entries(isi as Record<string, string>));

describe("hris: aturan kembar", () => {
  test("nama: normalisasi, kunci, validasi", () => {
    for (const k of vektor.nama) {
      expect(H.normalisasiNama(k.masuk)).toBe(k.normal);
      expect(H.kunciNama(k.masuk)).toBe(k.kunci);
      const hasil = H.validasiNamaMaster(k.masuk, "bagian");
      expect(hasil.ok ? null : hasil.galat).toBe(k.galat);
      if (hasil.ok) expect(hasil.nama).toBe(k.normal);
    }
  });

  test("id nama bagian", () => {
    for (const k of vektor.id_nama) {
      expect(H.idNamaBagian(k.id_bagian, k.nama)).toBe(k.hasil);
    }
  });

  test("atasan dan siklus", () => {
    for (const k of vektor.atasan) {
      expect(H.periksaAtasan(k.id, k.atasan_baru, peta(k.peta))).toBe(k.galat);
    }
    for (const k of vektor.siklus) {
      expect(H.dalamSiklusAtasan(peta(k.peta))).toEqual(k.hasil);
    }
  });

  test("susun organisasi", () => {
    for (const k of vektor.susun) {
      expect(H.susunOrg(k.pegawai, k.bagian, k.nama_lama, k.jabatan)).toEqual(
        k.hasil,
      );
    }
  });

  test("SQL disalin harfiah ke hris.rs (Desktop dan Mobile)", () => {
    const sql: string[] = [
      H.PEGAWAI_SQL,
      ...H.MIGRASI_ORGANISASI_SQL,
      H.SIMPAN_BAGIAN_SQL,
      H.CATAT_NAMA_BAGIAN_SQL,
      H.SIMPAN_JABATAN_SQL,
      ...H.TULIS_ULANG_BAGIAN_SQL,
      H.TULIS_ULANG_JABATAN_SQL,
      ...H.GABUNG_BAGIAN_SQL,
      H.PETA_BAGIAN_SQL,
      H.PETA_JABATAN_SQL,
      H.BENTROK_BAGIAN_SQL,
      H.BENTROK_JABATAN_SQL,
      H.ORG_PEGAWAI_SQL,
      H.ORG_BAGIAN_SQL,
      H.ORG_BAGIAN_NAMA_SQL,
      H.ORG_JABATAN_SQL,
      H.STATUS_KINI_SQL,
      H.CERMIN_STATUS_SQL,
      H.BERKONTRAK_SQL,
      H.SIMPAN_KONTRAK_SQL,
      H.KONTRAK_SQL,
      H.PENGATURAN_KONTRAK_SQL,
      H.HARI_INI_SQL,
      H.SIMPAN_JENIS_TUGAS_SQL,
      H.BENTROK_JENIS_TUGAS_SQL,
      H.JENIS_TUGAS_SQL,
      H.SIMPAN_TUGAS_SQL,
      H.BATAL_TUGAS_SQL,
      H.TUGAS_BERLAKU_SQL,
      H.TUGAS_SQL,
      H.WALI_KELAS_SQL,
      H.TAHUN_AJARAN_SQL,
      H.KUNCI_PERCOBAAN_MAKS,
      H.KUNCI_PKWT_MAKS,
      H.ID_WALI_KELAS,
    ];
    let diperiksa = 0;
    for (const dir of ["desktop", "mobile"]) {
      const lokasi = [
        join(import.meta.dir, `../../../src-tauri/src/${dir}/hris.rs`),
        join(
          import.meta.dir,
          `../../../../mobile/src-tauri/src/${dir}/hris.rs`,
        ),
      ].find(existsSync);
      if (!lokasi) continue;
      diperiksa++;
      const rust = readFileSync(lokasi, "utf8").replace(/\s+/g, "");
      for (const teks of sql) {
        expect(rust).toContain(JSON.stringify(teks).replace(/\s+/g, ""));
      }
      expect(rust).toContain(`NAMA_MAKS:usize=${H.NAMA_MAKS};`);
      expect(rust).toContain(
        `STATUS_KONTRAK:[&str;${H.STATUS_KONTRAK.length}]=${JSON.stringify(H.STATUS_KONTRAK).replace(/\s+/g, "")};`,
      );
      for (const [nama, aturan] of [
        ["PERCOBAAN", H.ATURAN_PERCOBAAN],
        ["PKWT", H.ATURAN_PKWT],
      ] as const) {
        expect(rust).toContain(
          `ATURAN_${nama}:Aturan=Aturan{bawaan:${aturan.bawaan},min:${aturan.min},maks:${aturan.maks}};`,
        );
      }
    }
    expect(diperiksa).toBeGreaterThan(0);
  });
});

// Baris kontrak ringkas di vektor: [id, pegawai, status, id_ref, mulai, selesai, percobaan].
const kontrak = (baris: string[][]): H.KontrakBaris[] =>
  baris.map(([id, pegawai, status, ref, mulai, selesai, percobaan]) => ({
    id_kontrak: id,
    id_karyawan: pegawai,
    status,
    id_ref: ref,
    nomor: "",
    tanggal_mulai: mulai,
    tanggal_selesai: selesai,
    percobaan_selesai: percobaan,
    catatan: "",
    dicatat_oleh: "",
    created_at: "",
  }));

const aturanDari = (nama: string) =>
  nama === "percobaan" ? H.ATURAN_PERCOBAAN : H.ATURAN_PKWT;

describe("hris: kontrak dan tugas (kembar hris.rs)", () => {
  test("validasi kontrak dan alasan", () => {
    for (const k of vektor.kontrak) {
      const hasil = H.validasiKontrak(
        { ...vektor.kontrak_dasar, ...k.ubah },
        k.guru,
      );
      expect(hasil.ok ? null : hasil.galat).toBe(k.galat);
      if (hasil.ok) expect(hasil.nilai).toEqual(k.hasil as H.KontrakIsian);
    }
    for (const [masuk, nilai, galat] of vektor.alasan) {
      const hasil = H.validasiAlasan(masuk as string);
      expect(hasil.ok ? hasil.nilai : null).toBe(nilai);
      expect(hasil.ok ? null : hasil.galat).toBe(galat);
    }
  });

  test("tambah bulan, status kerja, tanda, susunan", () => {
    for (const [tanggal, bulan, hasil] of vektor.tambah_bulan) {
      expect(H.tambahBulan(tanggal as string, bulan as number)).toBe(
        hasil as string | null,
      );
    }
    for (const k of vektor.status_kerja) {
      expect(H.statusKerja(kontrak(k.kontrak), k.tanggal)).toEqual(
        k.hasil as H.StatusKerja,
      );
    }
    for (const k of vektor.tanda) {
      expect(H.tandaKontrak(kontrak(k.kontrak), k.aturan)).toEqual(k.hasil);
    }
    for (const k of vektor.susun_kontrak) {
      expect(H.susunKontrak(kontrak(k.kontrak), k.hari_ini, k.aturan)).toEqual(
        k.hasil as H.SusunanKontrak,
      );
    }
  });

  test("angka pengaturan", () => {
    for (const [nilai, nama, hasil] of vektor.angka) {
      expect(
        H.angkaPengaturan(nilai as string | null, aturanDari(nama as string)),
      ).toBe(hasil as number);
    }
    for (const [teks, nama, label, nilai, galat] of vektor.validasi_angka) {
      const hasil = H.validasiAngkaPengaturan(
        teks as string,
        aturanDari(nama as string),
        label as string,
      );
      expect(hasil.ok ? hasil.nilai : null).toBe(nilai);
      expect(hasil.ok ? null : hasil.galat).toBe(galat);
    }
  });

  test("tugas, jenis tugas, status tugas", () => {
    for (const k of vektor.tugas) {
      const hasil = H.validasiTugas({
        ...vektor.tugas_dasar,
        ...k.ubah,
      } as H.TugasIsian);
      expect(hasil.ok ? null : hasil.galat).toBe(k.galat);
      if (hasil.ok) expect(hasil.nilai).toEqual(k.hasil as H.TugasIsian);
    }
    for (const [nama, jp, hasilNama, galat] of vektor.jenis_tugas) {
      const hasil = H.validasiJenisTugas({
        nama: nama as string,
        ekuivalen_jp: jp as number,
      });
      expect(hasil.ok ? hasil.nilai.nama : null).toBe(
        hasilNama as string | null,
      );
      expect(hasil.ok ? null : hasil.galat).toBe(galat as string | null);
    }
    for (const [mulai, selesai, batal, hari, hasil] of vektor.status_tugas) {
      expect(
        H.statusTugas(
          {
            tanggal_mulai: mulai,
            tanggal_selesai: selesai,
            dibatalkan_pada: batal,
          },
          hari,
        ),
      ).toBe(hasil as H.StatusTugas);
    }
  });
});

// Vektor 1c, kembar `desktop/hris_cloud.rs` (modul `tests`).
describe("hris 1c: data cloud-only (kembar hris_cloud.rs)", () => {
  type Kasus = {
    ubah: object;
    galat: string | null;
    hasil: unknown;
  };
  const periksaKasus = <T>(
    daftar: Kasus[],
    dasar: object,
    validasi: (
      isian: T,
    ) => { ok: true; nilai: T } | { ok: false; galat: string },
  ) => {
    for (const k of daftar) {
      const hasil = validasi({ ...dasar, ...k.ubah } as T);
      expect(hasil.ok ? null : hasil.galat).toBe(k.galat);
      if (hasil.ok) expect(hasil.nilai).toEqual(k.hasil as T);
    }
  };

  test("nomor pengenal", () => {
    for (const [jenis, masuk, nilai, galat] of vektor.nomor_identitas) {
      const hasil = H.nomorIdentitas(jenis as string, masuk as string);
      expect(hasil.ok ? hasil.nilai : null).toBe(nilai);
      expect(hasil.ok ? null : hasil.galat).toBe(galat);
    }
  });

  test("pribadi, keuangan, pendidikan, sertifikasi, dokumen", () => {
    periksaKasus(vektor.pribadi, vektor.pribadi_dasar, H.validasiPribadi);
    periksaKasus(vektor.keuangan, vektor.keuangan_dasar, H.validasiKeuangan);
    periksaKasus(
      vektor.pendidikan,
      vektor.pendidikan_dasar,
      H.validasiPendidikan,
    );
    periksaKasus(
      vektor.sertifikasi,
      vektor.sertifikasi_dasar,
      H.validasiSertifikasi,
    );
    periksaKasus(vektor.dokumen, vektor.dokumen_dasar, H.validasiDokumen);
  });

  test("tanda lampiran pengajuan (Q-51)", () => {
    for (const [wajib, jumlah, hasil] of vektor.tanda_lampiran) {
      expect(H.tandaLampiran(wajib as boolean, jumlah as number)).toEqual(
        hasil as string[],
      );
    }
  });

  test("berkas dokumen", () => {
    for (const k of vektor.berkas_dokumen) {
      const hasil = H.uraiBerkasDokumen(
        k.nama_berkas,
        k.mime_type,
        k.data_base64,
      );
      expect(hasil.ok ? null : hasil.galat).toBe(k.galat);
      if (hasil.ok) {
        const { nama_berkas, mime_type, ukuran_byte } = hasil.nilai;
        expect({ nama_berkas, mime_type, ukuran_byte }).toEqual(
          k.hasil as typeof hasil.nilai,
        );
      }
    }
    const pdf = (byte: number) =>
      Buffer.from("%PDF-1.7".padEnd(byte, " ")).toString("base64");
    const pas = H.uraiBerkasDokumen(
      "a.pdf",
      "application/pdf",
      pdf(H.MAKS_BYTE_DOKUMEN),
    );
    expect(pas.ok && pas.nilai.ukuran_byte).toBe(H.MAKS_BYTE_DOKUMEN);
    const lebih = H.uraiBerkasDokumen(
      "a.pdf",
      "application/pdf",
      pdf(H.MAKS_BYTE_DOKUMEN + 1),
    );
    expect(lebih.ok ? null : lebih.galat).toBe("Berkas lebih dari 1 MB.");
  });

  test("kelompok profil dari izin sesi", () => {
    const subjek = (permissions: string[]) =>
      ({ isSuperadmin: false, permissions }) as unknown as Parameters<
        typeof H.kelompokProfil
      >[0];
    expect(
      H.kelompokProfil(subjek(["hr.personal.view", "employees.view"])),
    ).toEqual({ pribadi: true, keuangan: false, pendidik: false });
    expect(
      H.kelompokProfil(subjek(["hr.finance.view", "teachers.view"])),
    ).toEqual({ pribadi: false, keuangan: true, pendidik: true });
    expect(H.bolehBacaDokumen(subjek(["hr.org.manage"]), "")).toBe(true);
    expect(H.bolehBacaDokumen(subjek(["hr.org.manage"]), "p1")).toBe(false);
    expect(H.bolehBacaDokumen(subjek(["hr.document.view"]), "p1")).toBe(true);
  });

  test("ringkasan PTK per unit dihitung atas guru", () => {
    const baris = (
      unit: string,
      kelompok: "Guru" | "Tendik",
      jenjang: string,
      nrg: string,
    ) =>
      ({ unit, kelompok, jenjang, nrg, sertifikat_bidang: "" }) as H.BarisPtk;
    const r = H.ringkasPtk([
      baris("SMP", "Guru", "S1", "123456789012"),
      baris("SMP", "Guru", "D3", ""),
      baris("SMP", "Guru", "S2", ""),
      baris("SMP", "Tendik", "SMA/SMK", ""),
      baris("SD", "Guru", "D4", ""),
    ]);
    expect(r.per_unit.map((u) => u.unit)).toEqual(["SD", "SMP"]);
    expect(r.per_unit[1]).toEqual({
      unit: "SMP",
      guru: 3,
      tendik: 1,
      guru_s1: 2,
      guru_sertifikat: 1,
      persen_s1: 66.7,
      persen_sertifikat: 33.3,
    });
    expect(r.total.guru).toBe(4);
    expect(r.total.persen_s1).toBe(75);
  });

  test("SQL disalin harfiah ke hris_cloud.rs (Desktop dan Mobile)", () => {
    const sql: string[] = [
      H.PROFIL_PRIBADI_SQL,
      H.PROFIL_KEUANGAN_SQL,
      H.SIMPAN_PRIBADI_SQL,
      H.SIMPAN_KEUANGAN_SQL,
      H.PENDIDIKAN_SQL,
      H.SERTIFIKASI_SQL,
      H.SIMPAN_PENDIDIKAN_SQL,
      H.HAPUS_PENDIDIKAN_SQL,
      H.SIMPAN_SERTIFIKASI_SQL,
      H.HAPUS_SERTIFIKASI_SQL,
      H.JENIS_DOKUMEN_SQL,
      H.SIMPAN_JENIS_DOKUMEN_SQL,
      H.BENTROK_JENIS_DOKUMEN_SQL,
      H.DOKUMEN_SQL,
      H.BERKAS_DOKUMEN_SQL,
      H.AMBIL_BERKAS_SQL,
      H.SIMPAN_DOKUMEN_SQL,
      ...H.HAPUS_DOKUMEN_SQL,
      H.TAMBAH_BERKAS_SQL,
      H.HAPUS_BERKAS_SQL,
      H.PTK_SQL,
      H.PESAN_LURING,
      H.PESAN_PEGAWAI_BELUM_DI_CLOUD,
      H.PESAN_DOKUMEN_DITOLAK,
      H.PESAN_BERKAS_PENUH,
      H.PENGAJUAN_LAMPIRAN_SQL,
      H.LAMPIRAN_SQL,
      H.AMBIL_LAMPIRAN_SQL,
      H.PEMILIK_LAMPIRAN_SQL,
      H.TAMBAH_LAMPIRAN_SQL,
      H.HAPUS_LAMPIRAN_SQL,
      H.PESAN_PENGAJUAN_BELUM_DI_CLOUD,
      H.PESAN_LAMPIRAN_PENUH,
      H.PESAN_LAMPIRAN_DITOLAK,
    ];
    let diperiksa = 0;
    for (const dir of ["desktop", "mobile"]) {
      const lokasi = [
        join(import.meta.dir, `../../../src-tauri/src/${dir}/hris_cloud.rs`),
        join(
          import.meta.dir,
          `../../../../mobile/src-tauri/src/${dir}/hris_cloud.rs`,
        ),
      ].find(existsSync);
      if (!lokasi) continue;
      diperiksa++;
      const rust = readFileSync(lokasi, "utf8").replace(/\s+/g, "");
      for (const teks of sql) {
        expect(rust).toContain(JSON.stringify(teks).replace(/\s+/g, ""));
      }
      for (const [nama, daftar] of [
        ["AGAMA", H.AGAMA],
        ["STATUS_NIKAH", H.STATUS_NIKAH],
        ["JENJANG", H.JENJANG],
      ] as const) {
        expect(rust).toContain(
          `${nama}:[&str;${daftar.length}]=${JSON.stringify(daftar).replace(/\s+/g, "")};`,
        );
      }
      expect(rust).toContain(`TEKS_MAKS:usize=${H.TEKS_MAKS};`);
      expect(rust).toContain(`ALAMAT_MAKS:usize=${H.ALAMAT_MAKS};`);
      expect(rust).toContain("MAKS_BYTE_DOKUMEN:usize=1024*1024;");
      expect(rust).toContain(
        `MAKS_BERKAS_DOKUMEN:usize=${H.MAKS_BERKAS_DOKUMEN};`,
      );
    }
    expect(diperiksa).toBeGreaterThan(0);
  });
});
