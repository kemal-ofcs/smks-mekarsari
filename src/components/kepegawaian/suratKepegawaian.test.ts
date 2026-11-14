import { describe, expect, test } from "bun:test";
import type { RekapBeban, SetupSurat } from "@/lib/validations/hr-beban";
import bawaan from "@/lib/validations/hr-surat-bawaan.json";
import {
  barisSkPtm,
  dasarSurat,
  gabungJabatan,
  kepalaUnit,
  ketuaYayasan,
  nomorSurat,
  romawi,
  suratKeteranganAktif,
  suratPembagianTugas,
  suratPengangkatan,
  suratTugasLuar,
  suratTugasTambahan,
  unitSkTugas,
  uraiDasar,
} from "./suratKepegawaian";

const JAHAT = `<script>"&'`;

function setup(isi: Partial<SetupSurat> = {}): SetupSurat {
  return {
    kop: {},
    pengaturan: {},
    kepala: [],
    pegawai: [],
    status: [],
    tanggal: "2026-11-15",
    hari_ini: "2026-11-15",
    ...isi,
  };
}

describe("nomorSurat", () => {
  const isian = {
    urut: " 012 ",
    kode: "SK-PTM",
    unit: "SMP",
    tanggal: "2026-11-15",
  };

  test("pola bawaan dan setiap token", () => {
    expect(nomorSurat("", isian)).toEqual({
      ok: true,
      nilai: "012/SK-PTM/SMP/XI/2026",
    });
    expect(nomorSurat("{tahun}-{romawi}-{urut}", isian)).toEqual({
      ok: true,
      nilai: "2026-XI-012",
    });
  });

  test("Romawi tiap bulan", () => {
    expect([1, 4, 9, 12].map(romawi)).toEqual(["I", "IV", "IX", "XII"]);
    expect(romawi(0)).toBe("");
    expect(romawi(13)).toBe("");
    expect(
      nomorSurat("{urut}/{romawi}", { ...isian, tanggal: "2026-01-02" }),
    ).toEqual({ ok: true, nilai: "012/I" });
  });

  test("pola tanpa {urut} ditolak", () => {
    expect(nomorSurat("SK/{kode}/{tahun}", isian)).toEqual({
      ok: false,
      galat: "Pola nomor wajib memuat {urut}.",
    });
  });

  test("token kosong tidak meninggalkan garis miring ganda", () => {
    expect(nomorSurat("", { ...isian, unit: "", urut: "" })).toEqual({
      ok: true,
      nilai: "SK-PTM/XI/2026",
    });
    expect(nomorSurat("", { ...isian, tanggal: "rusak" })).toEqual({
      ok: true,
      nilai: "012/SK-PTM/SMP",
    });
  });
});

describe("penanda tangan dan dasar", () => {
  const kepala = {
    kunci_unit: "smp",
    unit: "SMP",
    id_karyawan: "K1",
    nama: "Ani",
    gelar: "S.Pd.",
    nip: "1980",
  };

  test("kepala unit, cadangan profil sekolah, lalu kosong", () => {
    expect(kepalaUnit(setup({ kepala: [kepala] }), " SMP ")).toEqual({
      jabatan: "Kepala SMP",
      nama: "Ani, S.Pd.",
      nip: "1980",
    });
    const profil = setup({
      kepala: [kepala],
      kop: { kepala_nama: "Pak Budi", kepala_jabatan: "Kepala Sekolah" },
    });
    expect(kepalaUnit(profil, "SD")).toEqual({
      jabatan: "Kepala Sekolah",
      nama: "Pak Budi",
      nip: "",
    });
    expect(kepalaUnit(setup(), "SD")).toEqual({
      jabatan: "Kepala SD",
      nama: "",
      nip: "",
    });
  });

  test("jabatan + lembaga tanpa kata ganda", () => {
    expect(gabungJabatan("Ketua Yayasan", "Yayasan Pendidikan X")).toBe(
      "Ketua Yayasan Pendidikan X",
    );
    expect(gabungJabatan("Kepala SMA", "sma Contoh")).toBe("Kepala sma Contoh");
    expect(gabungJabatan("Ketua Pengurus", "Yayasan X")).toBe(
      "Ketua Pengurus Yayasan X",
    );
    expect(gabungJabatan("Kepala Sekolah", "")).toBe("Kepala Sekolah");
  });

  test("ketua yayasan dari pengaturan", () => {
    expect(ketuaYayasan(setup())).toEqual({
      jabatan: "Ketua Yayasan",
      nama: "",
      nip: "",
    });
  });

  test("teks dasar: pengaturan, kosong = bawaan", () => {
    expect(dasarSurat(setup(), "ptm")).toBe(bawaan.ptm);
    expect(
      dasarSurat(setup({ pengaturan: { "hr_surat_dasar:ptm": "x" } }), "ptm"),
    ).toBe("x");
    expect(uraiDasar("a\n\n b \n---\n1\n")).toEqual({
      menimbang: ["a", "b"],
      mengingat: ["1"],
    });
    expect(uraiDasar("a")).toEqual({ menimbang: ["a"], mengingat: [] });
    for (const jenis of ["ptm", "tugas", "angkat"] as const) {
      const d = uraiDasar(bawaan[jenis]);
      expect(d.menimbang.length).toBeGreaterThan(0);
      expect(d.mengingat.length).toBeGreaterThan(0);
    }
  });
});

