import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as B from "./hr-beban";
import vektorSurat from "./hr-surat.vektor.json";
import { TUGAS_BERLAKU_SQL } from "./hris";

// Rekap disusun hanya di TS (Q-65); yang kembar dengan `desktop/hr_beban.rs`
// adalah teks SQL-nya.

describe("hr-beban: SQL kembar", () => {
  test("SQL disalin harfiah ke hr_beban.rs (Desktop dan Mobile)", () => {
    const sql = [
      B.SEMESTER_SQL,
      B.BEBAN_GURU_SQL,
      B.BEBAN_JADWAL_SQL,
      B.BEBAN_TUGAS_SQL,
      B.BEBAN_PENUGASAN_SQL,
      B.KEPALA_UNIT_SQL,
      B.IDENTITAS_PEGAWAI_SQL,
      B.PENGATURAN_SURAT_SQL,
    ];
    let diperiksa = 0;
    for (const dir of ["desktop", "mobile"]) {
      const lokasi = [
        join(import.meta.dir, `../../../src-tauri/src/${dir}/hr_beban.rs`),
        join(
          import.meta.dir,
          `../../../../mobile/src-tauri/src/${dir}/hr_beban.rs`,
        ),
      ].find(existsSync);
      if (!lokasi) continue;
      diperiksa++;
      const rust = readFileSync(lokasi, "utf8").replace(/\s+/g, "");
      for (const teks of sql) {
        expect(rust).toContain(JSON.stringify(teks).replace(/\s+/g, ""));
      }
    }
    expect(diperiksa).toBeGreaterThan(0);
  });

  test("predikat berlaku = salinan harfiah TUGAS_BERLAKU_SQL", () => {
    // Cermin `predikat_berlaku` di hr_beban.rs.
    const [tugas, wali] = TUGAS_BERLAKU_SQL.split(" UNION ");
    const predikatTugas = tugas.slice(tugas.indexOf(" WHERE ") + 7);
    const sisaWali = wali.slice(wali.indexOf(" WHERE ") + 7);
    const predikatWali = sisaWali.slice(0, sisaWali.indexOf(" ORDER BY "));
    expect(predikatTugas.startsWith("t.dibatalkan_pada IS NULL")).toBe(true);
    expect(predikatWali.startsWith("r.is_aktif = 1")).toBe(true);
    expect(B.BEBAN_TUGAS_SQL).toContain(` WHERE ${predikatTugas} UNION ALL `);
    expect(B.BEBAN_TUGAS_SQL).toContain(` WHERE ${predikatWali} ORDER BY `);
    expect(B.BEBAN_JADWAL_SQL).toContain("CAST(j.jam_ke AS INTEGER)");
  });
});

const guru = (id: string, aktif = 1): B.GuruBeban => ({
  id_unik: id,
  nama: id,
  gelar: "",
  nip: "",
  nuptk: "",
  unit: "SMP",
  aktif,
});

const jadwal = (
  id_guru: string,
  hari: number,
  jam_ke: string,
  id_rombel: string,
  id_mapel = "MTK",
  unit = "SMP",
): B.JadwalBeban => ({
  id_jadwal: `${id_guru}-${hari}-${jam_ke}-${id_rombel}`,
  id_guru,
  hari,
  jam_ke,
  id_rombel,
  nama_rombel: id_rombel,
  id_mapel,
  nama_mapel: id_mapel === "MTK" ? "Matematika" : id_mapel,
  unit,
});

const tugas = (
  id_karyawan: string,
  id_tugas: string,
  ekuivalen_jp: number,
): B.TugasBeban => ({
  id_tugas,
  id_karyawan,
  id_jenis: id_tugas.startsWith("wali:") ? "tgs-wali-kelas" : "tgs-ekskul",
  nama_jenis: "x",
  ekuivalen_jp,
  unit: "",
  nama_rombel: "",
  nomor_sk: "",
  tanggal_sk: "",
});

const data = (ubah: Partial<B.DataBeban>): B.DataBeban => ({
  semester: [],
  id_tahun_ajaran: "ta",
  guru: [guru("G1")],
  jadwal: [],
  tugas: [],
  penugasan: [],
  status: [{ id_unik: "G1", status: "GTY" }],
  batas: { min: 2, maks: 4 },
  hari_ini: "2026-11-14",
  ...ubah,
});

