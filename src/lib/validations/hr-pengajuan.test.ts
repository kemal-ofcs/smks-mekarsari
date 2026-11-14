import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as P from "./hr-pengajuan";
import vektor from "./hr-pengajuan.vektor.json";

// Vektor yang sama diuji di `desktop/hr_pengajuan.rs` (modul `tests`).

const galat = <T>(hasil: P.Hasil<T>) => (hasil.ok ? null : hasil.pesan);

describe("hr-pengajuan: aturan kembar", () => {
  test("jenis pengajuan", () => {
    for (const k of vektor.jenis) {
      const hasil = P.validasiJenis(k.masuk as Record<string, unknown>);
      expect(galat(hasil)).toBe(k.galat);
      if (hasil.ok) expect(hasil.nilai).toEqual(k.hasil as P.JenisPengajuan);
    }
  });

  test("isian, jenis, dan batas hari", () => {
    for (const k of vektor.pengajuan) {
      const hasil = P.validasiPengajuan(k.masuk as Record<string, unknown>);
      expect(galat(hasil)).toBe(k.galat);
      if (hasil.ok) expect(hasil.nilai).toEqual(k.hasil as P.PengajuanSah);
    }
    for (const k of vektor.periksa_jenis) {
      expect(
        galat(
          P.periksaJenis(
            k.pengajuan as P.PengajuanSah,
            k.jenis as P.JenisPengajuan,
            k.guru,
            k.jp_max,
          ),
        ),
      ).toBe(k.galat);
    }
    for (const k of vektor.maks) {
      expect(
        galat(
          P.periksaMaks(
            k.jenis as P.JenisPengajuan,
            k.hari_kerja,
            k.hari_kalender,
          ),
        ),
      ).toBe(k.galat);
    }
  });

  test("kanonik dan sidik", () => {
    for (const k of vektor.kanonik) {
      const kanonik = P.kanonikPengajuan(k.isi as P.IsiPengajuan);
      expect(kanonik).toBe(k.kanonik);
      expect(createHash("sha256").update(kanonik, "utf8").digest("hex")).toBe(
        k.sidik,
      );
    }
  });

  test("status dan tanda", () => {
    for (const k of vektor.status) {
      const kep = k.keputusan as P.Keputusan[];
      expect(P.statusPengajuan(k.sidik, kep)).toBe(
        k.status as P.StatusPengajuan,
      );
      expect(P.keputusanBerlaku(k.sidik, kep)?.id_keputusan ?? null).toBe(
        k.berlaku,
      );
    }
    for (const k of vektor.tanda) {
      expect(
        P.tandaKeputusan(
          k.sidik,
          k.diajukan_oleh,
          k.keputusan as P.Keputusan[],
          k.cakupan,
        ),
      ).toEqual(k.hasil);
    }
  });

  test("bertumpuk, hari wajib, cakupan", () => {
    for (const k of vektor.bentrok) {
      const a = k.a as P.Ringkas;
      const b = k.b as P.Ringkas;
      expect(P.bentrokPengajuan(a, b)).toBe(k.hasil);
      expect(P.bentrokPengajuan(b, a)).toBe(k.hasil);
    }
    for (const k of vektor.tanggal_wajib) {
      expect(
        P.tanggalWajib(
          k.jadwal as P.Jadwal,
          new Set(k.libur),
          k.whitelist,
          k.mulai,
          k.selesai,
        ),
      ).toEqual(k.hasil);
    }
    for (const k of vektor.cakupan) {
      expect(P.dalamCakupan(k.lingkup_semua, k.unit_akun, k.unit_sasaran)).toBe(
        k.hasil,
      );
    }
  });

  test("aksi, sunting, urgent, pesan", () => {
    for (const k of vektor.aksi) {
      expect(galat(P.periksaAksi(k.aksi, k.alasan, k.keadaan))).toBe(k.galat);
    }
    for (const k of vektor.sunting) {
      expect(
        galat(P.periksaSunting(k.status, k.pengaju_sendiri, k.superadmin)),
      ).toBe(k.galat);
    }
    for (const k of vektor.urgent) {
      expect(galat(P.periksaUrgent(k.karyawan_sendiri, k.dalam_cakupan))).toBe(
        k.galat,
      );
    }
    const [a, b, c] = vektor.pesan.periode_dibayar;
    expect(P.pesanPeriodeDibayar(a, b)).toBe(c);
    const [d, e, f] = vektor.pesan.bertumpuk;
    expect(P.pesanBertumpuk(d, e)).toBe(f);
    const [g, h, i] = vektor.pesan.run_ulang;
    expect(P.pesanRunUlang(g, h)).toBe(i);
  });

  test("hari penuh, cuti dibayar, hadir saat cuti", () => {
    for (const k of vektor.penuh_pada) {
      expect(P.penuhPada(k.p as P.Berlaku, k.t)).toBe(k.hasil);
    }
    for (const k of vektor.menit_cuti_dibayar) {
      const [penuh, hadir, jam, normal] = k.masuk as [
        boolean,
        boolean,
        number,
        number,
      ];
      expect(P.menitCutiDibayar(penuh, hadir, jam, normal)).toEqual(
        k.hasil as [number, number],
      );
    }
    for (const k of vektor.cuti_dibayar) {
      const absen = new Map(
        Object.entries(k.absen as Record<string, [boolean, number]>),
      );
      expect(
        P.hitungCutiDibayar(k.tanggal as [string, boolean][], absen, k.normal),
      ).toEqual(k.hasil);
    }
    for (const k of vektor.hadir_saat_cuti) {
      expect(P.hadirSaatCuti(k.p as P.Berlaku, new Set(k.hadir))).toBe(k.hasil);
    }
  });

  test("aturan, jatah, dan penyesuaian cuti", () => {
    for (const k of vektor.aturan_cuti) {
      expect(
        P.aturanCuti(
          new Map(Object.entries(k.peta as Record<string, string>)),
          k.kelompok,
        ),
      ).toEqual(k.hasil);
    }
    for (const k of vektor.validasi_aturan_cuti) {
      const hasil = P.validasiAturanCuti(k.masuk as Record<string, unknown>);
      expect(galat(hasil)).toBe(k.galat);
      expect(hasil.ok ? hasil.nilai : null).toEqual(
        k.hasil as [string, string][] | null,
      );
    }
    for (const k of vektor.jatah_cuti) {
      expect(
        P.jatahCuti(
          k.tmt,
          k.aturan,
          k.terpakai,
          k.penyesuaian as [string, number][],
          k.hari_ini,
        ),
      ).toEqual(k.hasil as P.PeriodeCuti[]);
    }
    for (const k of vektor.penyesuaian) {
      const hasil = P.validasiPenyesuaian(k.masuk as Record<string, unknown>);
      expect(galat(hasil)).toBe(k.galat);
      expect(hasil.ok ? hasil.nilai : null).toEqual(
        k.hasil as P.PenyesuaianSah | null,
      );
    }
  });

  test("JP terdampak, bentrok pengganti, susun, hitung (2c)", () => {
    const t = vektor.jp_terdampak;
    for (const k of t.kasus) {
      expect(
        P.jpTerdampak(
          t.pengajuan as P.PengajuanJp[],
          t.jadwal as P.JadwalJp[],
          new Set(k.libur),
          k.dari,
          k.sampai,
        ),
      ).toEqual(k.hasil as P.Jp[]);
    }
    const b = vektor.pengganti_bentrok;
    for (const [masuk, hasil] of b.kasus) {
      const [pengganti, status, tanggal, jamKe, id] = masuk as string[];
      expect(
        P.penggantiBentrok(
          pengganti,
          status,
          tanggal,
          jamKe,
          id,
          t.jadwal as P.JadwalJp[],
          b.penanganan as P.Penanganan[],
        ),
      ).toBe(hasil as boolean);
    }
    const s = vektor.susun_jp;
    expect(
      P.susunJp(
        s.jp as P.Jp[],
        s.penanganan as P.Penanganan[],
        s.presensi as P.PresensiJp[],
        t.jadwal as P.JadwalJp[],
      ),
    ).toEqual(s.hasil as P.JpTersusun[]);
    const h = vektor.hitung_jp;
    expect(P.hitungJp(h.jp as P.Jp[], new Set(h.ditangani))).toEqual(h.hasil);
    for (const k of vektor.validasi_penanganan) {
      const hasil = P.validasiPenanganan(k.masuk as Record<string, unknown>);
      expect(galat(hasil)).toBe(k.galat);
      expect(hasil.ok ? hasil.nilai : null).toEqual(
        k.hasil as P.PenangananSah | null,
      );
    }
    for (const [masuk, hasil] of vektor.periksa_penanganan) {
      const [guru, pengganti, sesi, cakupan] = masuk as [
        string,
        string,
        string,
        boolean,
      ];
      expect(galat(P.periksaPenanganan(guru, pengganti, sesi, cakupan))).toBe(
        hasil as string | null,
      );
    }
  });

  test("SQL JP memakai predikat Menunggu/berlaku yang sama", () => {
    const aktif = P.PENGAJUAN_AKTIF_ORANG_SQL.slice(
      P.PENGAJUAN_AKTIF_ORANG_SQL.indexOf("NOT EXISTS"),
      P.PENGAJUAN_AKTIF_ORANG_SQL.indexOf(" ORDER BY p.tanggal_mulai"),
    );
    expect(P.JP_TERDAMPAK_SQL).toContain(aktif);
    expect(P.PENANGANAN_SQL).toContain(aktif);
  });

  test("jenis bawaan sah menurut validasi", () => {
    expect(P.JENIS_BAWAAN).toHaveLength(10);
    for (const j of P.JENIS_BAWAAN) {
      expect(galat(P.validasiJenis({ ...j }))).toBeNull();
    }
  });

  test("SQL dan konstanta disalin harfiah ke hr_pengajuan.rs (Desktop dan Mobile)", () => {
    const sql: string[] = [
      P.PENGAJUAN_BERLAKU_SQL,
      P.PENGAJUAN_RENTANG_SQL,
      P.PERIODE_DIBAYAR_SQL,
      P.PERIODE_PERLU_ULANG_SQL,
      P.PENGAJUAN_AKTIF_ORANG_SQL,
      P.SEED_JENIS_SQL,
      P.SIMPAN_JENIS_SQL,
      P.BENTROK_JENIS_SQL,
      P.JENIS_SQL,
      P.SIMPAN_PENGAJUAN_SQL,
      P.CLOUD_KEPUTUSAN_SQL,
      P.DAFTAR_PENGAJUAN_SQL,
      P.DAFTAR_KEPUTUSAN_SQL,
      P.PEGAWAI_PENGAJUAN_SQL,
      P.PEGAWAI_SATU_SQL,
      P.UNIT_PERSONIL_SQL,
      P.JP_MAX_SQL,
      P.LIBUR_SQL,
      P.WHITELIST_SQL,
      P.PENGAJUAN_SATU_SQL,
      P.KEPUTUSAN_SATU_SQL,
      P.WAKTU_SQL,
      P.LAPORAN_PENGAJUAN_SQL,
      P.HARI_ABSEN_SQL,
      P.JADWAL_PEGAWAI_SQL,
      P.JATAH_PEGAWAI_SQL,
      P.JATAH_TERPAKAI_SQL,
      P.HADIR_ORANG_SQL,
      P.PENYESUAIAN_ORANG_SQL,
      P.PENYESUAIAN_SATU_SQL,
      P.RIWAYAT_PENGAJUAN_SQL,
      P.ATURAN_CUTI_SQL,
      P.CLOUD_PENYESUAIAN_SQL,
      P.JP_TERDAMPAK_SQL,
      P.JADWAL_JP_SQL,
      P.PENANGANAN_SQL,
      P.PRESENSI_JP_SQL,
      P.GURU_AKTIF_SQL,
      P.CLOUD_PENANGANAN_SQL,
      P.PESAN_JP_SENDIRI,
      P.PESAN_CAKUPAN_JP,
      P.PESAN_BENTROK_PENGGANTI,
    ];
    let diperiksa = 0;
    for (const dir of ["desktop", "mobile"]) {
      const lokasi = [
        join(import.meta.dir, `../../../src-tauri/src/${dir}/hr_pengajuan.rs`),
        join(
          import.meta.dir,
          `../../../../mobile/src-tauri/src/${dir}/hr_pengajuan.rs`,
        ),
      ].find(existsSync);
      if (!lokasi) continue;
      diperiksa++;
      const rust = readFileSync(lokasi, "utf8").replace(/\s+/g, "");
      for (const teks of sql) {
        expect(rust).toContain(JSON.stringify(teks).replace(/\s+/g, ""));
      }
      for (const [nama, daftar] of [
        ["KELOMPOK", P.KELOMPOK],
        ["DAMPAK_GAJI", P.DAMPAK_GAJI],
        ["SATUAN_MAKS", P.SATUAN_MAKS],
        ["IZIN_PEMUTUS", P.IZIN_PEMUTUS],
        ["KEPUTUSAN_FINAL", P.KEPUTUSAN_FINAL],
        ["AKSI_KEPUTUSAN", P.AKSI_KEPUTUSAN],
        ["KELOMPOK_CUTI", P.KELOMPOK_CUTI],
        ["PERIODE_CUTI", P.PERIODE_CUTI],
        ["SISA_CUTI", P.SISA_CUTI],
        ["JENIS_PENYESUAIAN", P.JENIS_PENYESUAIAN],
        ["STATUS_PENANGANAN", P.STATUS_PENANGANAN],
      ] as const) {
        expect(rust).toContain(
          `${nama}:[&str;${daftar.length}]=${JSON.stringify(daftar).replace(/\s+/g, "")};`,
        );
      }
      for (const [nama, nilai, tipe] of [
        ["MAKS_ALASAN", P.MAKS_ALASAN, "usize"],
        ["MAKS_RENTANG_HARI", P.MAKS_RENTANG_HARI, "i64"],
        ["MAKS_HARI_JENIS", P.MAKS_HARI_JENIS, "i64"],
        ["MAKS_JAM_KE", P.MAKS_JAM_KE, "i64"],
        ["MAKS_HARI_PENYESUAIAN", P.MAKS_HARI_PENYESUAIAN, "i64"],
      ] as const) {
        expect(rust).toContain(`${nama}:${tipe}=${nilai};`);
      }
    }
    expect(diperiksa).toBeGreaterThan(0);
    // Batas aturan cuti: isian, label, min, maks, bawaan guru dan tendik.
    for (const dir of ["desktop", "mobile"]) {
      const lokasi = [
        join(import.meta.dir, `../../../src-tauri/src/${dir}/hr_pengajuan.rs`),
        join(
          import.meta.dir,
          `../../../../mobile/src-tauri/src/${dir}/hr_pengajuan.rs`,
        ),
      ].find(existsSync);
      if (!lokasi) continue;
      const rust = readFileSync(lokasi, "utf8").replace(/\s+/g, "");
      for (const [isian, label, min, maks, guru, tendik] of P.BATAS_CUTI) {
        expect(rust).toContain(
          `(${JSON.stringify(isian)},${JSON.stringify(label).replace(/\s+/g, "")},${min},${maks},${guru},${tendik})`,
        );
      }
    }
  });
});
