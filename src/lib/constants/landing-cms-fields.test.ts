import { describe, expect, test } from "bun:test";
import {
  HALAMAN_CMS,
  KOLEKSI_LANDING,
  LANDING_PAGE_SUBSECTIONS,
  muatKoleksiLanding,
  siapkanSimpanLanding,
} from "./landing-cms-fields";

describe("CMS landing: koleksi dan perpindahan kunci lama", () => {
  /**
   * Nama kunci koleksi adalah kontrak dengan
   * `web-public/src/lib/services/landing-collections.ts`, yang menguji set
   * yang sama di sisinya. Berubah di satu sisi saja = situs membaca kosong.
   */
  test("kunci koleksi sama dengan yang dibaca situs publik", () => {
    expect(
      Object.values(KOLEKSI_LANDING)
        .map((k) => k.kunci)
        .sort(),
    ).toEqual(
      [
        "landing.stat_items",
        "landing.pilar_items",
        "landing.ekskul_items",
        "landing.fasilitas_items",
        "landing.pmb_tahapan_items",
        "landing.faq_items",
      ].sort(),
    );
  });

  test("setiap koleksi terpasang pada sub-tab yang benar-benar ada", () => {
    const idSubTab = new Set(LANDING_PAGE_SUBSECTIONS.map((s) => s.id));
    for (const id of Object.keys(KOLEKSI_LANDING)) {
      expect(idSubTab.has(id)).toBe(true);
    }
  });

  /**
   * Keempat blok berulang kini koleksi. Field bernomor yang tersisa di panel
   * akan menulis kunci yang tidak dibaca situs selama koleksinya berisi —
   * tombol yang tidak melakukan apa-apa.
   */
  test("panel tidak lagi punya field bernomor", () => {
    const semua = LANDING_PAGE_SUBSECTIONS.flatMap((s) =>
      s.fields.map((f) => f.key),
    );
    expect(
      semua.filter((k) =>
        /^landing\.(stat|pilar|ekskul|fasilitas)\d+_/.test(k),
      ),
    ).toEqual([]);
  });

  /**
   * Tanpa ini admin melihat repeater kosong sementara situsnya menampilkan
   * isi dari kunci lama, dan menyimpan halaman terasa seperti menghapus konten
   * yang tidak terlihat.
   */
  test("repeater diisi dari kunci bernomor lama bila koleksinya kosong", () => {
    const hasil = muatKoleksiLanding({
      "landing.pilar1_title": "Pilar Lama",
      "landing.pilar1_tag": "Tag",
      "landing.ekskul2_cat": "Olahraga",
      "landing.fasilitas1_name": "Lab",
      "landing.fasilitas1_specs": "Spek A\n\n  Spek B ",
    });
    expect(hasil["landing.pilar_items"]).toEqual([
      { title: "Pilar Lama", tag: "Tag" },
    ]);
    // Ejaan kunci lama `_cat` dipetakan ke field koleksi `category`.
    expect(hasil["landing.ekskul_items"]).toEqual([{ category: "Olahraga" }]);
    // Spesifikasi berbaris-baris menjadi array, baris kosong dibuang.
    expect(hasil["landing.fasilitas_items"]).toEqual([
      { name: "Lab", specs: ["Spek A", "Spek B"] },
    ]);
    expect(hasil["landing.faq_items"]).toEqual([]);
  });

  test("koleksi yang sudah ada menang atas kunci lama", () => {
    const hasil = muatKoleksiLanding({
      "landing.pilar_items": '[{"title":"Baru"}]',
      "landing.pilar1_title": "Lama",
    });
    expect(hasil["landing.pilar_items"]).toEqual([{ title: "Baru" }]);
  });

  test("JSON rusak menjadi koleksi kosong, bukan galat", () => {
    expect(
      muatKoleksiLanding({ "landing.faq_items": "[{rusak" }),
    ).toMatchObject({ "landing.faq_items": [] });
  });

  /**
   * Situs publik membaca kunci lama sebagai cadangan ketika koleksinya kosong.
   * Tanpa pengosongan ini, menghapus semua item di repeater akan menghidupkan
   * kembali isi lama yang baru saja dihapus.
   */
  test("menyimpan mengosongkan kunci lama dan menyerialisasi koleksi", () => {
    const konten = {
      "landing.pilar1_title": "Lama",
      "landing.pilar2_desc": "Lama juga",
      "landing.pillars_title": "Judul tetap",
    };
    const siap = siapkanSimpanLanding(konten, {
      "landing.pilar_items": [{ title: "Baru", desc: "", tag: "" }],
    });
    expect(siap["landing.pilar1_title"]).toBe("");
    expect(siap["landing.pilar2_desc"]).toBe("");
    // Field teks tunggal tidak disentuh.
    expect(siap["landing.pillars_title"]).toBe("Judul tetap");
    expect(JSON.parse(siap["landing.pilar_items"])).toEqual([
      { title: "Baru", desc: "", tag: "" },
    ]);
  });

  test("koleksi kosong disimpan sebagai string kosong, bukan '[]'", () => {
    const siap = siapkanSimpanLanding({}, { "landing.faq_items": [] });
    expect(siap["landing.faq_items"]).toBe("");
    // Kunci lama yang tidak pernah dimuat tidak dibuatkan baris kosong.
    expect("landing.pilar1_title" in siap).toBe(false);
  });

  /**
   * Klaim akreditasi di header situs harus datang dari sekolah itu sendiri.
   * Kunci-kunci ini dibaca header/footer publik di setiap halaman.
   */
  test("field header/footer situs tersedia di tab Profil dan Kontak", () => {
    const profil = HALAMAN_CMS.profil.fields.map((f) => f.key);
    for (const kunci of [
      "profil.tagline",
      "profil.deskripsi_singkat",
      "profil.akreditasi",
      "profil.slogan",
    ]) {
      expect(profil).toContain(kunci);
    }
    expect(HALAMAN_CMS.kontak.fields.map((f) => f.key)).toContain(
      "kontak.jam_kerja",
    );
  });
});