const satu = (ubah: Partial<B.DataBeban>, sertifikat = null) =>
  B.susunBebanMengajar(data(ubah), sertifikat)[0];

describe("hr-beban: susunBebanMengajar", () => {
  test("rentang 3-4 = 2 JP; rincian per rombel × mapel", () => {
    const r = satu({ jadwal: [jadwal("G1", 1, "3-4", "7A")] });
    expect(r.jp_tatap_muka).toBe(2);
    expect(r.mapel.map((m) => [m.id_rombel, m.jp])).toEqual([["7A", 2]]);
    expect(r.status).toBe("GTY");
    expect(r.tanda).toEqual(["beda_penugasan"]);
  });

  test("dua rombel jam sama = satu JP, rincian tetap per rombel", () => {
    const r = satu({
      jadwal: [jadwal("G1", 1, "1", "7A"), jadwal("G1", 1, "1", "7B")],
    });
    expect(r.jp_tatap_muka).toBe(1);
    expect(r.mapel.map((m) => m.jp)).toEqual([1, 1]);
    expect(r.tanda).toContain("kurang_dari_batas");
    expect(r.tanda).not.toContain("gabungan_lintas_unit");
  });

  test("jam sama di dua unit: dilebur dan ditandai; unit kosong tidak dihitung", () => {
    const r = satu({
      jadwal: [
        jadwal("G1", 1, "1", "7A", "MTK", "SMP"),
        jadwal("G1", 1, "1", "10A", "MTK", "sma "),
        jadwal("G1", 2, "1", "X", "MTK", ""),
        jadwal("G1", 2, "1", "Y", "MTK", "SMP"),
      ],
    });
    expect(r.jp_tatap_muka).toBe(2);
    expect(r.tanda).toContain("gabungan_lintas_unit");
    expect(r.per_unit).toEqual([
      { unit: "", jp: 1 },
      { unit: "SMP", jp: 2 },
      { unit: "sma", jp: 1 },
    ]);
    const tanpa = satu({
      jadwal: [
        jadwal("G1", 2, "1", "X", "MTK", ""),
        jadwal("G1", 2, "1", "Y", "MTK", "SMP"),
      ],
    });
    expect(tanpa.tanda).not.toContain("gabungan_lintas_unit");
  });

  test("jam_ke rusak tidak dihitung dan ditandai", () => {
    const r = satu({
      jadwal: [jadwal("G1", 1, "abc", "7A"), jadwal("G1", 1, "2", "7A")],
    });
    expect(r.jp_tatap_muka).toBe(1);
    expect(r.jam_rusak).toEqual(["abc"]);
    expect(r.tanda).toContain("jam_tidak_terbaca");
  });

  test("tugas per baris: dua ekskul dan wali dua rombel masing-masing dihitung", () => {
    const r = satu({
      tugas: [
        tugas("G1", "t-ekskul-1", 2),
        tugas("G1", "t-ekskul-2", 2),
        tugas("G1", "wali:7A", 2),
        tugas("G1", "wali:7B", 2),
        tugas("G2", "t-lain", 9),
      ],
    });
    expect(r.jp_tugas).toBe(8);
    expect(r.total).toBe(8);
    expect(r.tugas).toHaveLength(4);
    expect(r.tanda).toEqual(["lebih_dari_batas", "tanpa_jadwal"]);
  });

  test("tepat di batas tidak ditandai", () => {
    expect(satu({ tugas: [tugas("G1", "t", 2)] }).tanda).toEqual([
      "tanpa_jadwal",
    ]);
    expect(satu({ tugas: [tugas("G1", "t", 4)] }).tanda).toEqual([
      "tanpa_jadwal",
    ]);
  });

  test("beda penugasan: JP berbeda, penugasan tanpa jadwal; sama = tanpa tanda", () => {
    const pen = (id_rombel: string, beban_jam: number) => ({
      id_guru: "G1",
      id_rombel,
      nama_rombel: id_rombel,
      id_mapel: "MTK",
      nama_mapel: "Matematika",
      beban_jam,
    });
    const jd = [jadwal("G1", 1, "1-2", "7A"), jadwal("G1", 2, "1", "7A")];
    const sama = satu({ jadwal: jd, penugasan: [pen("7A", 3)] });
    expect(sama.tanda).toEqual([]);
    expect(sama.mapel[0].jp_penugasan).toBe(3);
    expect(satu({ jadwal: jd, penugasan: [pen("7A", 4)] }).tanda).toContain(
      "beda_penugasan",
    );
    expect(
      satu({ jadwal: jd, penugasan: [pen("7A", 3), pen("7B", 2)] }).tanda,
    ).toContain("beda_penugasan");
  });

  test("nonaktif hanya bila masih punya jadwal", () => {
    const r = satu({
      guru: [guru("G1", 0)],
      jadwal: [jadwal("G1", 1, "1-2", "7A")],
    });
    expect(r.aktif).toBe(false);
    expect(r.tanda).toContain("nonaktif");
    expect(satu({ guru: [guru("G1", 0)] }).tanda).not.toContain("nonaktif");
  });

  test("sertifikat: hanya dinilai saat daring", () => {
    const ubah = { jadwal: [jadwal("G1", 1, "1-2", "7A", "IPA")] };
    expect(satu(ubah).tanda).not.toContain("mapel_di_luar_sertifikat");
    const r = B.susunBebanMengajar(
      data(ubah),
      new Map([["G1", "Matematika"]]),
    )[0];
    expect(r.tanda).toContain("mapel_di_luar_sertifikat");
  });
});

