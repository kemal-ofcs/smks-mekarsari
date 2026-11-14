import type {
  IdentitasPegawai,
  JenisSk,
  JenisSurat,
  RekapBeban,
  SemesterBeban,
  SetupSurat,
} from "@/lib/validations/hr-beban";
import bawaan from "@/lib/validations/hr-surat-bawaan.json";
import { cetakA4, esc, kop, ROOT_ID, tanggalPanjang } from "../cetak-a4";
import { masaKerja } from "./gaya";

/**
 * SK dan surat kepegawaian (HRIS Fase 3b, `prd-hris.md` §21.2.2): dirakit di
 * sini sebagai HTML A4 dari bahan `desktop_hr_letter_setup` / rute
 * `letters/query` plus data sumber layar. Tidak ada yang disimpan kecuali
 * nomor SK tugas tambahan (oleh pemanggil, lewat `simpanTugas`). Web/Desktop
 * saja (Q-71). Setiap nilai melewati `esc`.
 */

export const POLA_BAWAAN = "{urut}/{kode}/{unit}/{romawi}/{tahun}";

export const KODE_SURAT: Record<JenisSurat, string> = {
  ptm: "SK-PTM",
  tugas: "SK-TGS",
  angkat: "SK-ANGKAT",
  tugas_luar: "ST",
  aktif: "SKET",
};

export const NAMA_SURAT: Record<JenisSurat, string> = {
  ptm: "SK Pembagian Tugas Mengajar",
  tugas: "SK Tugas Tambahan",
  angkat: "SK Pengangkatan GTY/PTY",
  tugas_luar: "Surat Tugas",
  aktif: "Surat Keterangan Aktif",
};

const NAMA_STATUS: Record<string, string> = {
  GTY: "Guru Tetap Yayasan",
  PTY: "Pegawai Tetap Yayasan",
};

const ROMAWI = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
];

/** Bulan 1–12 → angka Romawi; di luar itu `""`. */
export function romawi(bulan: number): string {
  return ROMAWI[bulan - 1] ?? "";
}

export interface IsianNomor {
  urut: string;
  kode: string;
  unit: string;
  /** Tanggal surat `YYYY-MM-DD`; `{romawi}` dan `{tahun}` diambil dari sini. */
  tanggal: string;
}

/**
 * Nomor dari pola (Q-59); pola kosong = `POLA_BAWAAN`. Token kosong tidak
 * meninggalkan garis miring ganda. Pola tanpa `{urut}` ditolak (aturan yang
 * sama dengan `validasiSettingSurat`).
 */
export function nomorSurat(
  pola: string,
  isian: IsianNomor,
): { ok: true; nilai: string } | { ok: false; galat: string } {
  const p = pola.trim() || POLA_BAWAAN;
  if (!p.includes("{urut}"))
    return { ok: false, galat: "Pola nomor wajib memuat {urut}." };
  const t = /^(\d{4})-(\d{2})-\d{2}$/.exec(isian.tanggal.trim());
  const nilai: Record<string, string> = {
    urut: isian.urut.trim(),
    kode: isian.kode.trim(),
    unit: isian.unit.trim(),
    romawi: t ? romawi(Number(t[2])) : "",
    tahun: t ? t[1] : "",
  };
  return {
    ok: true,
    nilai: p
      .replace(/\{(urut|kode|unit|romawi|tahun)\}/g, (_, k: string) => nilai[k])
      .replace(/\/{2,}/g, "/")
      .replace(/^\/|\/$/g, "")
      .trim(),
  };
}

/** Pola tersimpan jenis itu, kosong = bawaan. */
export function polaSurat(setup: SetupSurat, jenis: JenisSurat): string {
  return setup.pengaturan[`hr_surat_pola:${jenis}`]?.trim() || POLA_BAWAAN;
}

