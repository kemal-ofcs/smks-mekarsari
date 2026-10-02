/**
 * Utilitas manajemen Tingkat & Kelas Akademik Dinamis.
 *
 * Mengelola daftar tingkat/kelas yang dikonfigurasi secara fleksibel per unit
 * pendidikan (misal TK A, TK B untuk TK; Kelas 10-13 untuk SMK; Semester 1-8
 * untuk Perguruan Tinggi).
 *
 * Data disimpan terstruktur di dalam kolom `keterangan` milik `akademik_unit`
 * sehingga 100% Zero-Drift, tanpa perlu migrasi skema database baru, dan aman
 * terhadap siklus sinkronisasi Turso offline-first.
 */

export interface TingkatItem {
  tingkat: number;
  nama: string;
}

export interface UnitMetadata {
  deskripsi: string;
  daftar_tingkat: TingkatItem[];
}

export interface TingkatOption {
  tingkat: number;
  label: string;
  unitNama?: string;
  unitId?: string;
}

/**
 * Membaca kolom `keterangan` dari `akademik_unit` secara aman.
 * Jika formatnya JSON dengan `daftar_tingkat`, diparsing terstruktur.
 * Jika teks biasa atau kosong, diperlakukan sebagai deskripsi biasa.
 */
export function parseUnitKeterangan(raw?: unknown): UnitMetadata {
  if (!raw || typeof raw !== "string") {
    return { deskripsi: "", daftar_tingkat: [] };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { deskripsi: "", daftar_tingkat: [] };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      const rawDeskripsi =
        typeof parsed.deskripsi === "string"
          ? parsed.deskripsi
          : typeof parsed.keterangan === "string"
            ? parsed.keterangan
            : "";

      const rawTingkat = Array.isArray(parsed.daftar_tingkat)
        ? parsed.daftar_tingkat
        : Array.isArray(parsed.tingkat)
          ? parsed.tingkat
          : [];

      const daftar_tingkat: TingkatItem[] = [];
      const seen = new Set<number>();

      for (const item of rawTingkat) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const tNum = Number(record.tingkat ?? record.value ?? record.level);
        if (Number.isInteger(tNum) && tNum >= 0 && !seen.has(tNum)) {
          seen.add(tNum);
          const tNama =
            typeof record.nama === "string" && record.nama.trim()
              ? record.nama.trim()
              : typeof record.label === "string" && record.label.trim()
                ? record.label.trim()
                : `Kelas ${tNum}`;
          daftar_tingkat.push({ tingkat: tNum, nama: tNama });
        }
      }

      // Urutkan berdasarkan angka tingkat
      daftar_tingkat.sort((a, b) => a.tingkat - b.tingkat);

      return {
        deskripsi: rawDeskripsi,
        daftar_tingkat,
      };
    }
  } catch {
    // Bukan JSON, anggap sebagai teks deskripsi legacy murni
  }

  return {
    deskripsi: trimmed,
    daftar_tingkat: [],
  };
}

/**
 * Menyusun kembali objek deskripsi dan daftar tingkat menjadi string untuk disimpan di database.
 */
export function serializeUnitKeterangan(
  deskripsi: string,
  daftar_tingkat: TingkatItem[],
): string {
  const cleanDesc = deskripsi.trim();
  const cleanList: TingkatItem[] = [];
  const seen = new Set<number>();

  for (const item of daftar_tingkat) {
    const tNum = Number(item.tingkat);
    if (Number.isInteger(tNum) && tNum >= 0 && !seen.has(tNum)) {
      seen.add(tNum);
      const tNama = item.nama?.trim() || `Kelas ${tNum}`;
      cleanList.push({ tingkat: tNum, nama: tNama });
    }
  }
  cleanList.sort((a, b) => a.tingkat - b.tingkat);

  // Jika tidak ada daftar tingkat khusus dan hanya deskripsi teks,
  // simpan sebagai teks biasa agar rapi.
  if (cleanList.length === 0) {
    return cleanDesc;
  }

  return JSON.stringify({
    deskripsi: cleanDesc,
    daftar_tingkat: cleanList,
  });
}

/**
 * Mengambil daftar opsi tingkat dari seluruh unit yang ada atau untuk unit tertentu.
 * Menjamin `currentTingkat` (jika ada nilai lama) tetap ada dalam opsi dropdown.
 */
