import { expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));

test("kegagalan fetch database dilaporkan sebagai layanan sementara", async () => {
  const { toApiErrorResponse } = await import("./api-response");
  const response = toApiErrorResponse(new TypeError("fetch failed"));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    sukses: false,
    pesan:
      "Database server sedang tidak dapat dijangkau. Periksa koneksi internet lalu coba sinkronkan kembali.",
  });
});

test("galat database mentah tidak diteruskan ke klien", async () => {
  const { toApiErrorResponse } = await import("./api-response");
  // Galat aslinya sengaja dicatat ke log server; di tes ini log itu hanya
  // akan tampil sebagai baris `error:` palsu di keluaran gerbang kualitas.
  const diam = spyOn(console, "error").mockImplementation(() => {});
  const response = toApiErrorResponse(
    new Error("SQLite error: no such table: riwayat_identitas_karyawan"),
  );
  expect(diam).toHaveBeenCalled();
  diam.mockRestore();

  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body.pesan).not.toContain("riwayat_identitas_karyawan");
});

test("pesan domain tetap diteruskan apa adanya", async () => {
  const { toApiErrorResponse } = await import("./api-response");
  const response = toApiErrorResponse(
    new Error("Shift masih dipakai karyawan."),
  );

  expect(response.status).toBe(409);
  expect((await response.json()).pesan).toBe("Shift masih dipakai karyawan.");
});