/** Menimbang dan Mengingat: dua bagian dipisah baris `---`, satu butir per baris. */
export function uraiDasar(teks: string): {
  menimbang: string[];
  mengingat: string[];
} {
  const baris = teks.split(/\r?\n/);
  const pisah = baris.findIndex((b) => b.trim() === "---");
  const bersih = (xs: string[]) => xs.map((b) => b.trim()).filter(Boolean);
  return pisah === -1
    ? { menimbang: bersih(baris), mengingat: [] }
    : {
        menimbang: bersih(baris.slice(0, pisah)),
        mengingat: bersih(baris.slice(pisah + 1)),
      };
}

/** Teks dasar berlaku: pengaturan, kosong = `hr-surat-bawaan.json` (Q-68). */
export function dasarSurat(setup: SetupSurat, jenis: JenisSk): string {
  return setup.pengaturan[`hr_surat_dasar:${jenis}`]?.trim() || bawaan[jenis];
}

export interface Penanda {
  jabatan: string;
  nama: string;
  nip: string;
}

const namaGelar = (nama: string, gelar: string) =>
  nama && gelar ? `${nama}, ${gelar}` : nama;

const kunci = (teks: string) => teks.trim().toLowerCase();

/**
 * Kepala unit pada tanggal surat (`KEPALA_UNIT_SQL`); tidak ada = pimpinan di
 * profil sekolah; itu pun kosong = nama kosong untuk diisi tangan.
 */
export function kepalaUnit(setup: SetupSurat, unit: string): Penanda {
  const jabatan = unit.trim() ? `Kepala ${unit.trim()}` : "Kepala Sekolah";
  const k = setup.kepala.find((x) => x.kunci_unit === kunci(unit));
  if (k) return { jabatan, nama: namaGelar(k.nama, k.gelar), nip: k.nip };
  if (setup.kop.kepala_nama)
    return {
      jabatan: setup.kop.kepala_jabatan || "Kepala Sekolah",
      nama: setup.kop.kepala_nama,
      nip: setup.kop.kepala_nip ?? "",
    };
  return { jabatan, nama: "", nip: "" };
}

/** Ketua yayasan dari Pengaturan surat (Q-66), jabatan + nama yayasan. */
export function ketuaYayasan(setup: SetupSurat): Penanda {
  return {
    jabatan: gabungJabatan(
      setup.pengaturan.hr_surat_yayasan_jabatan?.trim() || "Ketua Yayasan",
      setup.pengaturan.hr_surat_yayasan_nama ?? "",
    ),
    nama: setup.pengaturan.hr_surat_yayasan_ketua?.trim() ?? "",
    nip: "",
  };
}

/**
 * Jabatan + lembaga tanpa kata ganda: "Ketua Yayasan" + "Yayasan Pendidikan
 * X" → "Ketua Yayasan Pendidikan X"; "Kepala SMA" + "SMA Contoh" → "Kepala
 * SMA Contoh". Lembaga kosong = jabatan saja.
 */
export function gabungJabatan(jabatan: string, lembaga: string): string {
  const j = jabatan.trim();
  const l = lembaga.trim();
  if (!l) return j;
  const kataAkhir = j.split(/\s+/).pop() ?? "";
  if (kataAkhir && kunci(l.split(/\s+/)[0] ?? "") === kunci(kataAkhir))
    return `${j.slice(0, j.length - kataAkhir.length)}${l}`.trim();
  return `${j} ${l}`;
}

const KOSONG: IdentitasPegawai = {
  id_unik: "",
  nama: "",
  gelar: "",
  nip: "",
  nuptk: "",
  jabatan: "",
  unit: "",
  tmt: "",
  guru: 0,
};

export function identitas(setup: SetupSurat, id: string): IdentitasPegawai {
  return setup.pegawai.find((p) => p.id_unik === id) ?? { ...KOSONG };
}

const statusKini = (setup: SetupSurat, id: string) =>
  setup.status.find((s) => s.id_unik === id)?.status ?? "";

// ── Kerangka dokumen ────────────────────────────────────────────────────────

export interface DasarCetak {
  setup: SetupSurat;
  nomor: string;
  /** Tanggal surat `YYYY-MM-DD`. */
  tanggal: string;
}

