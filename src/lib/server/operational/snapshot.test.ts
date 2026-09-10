import { describe, expect, mock, test } from "bun:test";
import type { Client, ResultSet } from "@libsql/client";

mock.module("server-only", () => ({}));

function result(rows: Record<string, unknown>[] = []) {
  return { rows } as unknown as ResultSet;
}

describe("readOperationalSnapshot", () => {
  test("membaca seluruh tabel melalui satu batch read", async () => {
    const { readOperationalSnapshot } = await import("./snapshot");
    let receivedStatementCount = 0;
    let receivedMode: string | undefined;
    const client = {
      batch: async (statements: unknown[], mode?: string) => {
        receivedStatementCount = statements.length;
        receivedMode = mode;
        return [
          result([{ id_unik: "employee-1", nama: "Operator Uji" }]),
          result(),
          result(),
          result([{ id_libur: 1, nama_libur: "Libur Nasional" }]),
          result([
            { id: "hlw-1", scope_type: "DIVISI", scope_value: "Keamanan" },
          ]),
          result(),
          result([{ id: "default_company", company_name: "SPPG" }]),
          result([{ id: "default_template", name: "Default" }]),
          result(),
          result(),
          result(),
          result(),
          result(),
          result([
            { id: "sc-1", id_karyawan: "employee-1", rate_per_hour: 25000 },
          ]),
          result(),
          result(),
          result(),
          result(),
          result(),
          result(),
          result(),
          result(),
          result(),
          result(),
          result(),
          result(),
          result(),
          result(),
          result(),
          result(),
          result([{ id_jurnal: "jrn-1", materi_disampaikan: "Materi Bab 1" }]),
          result([{ id_leger: "lgr-1", persen_kehadiran: 95.5 }]),
          result([{ revision: 12 }]),
        ];
      },
    } as unknown as Client;

    const snapshot = await readOperationalSnapshot(client);

    expect(receivedMode).toBe("read");
    expect(receivedStatementCount).toBe(33);
    expect(snapshot.revision).toBe(12);
    expect(snapshot.employees).toEqual([
      { id_unik: "employee-1", nama: "Operator Uji" },
    ]);
    expect(snapshot.holidays).toEqual([
      { id_libur: 1, nama_libur: "Libur Nasional" },
    ]);
    expect(snapshot.holidayWhitelists).toEqual([
      { id: "hlw-1", scope_type: "DIVISI", scope_value: "Keamanan" },
    ]);
    expect(snapshot.companyProfiles).toEqual([
      { id: "default_company", company_name: "SPPG" },
    ]);
    expect(snapshot.idCardTemplates).toEqual([
      { id: "default_template", name: "Default" },
    ]);
    expect(snapshot.salaryConfigs).toEqual([
      { id: "sc-1", id_karyawan: "employee-1", rate_per_hour: 25000 },
    ]);
    expect(snapshot.jurnalMengajar).toEqual([
      { id_jurnal: "jrn-1", materi_disampaikan: "Materi Bab 1" },
    ]);
    expect(snapshot.legerKehadiran).toEqual([
      { id_leger: "lgr-1", persen_kehadiran: 95.5 },
    ]);
    expect(snapshot.scanLogs).toEqual([]);
  });
});

/** Klien tiruan: 33 hasil batch kosong, plus `execute` yang bisa diatur. */
function clientDenganExecute(
  execute: (arg: { sql: string; args: unknown[] }) => Promise<ResultSet>,
) {
  return {
    batch: async () => [
      ...Array.from({ length: 32 }, () => result()),
      result([{ revision: 5 }]),
    ],
    execute,
  } as unknown as Client;
}

describe("tombstone pada jalur server aplikasi", () => {
  test("mengembalikan penghapusan sejak kursor dan memajukan kursornya", async () => {
    const { readOperationalSnapshot } = await import("./snapshot");
    let sinceDiterima: unknown;
    const client = clientDenganExecute(async ({ sql, args }) => {
      expect(sql).toContain("FROM sync_tombstone");
      sinceDiterima = args[0];
      return result([
        { id: 8, table_name: "akademik_rombel", entity_key: "rb-1" },
        { id: 11, table_name: "jurnal_mengajar", entity_key: "jrn-9" },
        // Baris cacat diabaikan, bukan diteruskan sebagai penghapusan.
        { id: 12, table_name: "", entity_key: "" },
      ]);
    });

    const snapshot = await readOperationalSnapshot(client, 4);

    expect(sinceDiterima).toBe(4);
    expect(snapshot.tombstones).toEqual([
      { table: "akademik_rombel", entityKey: "rb-1" },
      { table: "jurnal_mengajar", entityKey: "jrn-9" },
    ]);
    expect(snapshot.tombstoneCursor).toBe(12);
  });

  test("database tanpa tabel sync_tombstone tidak mematikan snapshot", async () => {
    const { readOperationalSnapshot } = await import("./snapshot");
    const client = clientDenganExecute(async () => {
      throw new Error("no such table: sync_tombstone");
    });

    const snapshot = await readOperationalSnapshot(client, 4);

    // Snapshot tetap terkirim, dan kursornya TIDAK maju: perangkat mencoba
    // lagi siklus berikutnya alih-alih melompati penghapusan yang belum terbaca.
    expect(snapshot.revision).toBe(5);
    expect(snapshot.tombstones).toEqual([]);
    expect(snapshot.tombstoneCursor).toBe(4);
  });
});
