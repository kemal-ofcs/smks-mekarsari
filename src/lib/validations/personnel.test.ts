import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeStatusSiswa, STATUS_SISWA, shiftLabel } from "./personnel";

describe("STATUS_SISWA", () => {
  test("sama persis dengan CHECK constraint siswa_data.status", () => {
    const ddl = readFileSync(
      join(import.meta.dir, "../db-migrations.ts"),
      "utf8",
    );
    const check =
      /status TEXT NOT NULL DEFAULT 'Aktif' CHECK \(status IN \(([^)]*)\)\)/.exec(
        ddl,
      );
    expect(check).not.toBeNull();
    const nilai = (check?.[1] ?? "")
      .split(",")
      .map((item) => item.trim().replace(/^'|'$/g, ""));
    expect(nilai).toEqual([...STATUS_SISWA]);
  });

  test("normalisasi mengabaikan huruf besar/kecil dan menolak nilai asing", () => {
    expect(normalizeStatusSiswa(" drop out ")).toBe("Drop Out");
    expect(normalizeStatusSiswa("Mutasi")).toBeNull();
  });
});

describe("shiftLabel", () => {
  test("menyebut jam masuk dan pulang", () => {
    expect(
      shiftLabel({
        id_shift: 2,
        nama_shift: "Siang",
        jam_masuk: "12:00",
        jam_pulang: "17:00",
      }),
    ).toBe("Siang (12:00–17:00)");
  });

  test("jatuh ke nama saja bila jamnya kosong", () => {
    expect(shiftLabel({ id_shift: 3 })).toBe("Shift #3");
  });
});