const GAYA_SURAT = `
  #${ROOT_ID} .judul { text-align: center; font-weight: bold; margin: 0; }
  #${ROOT_ID} table.polos { width: auto; margin: 4px 0; font-size: 12pt; }
  #${ROOT_ID} table.polos td { border: none; padding: 1px 4px; }
  #${ROOT_ID} table.polos td.label { white-space: nowrap; }
  #${ROOT_ID} ol { margin: 0; padding-left: 20px; }
  #${ROOT_ID} .tetap { margin-left: 55%; margin-top: 24px; page-break-inside: avoid; }
  #${ROOT_ID} .nama-ttd { font-weight: bold; text-decoration: underline; }
  #${ROOT_ID} .lampiran { page-break-before: always; }
  #${ROOT_ID} .tengah { text-align: center; }
`;

const atau = (teks: string | null | undefined) => esc(teks?.trim() || "-");

function tabelData(baris: [string, string][]): string {
  return `<table class="polos">${baris
    .map(
      ([label, nilai]) =>
        `<tr><td class="label">${esc(label)}</td><td>:</td><td>${atau(nilai)}</td></tr>`,
    )
    .join("")}</table>`;
}

function blokTandaTangan(d: DasarCetak, penanda: Penanda, sk: boolean): string {
  const kota = d.setup.pengaturan.hr_surat_kota?.trim() ?? "";
  const tanggal = esc(tanggalPanjang(d.tanggal, false));
  const tempat = sk
    ? `<table class="polos"><tr><td class="label">Ditetapkan di</td><td>:</td><td>${atau(kota)}</td></tr><tr><td class="label">Pada tanggal</td><td>:</td><td>${tanggal}</td></tr></table>`
    : `<div>${kota ? `${esc(kota)}, ` : ""}${tanggal}</div>`;
  return `
    <div class="tetap">
      ${tempat}
      <div>${esc(penanda.jabatan)},</div>
      <div class="ruang"></div>
      <div class="nama-ttd">${penanda.nama ? esc(penanda.nama) : "...................................."}</div>
      ${penanda.nip ? `<div>NIP ${esc(penanda.nip)}</div>` : ""}
    </div>`;
}

function keputusan(
  d: DasarCetak,
  jenis: JenisSk,
  unit: string,
  penanda: Penanda,
  tentang: string[],
  diktum: string[],
  lampiran = "",
): string {
  const dasar = uraiDasar(dasarSurat(d.setup, jenis));
  const daftar = (butir: string[], tipe: "a" | "1") =>
    butir.length
      ? `<ol type="${tipe}">${butir.map((b) => `<li>${esc(b)}</li>`).join("")}</ol>`
      : "-";
  const urutan = ["KESATU", "KEDUA", "KETIGA", "KEEMPAT", "KELIMA"];
  const semuaDiktum = [
    ...diktum,
    "Keputusan ini berlaku sejak tanggal ditetapkan, dengan ketentuan apabila di kemudian hari terdapat kekeliruan akan diadakan perbaikan sebagaimana mestinya.",
  ];
  return `
    ${kop(d.setup.kop, unit || d.setup.kop.cabang)}
    <p class="judul">KEPUTUSAN ${esc(penanda.jabatan.toUpperCase())}</p>
    <p class="judul">NOMOR: ${atau(d.nomor)}</p>
    <p class="judul">TENTANG</p>
    ${tentang.map((t) => `<p class="judul">${esc(t.toUpperCase())}</p>`).join("")}
    <p class="tengah"><strong>${esc(penanda.jabatan.toUpperCase())},</strong></p>
    <table class="polos">
      <tr><td class="label">Menimbang</td><td>:</td><td>${daftar(dasar.menimbang, "a")}</td></tr>
      <tr><td class="label">Mengingat</td><td>:</td><td>${daftar(dasar.mengingat, "1")}</td></tr>
    </table>
    <p class="tengah"><strong>MEMUTUSKAN:</strong></p>
    <table class="polos">
      <tr><td class="label">Menetapkan</td><td>:</td><td>KEPUTUSAN ${esc(penanda.jabatan.toUpperCase())} TENTANG ${esc(tentang.join(" ").toUpperCase())}.</td></tr>
      ${semuaDiktum
        .map(
          (isi, i) =>
            `<tr><td class="label">${urutan[i] ?? ""}</td><td>:</td><td>${isi}</td></tr>`,
        )
        .join("")}
    </table>
    ${blokTandaTangan(d, penanda, true)}
    ${lampiran}`;
}