const rekap = (isi: Partial<RekapBeban>): RekapBeban => ({
  id_unik: "G1",
  nama: "Ani",
  gelar: "",
  nip: "",
  nuptk: "",
  unit: "SMP",
  status: "",
  aktif: true,
  jp_tatap_muka: 0,
  jp_tugas: 0,
  total: 0,
  mapel: [],
  per_unit: [],
  tugas: [],
  jam_rusak: [],
  tanda: [],
  ...isi,
});

const mapel = (nama_rombel: string, unit: string, jp: number) => ({
  id_rombel: nama_rombel,
  nama_rombel,
  id_mapel: "MTK",
  nama_mapel: "Matematika",
  unit,
  jp,
  jp_penugasan: null,
});

const tugas = (nama_jenis: string, unit: string, ekuivalen_jp: number) => ({
  id_tugas: nama_jenis,
  id_karyawan: "G1",
  id_jenis: nama_jenis,
  nama_jenis,
  ekuivalen_jp,
  unit,
  nama_rombel: "",
  nomor_sk: "",
  tanggal_sk: "",
});

describe("barisSkPtm (per unit rombel)", () => {
  const dua = rekap({
    unit: "SMP",
    jp_tatap_muka: 10,
    mapel: [mapel("7A", "SMP", 6), mapel("10A", "SMA", 4)],
    per_unit: [
      { unit: "SMA", jp: 4 },
      { unit: "SMP", jp: 6 },
    ],
    tugas: [tugas("Piket", "", 1), tugas("Kalab", "SMA", 12)],
  });

  test("guru dua unit muncul di dua SK dengan JP unit itu", () => {
    const smp = barisSkPtm([dua], "smp");
    expect(smp[0].mapel.map((m) => m.nama_rombel)).toEqual(["7A"]);
    expect([smp[0].jp_tatap_muka, smp[0].jp_tugas, smp[0].total]).toEqual([
      6, 1, 7,
    ]);
    const sma = barisSkPtm([dua], "SMA");
    expect([sma[0].jp_tatap_muka, sma[0].jp_tugas, sma[0].total]).toEqual([
      4, 12, 16,
    ]);
    const semua = barisSkPtm([dua], "");
    expect([semua[0].jp_tatap_muka, semua[0].jp_tugas]).toEqual([10, 13]);
  });

  test("guru tanpa jadwal dan tugas di unit itu tidak ikut", () => {
    expect(barisSkPtm([dua], "SD")).toEqual([]);
  });

  test("unit SK tugas: unit bersama, berbeda atau kosong = yayasan", () => {
    const t = {
      id_karyawan: "G1",
      nama_jenis: "Piket",
      nama_rombel: "",
      ekuivalen_jp: 1,
      tahun_ajaran: "2026/2027",
      tanggal_mulai: "2026-07-13",
      tanggal_selesai: "",
    };
    expect(
      unitSkTugas([
        { ...t, unit: "SMP" },
        { ...t, unit: " smp" },
      ]),
    ).toBe("SMP");
    expect(
      unitSkTugas([
        { ...t, unit: "SMP" },
        { ...t, unit: "SD" },
      ]),
    ).toBe("");
    expect(unitSkTugas([{ ...t, unit: "" }])).toBe("");
  });
});