describe("hr-beban: cocokBidang dan unit", () => {
  test("cocokBidang", () => {
    const kasus: [string, string, boolean][] = [
      ["Matematika", "Pendidikan Matematika", true],
      ["Bahasa  Indonesia", "bahasa indonesia", true],
      ["PJOK", "Pendidikan Jasmani", false],
      ["IPA (Fisika)", "fisika", true],
      ["Apa saja", "", true],
      ["", "Matematika", false],
    ];
    for (const [mapel, bidang, hasil] of kasus) {
      expect(B.cocokBidang(mapel, bidang)).toBe(hasil);
    }
  });

  test("daftar dan saring unit", () => {
    const rekap = B.susunBebanMengajar(
      data({
        guru: [guru("G1"), { ...guru("G2"), unit: "" }],
        jadwal: [jadwal("G2", 1, "1", "10A", "MTK", "SMA")],
      }),
      null,
    );
    expect(B.daftarUnitBeban(rekap)).toEqual(["SMA", "SMP"]);
    expect(
      rekap.filter((r) => B.dalamUnitBeban(r, "sma")).map((r) => r.id_unik),
    ).toEqual(["G2"]);
    expect(rekap.filter((r) => B.dalamUnitBeban(r, "")).length).toBe(2);
  });

  test("kalimat setiap tanda", () => {
    for (const t of B.TANDA_BEBAN) {
      expect(
        B.kalimatTandaBeban(t, { min: 24, maks: 40 }).length,
      ).toBeGreaterThan(5);
    }
  });
});

// Vektor kembar `hr_beban_vektor_surat` di desktop/hr_beban.rs.
describe("hr-beban: pengaturan surat (vektor)", () => {
  test("daftar kunci", () => {
    expect(B.kunciPengaturanSurat()).toEqual(vektorSurat.kunci);
  });

  test("satu kunci", () => {
    for (const k of vektorSurat.setting) {
      const hasil = B.validasiSettingSurat(k.kunci, k.nilai);
      expect(hasil).toEqual(
        k.galat === null
          ? { ok: true, nilai: k.hasil as string }
          : { ok: false, galat: k.galat },
      );
    }
  });

  test("draft lengkap", () => {
    for (const k of vektorSurat.pengaturan) {
      const hasil = B.validasiPengaturanSurat(
        k.draft as unknown as Record<string, string>,
      );
      expect([k.nama, hasil]).toEqual([
        k.nama,
        k.galat === null
          ? { ok: true, nilai: k.nilai as [string, string][] }
          : { ok: false, galat: k.galat },
      ]);
    }
  });

  test("skema rute menolak kunci asing dan kunci yang hilang", () => {
    const lengkap = Object.fromEntries(
      B.kunciPengaturanSurat().map((k) => [k, ""]),
    );
    expect(B.pengaturanSuratSchema.safeParse(lengkap).success).toBe(true);
    expect(
      B.pengaturanSuratSchema.safeParse({ ...lengkap, hr_surat_x: "" }).success,
    ).toBe(false);
    const { hr_surat_kota: _, ...kurang } = lengkap;
    expect(B.pengaturanSuratSchema.safeParse(kurang).success).toBe(false);
  });
});