function kepalaLampiran(d: DasarCetak, penanda: Penanda): string {
  return `
    <div class="lampiran">
      <table class="polos">
        <tr><td class="label">Lampiran Keputusan</td><td>:</td><td>${esc(penanda.jabatan)}</td></tr>
        <tr><td class="label">Nomor</td><td>:</td><td>${atau(d.nomor)}</td></tr>
        <tr><td class="label">Tanggal</td><td>:</td><td>${esc(tanggalPanjang(d.tanggal, false))}</td></tr>
      </table>`;
}

const namaNip = (nama: string, nip: string) =>
  `${esc(nama)}${nip ? `<br><span class="kecil">NIP ${esc(nip)}</span>` : ""}`;

// ── 1. SK Pembagian Tugas Mengajar (per unit rombel, Q-66) ──────────────────

export interface BarisSkPtm {
  id_unik: string;
  nama: string;
  nip: string;
  mapel: { nama_mapel: string; nama_rombel: string; jp: number }[];
  jp_tatap_muka: number;
  tugas: { nama_jenis: string; nama_rombel: string; ekuivalen_jp: number }[];
  jp_tugas: number;
  total: number;
}

/**
 * Isi lampiran SK untuk unit rombel `unit` (`""` = semua): mapel rombel unit
 * itu, JP tatap muka unit itu (`per_unit`), tugas yang unitnya unit itu atau
 * tanpa unit dan unit utama guru = unit itu. Guru tanpa keduanya tidak ikut.
 */
export function barisSkPtm(
  rekap: readonly RekapBeban[],
  unit: string,
): BarisSkPtm[] {
  const k = kunci(unit);
  return rekap.flatMap((r) => {
    const mapel =
      k === "" ? r.mapel : r.mapel.filter((m) => kunci(m.unit) === k);
    const tugas =
      k === ""
        ? r.tugas
        : r.tugas.filter(
            (t) =>
              kunci(t.unit) === k ||
              (kunci(t.unit) === "" && kunci(r.unit) === k),
          );
    if (mapel.length === 0 && tugas.length === 0) return [];
    const jpTatapMuka =
      k === ""
        ? r.jp_tatap_muka
        : (r.per_unit.find((u) => kunci(u.unit) === k)?.jp ?? 0);
    const jpTugas = tugas.reduce((n, t) => n + t.ekuivalen_jp, 0);
    return [
      {
        id_unik: r.id_unik,
        nama: namaGelar(r.nama, r.gelar),
        nip: r.nip,
        mapel: mapel.map((m) => ({
          nama_mapel: m.nama_mapel,
          nama_rombel: m.nama_rombel,
          jp: m.jp,
        })),
        jp_tatap_muka: jpTatapMuka,
        tugas: tugas.map((t) => ({
          nama_jenis: t.nama_jenis,
          nama_rombel: t.nama_rombel,
          ekuivalen_jp: t.ekuivalen_jp,
        })),
        jp_tugas: jpTugas,
        total: jpTatapMuka + jpTugas,
      },
    ];
  });
}