describe("templat: nilai di-escape, data kosong tanpa 'undefined'", () => {
  const kosong = { setup: setup(), nomor: "", tanggal: "" };
  const jahatSetup = setup({
    kop: {
      nama: JAHAT,
      alamat: JAHAT,
      kepala_nama: JAHAT,
      logo_url: JAHAT,
    },
    pengaturan: {
      hr_surat_kota: JAHAT,
      hr_surat_yayasan_ketua: JAHAT,
      hr_surat_yayasan_nama: JAHAT,
      "hr_surat_dasar:ptm": `${JAHAT}\n---\n${JAHAT}`,
      "hr_surat_dasar:tugas": JAHAT,
      "hr_surat_dasar:angkat": JAHAT,
    },
    kepala: [
      {
        kunci_unit: JAHAT.toLowerCase(),
        unit: JAHAT,
        id_karyawan: "K",
        nama: JAHAT,
        gelar: JAHAT,
        nip: JAHAT,
      },
    ],
    pegawai: [
      {
        id_unik: "G1",
        nama: JAHAT,
        gelar: JAHAT,
        nip: JAHAT,
        nuptk: JAHAT,
        jabatan: JAHAT,
        unit: JAHAT,
        tmt: "2020-01-01",
        guru: 1,
      },
    ],
    status: [{ id_unik: "G1", status: JAHAT }],
  });
  const jahat = { setup: jahatSetup, nomor: JAHAT, tanggal: "2026-11-15" };
  const semester = {
    id_tahun_ajaran: "ta",
    nama_tahun: JAHAT,
    semester: JAHAT,
    tanggal_mulai: "",
    tanggal_selesai: "",
    is_aktif: 1,
  };
  const tugasSk = {
    id_karyawan: "G1",
    nama_jenis: JAHAT,
    unit: JAHAT,
    nama_rombel: JAHAT,
    ekuivalen_jp: 2,
    tahun_ajaran: JAHAT,
    tanggal_mulai: "2026-07-13",
    tanggal_selesai: "",
  };
  const isiRekap = rekap({
    nama: JAHAT,
    gelar: JAHAT,
    nip: JAHAT,
    unit: JAHAT,
    mapel: [{ ...mapel(JAHAT, JAHAT, 2), nama_mapel: JAHAT }],
    per_unit: [{ unit: JAHAT, jp: 2 }],
    tugas: [{ ...tugas(JAHAT, JAHAT, 2), nama_rombel: JAHAT }],
  });

  const bentuk = (d: typeof kosong) => [
    suratPembagianTugas(d, {
      unit: d === kosong ? "" : JAHAT,
      semester:
        d === kosong ? { ...semester, nama_tahun: "", semester: "" } : semester,
      rekap: d === kosong ? [] : [isiRekap],
    }),
    suratTugasTambahan(
      d,
      d === kosong ? [{ ...tugasSk, nama_jenis: "", unit: "" }] : [tugasSk],
    ),
    suratTugasTambahan(d, [tugasSk, { ...tugasSk, id_karyawan: "X" }]),
    suratPengangkatan(d, { id_karyawan: "G1", status: JAHAT, tmt: "" }),
    suratTugasLuar(d, {
      id_karyawan: "G1",
      tanggal_mulai: "2026-11-16",
      tanggal_selesai: "2026-11-17",
      keperluan: d === kosong ? "" : JAHAT,
      tujuan: d === kosong ? "" : JAHAT,
      penyelenggara: d === kosong ? "" : JAHAT,
    }),
    suratKeteranganAktif(d, {
      id_karyawan: "G1",
      mapel: d === kosong ? [] : [JAHAT],
    }),
  ];

  test("setiap nilai di-escape", () => {
    for (const html of bentuk(jahat)) {
      expect(html).not.toContain("<script>");
      expect(html).not.toContain(`"&'`);
      expect(html).toContain("&lt;script&gt;&quot;&amp;");
    }
  });

  test("data kosong tidak menghasilkan undefined/null/NaN", () => {
    for (const html of bentuk(kosong)) {
      expect(html).not.toMatch(/undefined|null|NaN/);
    }
  });

  test("teks bawaan tercetak saat pengaturan kosong", () => {
    const [ptm] = bentuk(kosong);
    expect(ptm).toContain("Sistem Pendidikan Nasional");
    expect(ptm).toContain('<ol type="a">');
  });
});
