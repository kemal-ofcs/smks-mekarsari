import { describe, expect, test } from "bun:test";
import {
  parseStudentRows,
  parseTeacherRows,
  STUDENT_WORKBOOK_HEADERS,
  shiftCodeOf,
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