export function suratPembagianTugas(
  d: DasarCetak,
  p: { unit: string; semester: SemesterBeban; rekap: readonly RekapBeban[] },
): string {
  const penanda = kepalaUnit(d.setup, p.unit);
  const periode = `semester ${p.semester.semester || "-"} tahun pelajaran ${p.semester.nama_tahun || "-"}`;
  const baris = barisSkPtm(p.rekap, p.unit);
  const lampiran = `
    ${kepalaLampiran(d, penanda)}
      <p class="judul">PEMBAGIAN TUGAS MENGAJAR GURU${p.unit.trim() ? ` ${esc(p.unit.trim().toUpperCase())}` : ""}</p>
      <p class="judul">${esc(periode.toUpperCase())}</p>
      <table>
        <thead><tr><th>No</th><th>Nama / NIP</th><th>Mata pelajaran (rombel: JP)</th><th>JP tatap muka</th><th>Tugas tambahan (ekuivalen JP)</th><th>JP tugas</th><th>Jumlah JP</th></tr></thead>
        <tbody>${
          baris.length
            ? baris
                .map(
                  (b, i) =>
                    `<tr><td>${i + 1}</td><td>${namaNip(b.nama, b.nip)}</td><td>${
                      b.mapel
                        .map(
                          (m) =>
                            `${esc(m.nama_mapel)} (${esc(m.nama_rombel)}: ${m.jp})`,
                        )
                        .join("<br>") || "-"
                    }</td><td class="angka">${b.jp_tatap_muka}</td><td>${
                      b.tugas
                        .map(
                          (t) =>
                            `${esc(t.nama_jenis)}${t.nama_rombel ? ` ${esc(t.nama_rombel)}` : ""} (${t.ekuivalen_jp})`,
                        )
                        .join("<br>") || "-"
                    }</td><td class="angka">${b.jp_tugas}</td><td class="angka">${b.total}</td></tr>`,
                )
                .join("")
            : `<tr><td colspan="7">Tidak ada guru dengan jadwal atau tugas di unit ini.</td></tr>`
        }</tbody>
      </table>
    </div>`;
  return keputusan(
    d,
    "ptm",
    p.unit,
    penanda,
    ["Pembagian tugas mengajar guru", periode],
    [
      `Pembagian tugas mengajar guru${p.unit.trim() ? ` ${esc(p.unit.trim())}` : ""} ${esc(periode)} sebagaimana tercantum dalam lampiran keputusan ini.`,
      "Guru yang namanya tercantum dalam lampiran melaksanakan tugas tersebut dengan penuh tanggung jawab dan melaporkan pelaksanaannya kepada kepala sekolah.",
    ],
    lampiran,
  );
}

// ── 2. SK Tugas Tambahan (satu baris, atau satu jenis satu tahun ajaran) ────

export interface TugasSk {
  id_karyawan: string;
  nama_jenis: string;
  unit: string;
  nama_rombel: string;
  /** Ekuivalen berlaku (baris, kosong = jenis) yang sudah diselesaikan pemanggil. */
  ekuivalen_jp: number;
  tahun_ajaran: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
}

/** Unit penanda tangan: unit bersama semua baris; berbeda atau kosong = yayasan. */
export function unitSkTugas(tugas: readonly TugasSk[]): string {
  const unit = new Set(tugas.map((t) => kunci(t.unit)));
  return unit.size === 1 && !unit.has("") ? tugas[0].unit.trim() : "";
}

function masaTugas(t: TugasSk): string {
  return `terhitung mulai tanggal ${tanggalPanjang(t.tanggal_mulai, false) || "-"}${
    t.tanggal_selesai
      ? ` sampai dengan ${tanggalPanjang(t.tanggal_selesai, false)}`
      : ""
  }`;
}

