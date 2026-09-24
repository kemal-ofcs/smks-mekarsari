import { describe, expect, test } from "bun:test";
import {
  parseStudentRows,
  parseTeacherRows,
  STUDENT_WORKBOOK_HEADERS,
  shiftCodeOf,
  tanggalExcel,
  teksIdentitas,
} from "./personnel-import";

const lookups = {
  rombel: [
    { id_rombel: "rom-a", nama_rombel: "X-A" },
    { id_rombel: "rom-b-2025", nama_rombel: "X-B" },
    { id_rombel: "rom-b-2026", nama_rombel: "X-B" },
  ],
  shifts: [
    { id_shift: 7, kode_shift: 1, nama_shift: "Pagi" },
    { id_shift: 8, kode_shift: 2, nama_shift: "Siang" },
  ],
};

function sheet(...rows: Record<string, string>[]): string[][] {
  const headers = [...STUDENT_WORKBOOK_HEADERS];
  return [headers, ...rows.map((row) => headers.map((h) => row[h] ?? ""))];
}

describe("parseStudentRows", () => {
  test("nama rombel dan kode shift diterjemahkan ke id perangkat ini", () => {
    const [hasil] = parseStudentRows(
      sheet({
        nama_lengkap: "Ani",
        nama_rombel: "x-a",
        kode_shift: "2",
        jenis_kelamin: "Perempuan",
      }),
      lookups,
      2026,
    );
    expect(hasil.baris).toBe(2);
    expect(hasil.draft.id_rombel).toBe("rom-a");
    expect(hasil.draft.id_shift).toBe(8);
    expect(hasil.draft.jenis_kelamin).toBe("P");
    expect(hasil.draft.status).toBe("Aktif");
    expect(hasil.draft.angkatan).toBe(2026);
  });

  test("kode shift kosong berarti tidak memilih, bukan shift 1", () => {
    const [hasil] = parseStudentRows(
      sheet({ nama_lengkap: "Budi", nama_rombel: "X-A" }),
      lookups,
    );
    expect(hasil.draft.id_shift).toBeUndefined();
  });

  test("nama rombel kembar wajib diperjelas dengan id_rombel", () => {
    expect(() =>
      parseStudentRows(
        sheet({ nama_lengkap: "Cici", nama_rombel: "X-B" }),
        lookups,
      ),
    ).toThrow(/id_rombel/);
    const [hasil] = parseStudentRows(
      sheet({
        nama_lengkap: "Cici",
        nama_rombel: "X-B",
        id_rombel: "rom-b-2026",
      }),
      lookups,
    );
    expect(hasil.draft.id_rombel).toBe("rom-b-2026");
  });

  test("seluruh berkas ditolak dengan nomor baris bila satu sel cacat", () => {
    expect(() =>
      parseStudentRows(
        sheet(
          { nama_lengkap: "Ani", nama_rombel: "X-A" },
          { nama_lengkap: "Dedi", nama_rombel: "X-A", status: "Mutasi" },
        ),
        lookups,
      ),
    ).toThrow(/Baris 3: status 'Mutasi'/);
    expect(() =>
      parseStudentRows(
        sheet({ nama_lengkap: "Eka", nama_rombel: "X-Z" }),
        lookups,
      ),
    ).toThrow(/rombel 'X-Z' belum ada/);
    expect(() =>
      parseStudentRows(
        sheet({ nama_lengkap: "Eka", nama_rombel: "X-A", kode_shift: "9" }),
        lookups,
      ),
    ).toThrow(/kode_shift '9'/);
  });

  test("NIS kembar di dalam berkas ditolak sebelum apa pun disimpan", () => {
    expect(() =>
      parseStudentRows(
        sheet(
          { nama_lengkap: "Ani", nama_rombel: "X-A", nis: "001" },
          { nama_lengkap: "Budi", nama_rombel: "X-A", nis: "001" },
        ),
        lookups,
      ),
    ).toThrow(/NIS '001' muncul dua kali/);
  });

  test("nomor WhatsApp wali yang tidak valid ditolak lebih awal", () => {
    expect(() =>
      parseStudentRows(
        sheet({
          nama_lengkap: "Ani",
          nama_rombel: "X-A",
          no_whatsapp_wali: "12",
        }),
        lookups,
      ),
    ).toThrow(/WhatsApp wali/);
  });

  test("baris kosong dilewati, berkas tanpa data ditolak", () => {
    expect(() => parseStudentRows(sheet({}), lookups)).toThrow(
      /Tidak ada data siswa/,
    );
  });
});

