import { describe, expect, test } from "bun:test";
import { normalisasiRiwayatIdentitas } from "@/lib/validations/employee-identity";

describe("riwayat identitas karyawan", () => {
  test("baris mentah dari Rust atau Web dinormalkan ke satu bentuk", () => {
    const entry = normalisasiRiwayatIdentitas({
      id_riwayat: "7",
      waktu: "2026-09-23 10:00:00",
      id_unik: "K-01",
      data_lama: JSON.stringify({ nama: "Ani", id_shift: 1 }),
      data_baru: JSON.stringify({ nama: "Budi" }),
      kode_operator: "OP009",
      client_id: null,
      event_id: undefined,
    });
    expect(entry).toMatchObject({
      id: 7,
      idUnik: "K-01",
      dataLama: { nama: "Ani", id_shift: "1" },
      dataBaru: { nama: "Budi" },
      kodeOperator: "OP009",
      clientId: "",
      eventId: "",
    });
  });

  test("JSON rusak tidak menjatuhkan halaman riwayat", () => {
    const entry = normalisasiRiwayatIdentitas({ data_lama: "{rusak" });
    expect(entry.dataLama).toEqual({});
  });
});