export function resolveTingkatOptions(
  unitList: Record<string, unknown>[],
  selectedUnitFilter?: string,
  currentTingkat?: number | string | null,
): TingkatOption[] {
  const options: TingkatOption[] = [];
  const seenKeys = new Set<string>();

  // Filter unit jika ada filter aktif
  const targetUnits = unitList.filter((u) => {
    if (!selectedUnitFilter || selectedUnitFilter === "all") return true;
    const uId = String(u.id_unit || "");
    const uNama = String(u.nama_unit || "");
    return uId === selectedUnitFilter || uNama === selectedUnitFilter;
  });

  for (const u of targetUnits) {
    const uNama = String(u.nama_unit || "").trim();
    const uId = String(u.id_unit || "").trim();
    const parsed = parseUnitKeterangan(u.keterangan);

    for (const item of parsed.daftar_tingkat) {
      const key = `${item.tingkat}-${uNama}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        options.push({
          tingkat: item.tingkat,
          label: item.nama,
          unitNama: uNama || undefined,
          unitId: uId || undefined,
        });
      }
    }
  }

  // Jika ada `currentTingkat` yang sedang dipakai formulir (misal data lama)
  // namun belum terdaftar di unit mana pun, tambahkan agar formulir tidak kosong.
  const currNum =
    currentTingkat !== undefined &&
    currentTingkat !== null &&
    currentTingkat !== ""
      ? Number(currentTingkat)
      : null;

  if (currNum !== null && !Number.isNaN(currNum)) {
    const exists = options.some((opt) => opt.tingkat === currNum);
    if (!exists) {
      options.push({
        tingkat: currNum,
        label: `Kelas ${currNum}`,
      });
    }
  }

  // Urutkan numerik
  options.sort((a, b) => a.tingkat - b.tingkat);

  return options;
}

/**
 * Mengembalikan label tampilan ramah manusia untuk angka tingkat tertentu
 * dengan memeriksa metadata unit yang terdaftar.
 */
export function formatTingkatDisplay(
  tingkat: number | string | null | undefined,
  unitList: Record<string, unknown>[],
): string {
  if (tingkat === null || tingkat === undefined || tingkat === "") return "-";
  const num = Number(tingkat);
  if (Number.isNaN(num)) return String(tingkat);

  for (const u of unitList) {
    const parsed = parseUnitKeterangan(u.keterangan);
    const found = parsed.daftar_tingkat.find((item) => item.tingkat === num);
    if (found?.nama) {
      return found.nama;
    }
  }

  return `Kelas ${num}`;
}

/**
 * Template preset untuk bantuan isi cepat di formulir Unit (opsional jika pengguna menginginkannya).
 */
export const PRESET_TINGKAT_TEMPLATES: Record<
  string,
  { label: string; tingkat: TingkatItem[] }
> = {
  tk: {
    label: "TK / PAUD (TK A & TK B)",
    tingkat: [
      { tingkat: 0, nama: "TK A" },
      { tingkat: 1, nama: "TK B" },
    ],
  },
  sd: {
    label: "SD / MI (Kelas 1 - 6)",
    tingkat: [
      { tingkat: 1, nama: "Kelas 1" },
      { tingkat: 2, nama: "Kelas 2" },
      { tingkat: 3, nama: "Kelas 3" },
      { tingkat: 4, nama: "Kelas 4" },
      { tingkat: 5, nama: "Kelas 5" },
      { tingkat: 6, nama: "Kelas 6" },
    ],
  },
  smp: {
    label: "SMP / MTs (Kelas 7 - 9)",
    tingkat: [
      { tingkat: 7, nama: "Kelas 7" },
      { tingkat: 8, nama: "Kelas 8" },
      { tingkat: 9, nama: "Kelas 9" },
    ],
  },
  smk_sma: {
    label: "SMA / SMK (Kelas 10 - 12)",
    tingkat: [
      { tingkat: 10, nama: "Kelas 10" },
      { tingkat: 11, nama: "Kelas 11" },
      { tingkat: 12, nama: "Kelas 12" },
    ],
  },
  smk_4th: {
    label: "SMK 4 Tahun (Kelas 10 - 13)",
    tingkat: [
      { tingkat: 10, nama: "Kelas 10" },
      { tingkat: 11, nama: "Kelas 11" },
      { tingkat: 12, nama: "Kelas 12" },
      { tingkat: 13, nama: "Kelas 13" },
    ],
  },
  kuliah: {
    label: "Perguruan Tinggi (Semester 1 - 8)",
    tingkat: [
      { tingkat: 1, nama: "Semester 1" },
      { tingkat: 2, nama: "Semester 2" },
      { tingkat: 3, nama: "Semester 3" },
      { tingkat: 4, nama: "Semester 4" },
      { tingkat: 5, nama: "Semester 5" },
      { tingkat: 6, nama: "Semester 6" },
      { tingkat: 7, nama: "Semester 7" },
      { tingkat: 8, nama: "Semester 8" },
    ],
  },
};