export function suratTugasTambahan(
  d: DasarCetak,
  tugas: readonly TugasSk[],
): string {
  const unit = unitSkTugas(tugas);
  const penanda = unit ? kepalaUnit(d.setup, unit) : ketuaYayasan(d.setup);
  const jenis = [...new Set(tugas.map((t) => t.nama_jenis))];
  const satuJenis = jenis.length === 1 ? jenis[0] : "";
  const tahun = tugas[0]?.tahun_ajaran ?? "";
  const tentang = [
    `Pemberian tugas tambahan${satuJenis ? ` sebagai ${satuJenis}` : ""}`,
    ...(tahun ? [`Tahun pelajaran ${tahun}`] : []),
  ];
  if (tugas.length === 1) {
    const t = tugas[0];
    const o = identitas(d.setup, t.id_karyawan);
    return keputusan(d, "tugas", unit, penanda, tentang, [
      `Menugaskan kepada:${tabelData([
        ["Nama", namaGelar(o.nama, o.gelar)],
        ["NIP", o.nip],
        ["Jabatan", o.jabatan],
        ["Unit kerja", o.unit],
      ])}sebagai ${esc(t.nama_jenis)}${t.nama_rombel ? ` kelas ${esc(t.nama_rombel)}` : ""}${t.unit ? ` ${esc(t.unit)}` : ""}${tahun ? ` tahun pelajaran ${esc(tahun)}` : ""}, ${esc(masaTugas(t))}.`,
      `Tugas tambahan sebagaimana dimaksud pada diktum KESATU diperhitungkan setara ${t.ekuivalen_jp} jam pelajaran per minggu.`,
    ]);
  }
  const lampiran = `
    ${kepalaLampiran(d, penanda)}
      <table>
        <thead><tr><th>No</th><th>Nama / NIP</th><th>Jabatan</th><th>Tugas tambahan</th><th>Unit / rombel</th><th>Ekuivalen JP</th><th>Masa tugas</th></tr></thead>
        <tbody>${tugas
          .map((t, i) => {
            const o = identitas(d.setup, t.id_karyawan);
            return `<tr><td>${i + 1}</td><td>${namaNip(namaGelar(o.nama, o.gelar) || "-", o.nip)}</td><td>${atau(o.jabatan)}</td><td>${esc(t.nama_jenis)}</td><td>${atau([t.unit, t.nama_rombel].filter(Boolean).join(" "))}</td><td class="angka">${t.ekuivalen_jp}</td><td>${esc(masaTugas(t))}</td></tr>`;
          })
          .join("")}</tbody>
      </table>
    </div>`;
  return keputusan(
    d,
    "tugas",
    unit,
    penanda,
    tentang,
    [
      "Menugaskan pegawai yang namanya tercantum dalam lampiran keputusan ini untuk melaksanakan tugas tambahan sebagaimana tercantum di dalamnya.",
      "Tugas tambahan diperhitungkan setara jam pelajaran per minggu sebagaimana tercantum dalam lampiran.",
    ],
    lampiran,
  );
}

// ── 3. SK Pengangkatan GTY/PTY (ketua yayasan) ──────────────────────────────

export function suratPengangkatan(
  d: DasarCetak,
  p: { id_karyawan: string; status: string; tmt: string },
): string {
  const o = identitas(d.setup, p.id_karyawan);
  const status = NAMA_STATUS[p.status] ?? p.status;
  return keputusan(
    d,
    "angkat",
    o.unit,
    ketuaYayasan(d.setup),
    [`Pengangkatan ${status}`],
    [
      `Mengangkat:${tabelData([
        ["Nama", namaGelar(o.nama, o.gelar)],
        ["NIP", o.nip],
        ...(o.guru === 1 ? ([["NUPTK", o.nuptk]] as [string, string][]) : []),
        ["Jabatan", o.jabatan],
        ["Unit kerja", o.unit],
      ])}sebagai ${esc(status)}${status !== p.status ? ` (${esc(p.status)})` : ""} terhitung mulai tanggal ${esc(tanggalPanjang(p.tmt, false) || "-")}.`,
      "Hak dan kewajiban yang bersangkutan sebagai pegawai tetap yayasan mengikuti peraturan kepegawaian yayasan yang berlaku.",
    ],
  );
}

// ── Surat (bukan SK) ────────────────────────────────────────────────────────

function surat(
  d: DasarCetak,
  unit: string,
  judul: string,
  isi: string,
  penanda: Penanda,
): string {
  return `
    ${kop(d.setup.kop, unit || d.setup.kop.cabang)}
    <h1>${esc(judul)}</h1>
    <div class="nomor">Nomor: ${atau(d.nomor)}</div>
    ${isi}
    ${blokTandaTangan(d, penanda, false)}`;
}

function rentang(mulai: string, selesai: string): string {
  if (!selesai || selesai === mulai) return tanggalPanjang(mulai) || "-";
  return `${tanggalPanjang(mulai, false) || "-"} sampai dengan ${tanggalPanjang(selesai, false)}`;
}

// ── 4. Surat Tugas (Dinas Luar berlaku, Q-69) ───────────────────────────────

export interface IsianTugasLuar {
  id_karyawan: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  /** Alasan pengajuan. */
  keperluan: string;
  /** Diketik saat cetak, tidak disimpan. */
  tujuan: string;
  penyelenggara: string;
}