describe("parseTeacherRows", () => {
  const headers = [
    "nama",
    "nip",
    "status_kepegawaian",
    "lp",
    "kode_shift",
    "status_aktif",
  ];

  test("status kepegawaian dicocokkan tanpa peduli huruf besar/kecil", () => {
    const [hasil] = parseTeacherRows(
      [headers, ["Pak Budi", "1987", "pppk", "L", "1", "nonaktif"]],
      lookups,
    );
    expect(hasil.draft.status_kepegawaian).toBe("PPPK");
    expect(hasil.draft.id_shift).toBe(7);
    expect(hasil.draft.status_aktif).toBe("Nonaktif");
  });

  test("status kepegawaian asing ditolak", () => {
    expect(() =>
      parseTeacherRows(
        [headers, ["Bu Ani", "", "Magang", "P", "", ""]],
        lookups,
      ),
    ).toThrow(/status_kepegawaian 'Magang'/);
  });

  test("kolom nama wajib ada di baris judul", () => {
    expect(() => parseTeacherRows([["nip"], ["123"]], lookups)).toThrow(
      /Kolom wajib 'nama'/,
    );
  });
});

test("shiftCodeOf menerjemahkan id perangkat kembali ke kode yang stabil", () => {
  expect(shiftCodeOf(8, lookups.shifts)).toBe("2");
  expect(shiftCodeOf(99, lookups.shifts)).toBe("");
});

describe("perbaikan impor Excel", () => {
  test("angka yang sudah dirusak Excel ditolak, bukan disimpan", () => {
    expect(() => teksIdentitas("1.98701012010011E+17", "nip", 5)).toThrow(
      "Baris 5",
    );
    expect(teksIdentitas("198701012010011001", "nip", 5)).toBe(
      "198701012010011001",
    );
  });

  test("tanggal dari sel Excel diterjemahkan dari nomor seri", () => {
    expect(tanggalExcel("2026-07-15", "tanggal_daftar", 2)).toBe("2026-07-15");
    expect(tanggalExcel("46218", "tanggal_daftar", 2)).toBe("2026-07-15");
    expect(tanggalExcel("", "tanggal_daftar", 2)).toBeUndefined();
    expect(() => tanggalExcel("15/07/2026", "tanggal_daftar", 2)).toThrow(
      "YYYY-MM-DD",
    );
  });

  test("kode personil peserta didik dibaca dari header baru maupun lama", () => {
    const [baru] = parseStudentRows(
      sheet({ nama_lengkap: "Ani", nama_rombel: "X-A", kode_personil: "P-1" }),
      lookups,
      2026,
    );
    expect(baru.draft.kode_karyawan).toBe("P-1");

    const headerLama = ["nama_lengkap", "nama_rombel", "kode_karyawan"];
    const [lama] = parseStudentRows(
      [headerLama, ["Ani", "X-A", "P-2"]],
      lookups,
      2026,
    );
    expect(lama.draft.kode_karyawan).toBe("P-2");
  });

  test("unit guru ikut terbaca, tidak hilang saat impor ulang", () => {
    const [hasil] = parseTeacherRows(
      [
        ["nama", "unit"],
        ["Pak Budi", "SMK"],
      ],
      lookups,
    );
    expect(hasil.draft.unit).toBe("SMK");
  });
});