export function suratTugasLuar(d: DasarCetak, p: IsianTugasLuar): string {
  const o = identitas(d.setup, p.id_karyawan);
  const penanda = kepalaUnit(d.setup, o.unit);
  const sekolah = d.setup.kop.nama?.trim() ?? "";
  const kalimat = [
    `untuk ${esc(p.keperluan.trim() || "melaksanakan tugas dinas luar")}`,
    p.penyelenggara.trim()
      ? `yang diselenggarakan oleh ${esc(p.penyelenggara.trim())}`
      : "",
    p.tujuan.trim() ? `di ${esc(p.tujuan.trim())}` : "",
    `pada ${esc(rentang(p.tanggal_mulai, p.tanggal_selesai))}`,
  ]
    .filter(Boolean)
    .join(" ");
  return surat(
    d,
    o.unit,
    "SURAT TUGAS",
    `
    <p>Yang bertanda tangan di bawah ini, ${esc(gabungJabatan(penanda.jabatan, sekolah))}, menugaskan kepada:</p>
    ${tabelData([
      ["Nama", namaGelar(o.nama, o.gelar)],
      ["NIP", o.nip],
      ["Jabatan", o.jabatan],
      ["Unit kerja", o.unit],
    ])}
    <p>${kalimat.charAt(0).toUpperCase()}${kalimat.slice(1)}.</p>
    <p>Demikian surat tugas ini dibuat untuk dilaksanakan dengan penuh tanggung jawab.</p>`,
    penanda,
  );
}

// ── 5. Surat Keterangan Aktif (tanpa data pribadi, Q-70) ────────────────────

export function suratKeteranganAktif(
  d: DasarCetak,
  p: { id_karyawan: string; mapel: readonly string[] },
): string {
  const o = identitas(d.setup, p.id_karyawan);
  const guru = o.guru === 1;
  const penanda = kepalaUnit(d.setup, o.unit);
  const sekolah = d.setup.kop.nama?.trim() || "sekolah";
  const masa = masaKerja(o.tmt, d.tanggal)
    .replace("th", "tahun")
    .replace("bln", "bulan");
  const mapel = p.mapel.filter((m) => m.trim());
  return surat(
    d,
    o.unit,
    guru ? "SURAT KETERANGAN AKTIF MENGAJAR" : "SURAT KETERANGAN AKTIF BEKERJA",
    `
    <p>Yang bertanda tangan di bawah ini:</p>
    ${tabelData([
      ["Nama", penanda.nama],
      ["NIP", penanda.nip],
      ["Jabatan", penanda.jabatan],
    ])}
    <p>menerangkan bahwa:</p>
    ${tabelData([
      ["Nama", namaGelar(o.nama, o.gelar)],
      ["NIP", o.nip],
      ...(guru ? ([["NUPTK", o.nuptk]] as [string, string][]) : []),
      ["Jabatan", o.jabatan],
      ["Unit kerja", o.unit],
      ["Status kepegawaian", statusKini(d.setup, p.id_karyawan)],
      ["Terhitung mulai tanggal", tanggalPanjang(o.tmt, false)],
      ["Masa kerja", masa === "-" ? "" : masa],
    ])}
    <p>adalah benar ${guru ? "guru yang aktif mengajar" : "pegawai yang aktif bekerja"} di ${esc(o.unit && !kunci(sekolah).includes(kunci(o.unit)) ? `${o.unit.trim()} ${sekolah}` : sekolah)} sampai dengan tanggal surat keterangan ini dibuat${
      guru && mapel.length
        ? `, dengan mata pelajaran yang diampu pada semester ini: ${mapel.map(esc).join(", ")}`
        : ""
    }.</p>
    <p>Demikian surat keterangan ini dibuat untuk dipergunakan sebagaimana mestinya.</p>`,
    penanda,
  );
}

/** Cetak salah satu surat di atas lewat dialog cetak (`cetak-a4.ts`). */
export function cetakSurat(html: string): void {
  cetakA4(html, GAYA_SURAT);
}
