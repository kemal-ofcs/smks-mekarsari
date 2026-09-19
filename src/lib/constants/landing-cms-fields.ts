/**
 * Konfigurasi field CMS landing page untuk panel admin (web-desktop & mobile).
 *
 * Tiap sub-tab berisi field teks tunggal (judul, subjudul, dan sejenisnya)
 * ditambah paling banyak SATU koleksi berulang (`KOLEKSI_LANDING`) yang
 * disunting lewat repeater. Situs publik tidak membawa teks bawaan apa pun:
 * yang belum diisi di sini tidak tampil di sana.
 */

export interface CmsFieldConfig {
  key: string;
  label: string;
  type: "text" | "textarea";
  placeholder: string;
  rows?: number;
  description?: string;
}

export interface CmsSubSectionConfig {
  id: string;
  title: string;
  description: string;
  fields: CmsFieldConfig[];
}

/**
 * Field halaman Profil, Kontak, dan Program — dipakai panel Desktop DAN Mobile.
 *
 * Dulu hanya panel Desktop yang punya daftar ini; Mobile merender kunci yang
 * KEBETULAN sudah ada di database, sehingga pada pemasangan baru tab-tab itu
 * kosong dan tidak ada satu field pun yang bisa diisi dari ponsel.
 *
 * Kunci `profil.tagline`, `profil.deskripsi_singkat`, `profil.akreditasi`,
 * `profil.slogan`, dan `kontak.jam_kerja` juga dibaca header/footer situs
 * publik di SETIAP halaman.
 */
export const HALAMAN_CMS: Record<
  string,
  { title: string; fields: CmsFieldConfig[] }
> = {
  profil: {
    title: "Halaman Profil Sekolah",
    fields: [
      {
        key: "profil.visi",
        label: "Visi Sekolah",
        type: "textarea",
        placeholder: "Tuliskan visi sekolah...",
        rows: 3,
      },
      {
        key: "profil.misi",
        label: "Misi Sekolah",
        type: "textarea",
        placeholder: "Tuliskan misi sekolah (pisahkan dengan baris baru)...",
        rows: 5,
      },
      {
        key: "profil.sejarah",
        label: "Sejarah Singkat",
        type: "textarea",
        placeholder: "Tuliskan sejarah berdirinya sekolah...",
        rows: 5,
      },
      {
        key: "profil.sambutan",
        label: "Sambutan Kepala Sekolah",
        type: "textarea",
        placeholder: "Sambutan hangat dari kepala sekolah...",
        rows: 5,
      },
      {
        key: "profil.tagline",
        label: "Tagline Singkat",
        type: "text",
        placeholder: "Institusi Pendidikan Unggulan",
        description:
          "Tampil di bawah nama sekolah pada header (bila nama cabang kosong) dan footer.",
      },
      {
        key: "profil.deskripsi_singkat",
        label: "Deskripsi Singkat (Footer)",
        type: "textarea",
        placeholder: "Satu-dua kalimat tentang sekolah.",
        rows: 2,
      },
      {
        key: "profil.akreditasi",
        label: "Status Akreditasi",
        type: "text",
        placeholder: "Terakreditasi A (BAN-S/M)",
        description:
          "Tampil sebagai lencana di header dan footer setiap halaman. Kosongkan bila belum terakreditasi — situs tidak menampilkan klaim apa pun tanpa isian ini.",
      },
      {
        key: "profil.slogan",
        label: "Slogan Baris Bawah Footer",
        type: "text",
        placeholder: "Slogan singkat sekolah",
      },
    ],
  },
  kontak: {
    title: "Informasi Kontak & Lokasi",
    fields: [
      {
        key: "kontak.alamat",
        label: "Alamat Lengkap",
        type: "textarea",
        placeholder: "Alamat jalan, kelurahan, kecamatan, kota/kabupaten...",
        rows: 2,
      },
      {
        key: "kontak.telepon",
        label: "Nomor Telepon Kantor",
        type: "text",
        placeholder: "(021) 1234567",
      },
      {
        key: "kontak.whatsapp",
        label: "Nomor WhatsApp Humas / Info",
        type: "text",
        placeholder: "+6281234567890",
      },
      {
        key: "kontak.email",
        label: "Email Resmi",
        type: "text",
        placeholder: "info@sekolah.sch.id",
      },
      {
        key: "kontak.jam_kerja",
        label: "Jam Layanan / Kerja",
        type: "text",
        placeholder: "Senin - Jumat, 07:00 - 16:00 WIB",
      },
    ],
  },
  program: {
    title: "Program & Fasilitas",
    fields: [
      {
        key: "program.kejuruan_ringkasan",
        label: "Ringkasan Program Kejuruan",
        type: "textarea",
        placeholder:
          "Penjelasan umum mengenai konsentrasi keahlian yang dibuka...",
        rows: 4,
      },
      {
        key: "program.fasilitas_ringkasan",
        label: "Ringkasan Fasilitas",
        type: "textarea",
        placeholder:
          "Laboratorium komputer modern, bengkel praktik standar industri...",
        rows: 4,
      },
      {
        key: "program.ekstrakurikuler_ringkasan",
        label: "Ringkasan Ekstrakurikuler",
        type: "textarea",
        placeholder: "Pengembangan minat dan bakat siswa...",
        rows: 4,
      },
    ],
  },
};

export const LANDING_PAGE_SUBSECTIONS: CmsSubSectionConfig[] = [
  {
    id: "hero_stats",
    title: "Hero & Statistik Cepat",
    description:
      "Headline, subheadline, lencana, dan kartu statistik di bagian paling atas halaman. Judul yang dikosongkan memakai nama sekolah.",
    fields: [
      {
        key: "landing.hero_badge",
        label: "Badge Pill Atas (Akreditasi & Nama Sekolah)",
        type: "text",
        placeholder: "Akreditasi A Unggul (BAN-SM)",
      },
      {
        key: "landing.hero_title",
        label: "Judul Utama (Headline)",
        type: "text",
        placeholder:
          "Wujudkan Generasi Pemimpin Cerdas, Berkarakter & Berdaya Saing Global",
      },
      {
        key: "landing.hero_subtitle",
        label: "Subjudul Utama",
        type: "textarea",
        rows: 3,
        placeholder:
          "Pendidikan holistik memadukan ketangguhan karakter moral, pengayaan kurikulum internasional, serta ekosistem pembelajaran modern berbasis riset dan teknologi masa depan.",
      },
    ],
  },
  {
    id: "pillars_leader",
    title: "Pilar Keunggulan & Sambutan Pimpinan",
    description:
      "Pilar pendidikan institusi dan kartu sambutan pimpinan. Sambutan baru tampil bila kutipan atau isinya diisi.",
    fields: [
      {
        key: "landing.pillars_eyebrow",
        label: "Eyebrow Bagian",
        type: "text",
        placeholder: "Keunggulan Institusi",
      },
      {
        key: "landing.pillars_title",
        label: "Judul Bagian Pilar",
        type: "text",
        placeholder: "4 Pilar Pendidikan Masa Depan",
      },
      {
        key: "landing.pillars_subtitle",
        label: "Subjudul Bagian Pilar",
        type: "textarea",
        rows: 2,
        placeholder:
          "Kami memadukan ketangguhan moral spiritual, kurikulum berstandar internasional, serta ekosistem pembelajaran modern untuk melahirkan inovator muda yang berakhlak mulia.",
      },
      {
        key: "landing.pillars_badge",
        label: "Badge Kanan (Sertifikasi/Akreditasi Kampus)",
        type: "text",
        placeholder: "Green & Digital Eco-Campus Bersertifikasi",
      },
      // Sambutan Pimpinan
      {
        key: "landing.sambutan_nama",
        label: "Sambutan — Nama Pimpinan / Tokoh",
        type: "text",
        placeholder: "Nanang Kosim",
        description:
          "Kosongkan untuk memakai nama pimpinan dari profil sekolah.",
      },
      {
        key: "landing.sambutan_jabatan",
        label: "Sambutan — Jabatan",
        type: "text",
        placeholder: "Kepala Yayasan",
        description: "Kosongkan untuk memakai jabatan dari profil sekolah.",
      },
      {
        key: "landing.sambutan_badge",
        label: "Sambutan — Badge Penugasan",
        type: "text",
        placeholder: "Dewan Pembina Kurikulum",
      },
      {
        key: "landing.sambutan_quote",
        label: "Sambutan — Kutipan Visi (Quote Tebal)",
        type: "textarea",
        rows: 3,
        placeholder:
          "“Pendidikan sejati bukan sekadar mengisi wadah pengetahuan, melainkan menyalakan api keingintahuan, memperkuat kompas moral, dan membekali anak-anak kita dengan keberanian untuk menjadi pemecah masalah di panggung global.”",
      },
      {
        key: "landing.sambutan_body",
        label: "Sambutan — Paragraf Pesan Tambahan",
        type: "textarea",
        rows: 3,
        placeholder:
          "Kami menyambut hangat setiap calon siswa dan orang tua untuk bertumbuh bersama dalam keluarga besar sekolah kami. Mari persiapkan generasi emas yang mandiri, berkarakter, dan berdaya saing internasional.",
      },
    ],
  },
  {
    id: "extracurricular",
    title: "Ekstrakurikuler Unggulan",
    description:
      "Klub dan kegiatan kesiswaan pada tab Ekstrakurikuler di landing page. Jurusan dikelola di menu Akademik.",
    fields: [
      {
        key: "landing.ekskul_eyebrow",
        label: "Eyebrow Bagian",
        type: "text",
        placeholder: "Eksplorasi Minat & Bakat",
      },
      {
        key: "landing.ekskul_title",
        label: "Judul Bagian",
        type: "text",
        placeholder: "Program Akademik & Pengembangan Diri",
      },
      {
        key: "landing.ekskul_subtitle",
        label: "Subjudul Bagian",
        type: "textarea",
        rows: 2,
        placeholder:
          "Pilihan kurikulum terintegrasi dan wadah ekstrakurikuler komprehensif untuk mengasah potensi intelektual, artistik, dan kepemimpinan setiap siswa.",
      },
    ],
  },
  {
    id: "facilities",
    title: "Fasilitas Kampus & Spesifikasi",
    description:
      "Sarana prasarana beserta rincian spesifikasinya. Tanpa satu fasilitas pun, bagian ini tidak ditampilkan.",
    fields: [
      {
        key: "landing.fasilitas_eyebrow",
        label: "Eyebrow Bagian",
        type: "text",
        placeholder: "Infrastruktur Kampus",
      },
      {
        key: "landing.fasilitas_title",
        label: "Judul Bagian",
        type: "text",
        placeholder: "Fasilitas Modern Penunjang Potensi",
      },
      {
        key: "landing.fasilitas_subtitle",
        label: "Subjudul Bagian",
        type: "textarea",
        rows: 2,
        placeholder:
          "Sarana dan prasarana berstandar internasional yang dirancang untuk kenyamanan belajar, kesehatan raga, dan eksplorasi kreativitas tanpa batas.",
      },
    ],
  },
  {
    id: "pmb",
    title: "Alur Pendaftaran (PMB)",
    description:
      "Judul dan tahapan pendaftaran. Tahapan yang sama dipakai di beranda dan di halaman Pendaftaran; kotak gelombang tetap diatur di menu PMB.",
    fields: [
      {
        key: "landing.pmb_eyebrow",
        label: "Eyebrow Bagian",
        type: "text",
        placeholder: "Penerimaan Murid Baru",
      },
      {
        key: "landing.pmb_title",
        label: "Judul Bagian",
        type: "text",
        placeholder: "Alur Pendaftaran",
      },
      {
        key: "landing.pmb_subtitle",
        label: "Subjudul Bagian",
        type: "textarea",
        rows: 2,
        placeholder: "Ringkasan proses seleksi penerimaan murid baru.",
      },
      {
        key: "landing.pmb_tahapan_title",
        label: "Judul Daftar Tahapan",
        type: "text",
        placeholder: "Langkah Menjadi Bagian Sekolah Kami",
        description:
          "Hindari menulis jumlah langkah di sini — jumlahnya mengikuti isi daftar tahapan di bawah.",
      },
    ],
  },
  {
    id: "faq",
    title: "Pertanyaan Umum (FAQ)",
    description:
      "Tanya-jawab yang tampil di bagian bawah beranda. Tanpa satu pertanyaan pun, bagian ini tidak ditampilkan.",
    fields: [
      {
        key: "landing.faq_eyebrow",
        label: "Eyebrow Bagian",
        type: "text",
        placeholder: "Pusat Bantuan Informasi",
      },
      {
        key: "landing.faq_title",
        label: "Judul Bagian",
        type: "text",
        placeholder: "Pertanyaan yang Sering Diajukan",
      },
      {
        key: "landing.faq_subtitle",
        label: "Subjudul Bagian",
        type: "textarea",
        rows: 2,
        placeholder: "Jawaban atas pertanyaan umum seputar sekolah.",
      },
    ],
  },
];

/**
 * Koleksi berulang per sub-tab landing — satu koleksi per sub-tab.
 *
 * Tiap koleksi satu baris `konten_publik` berisi JSON array; jumlah itemnya
 * ditentukan orang yang mengisi, bukan kode.
 *
 * `kunci` dan `fields[].name` adalah KONTRAK dengan
 * `web-public/src/lib/services/landing-collections.ts` dan diuji di kedua sisi.
 * Mengubahnya di satu sisi saja membuat koleksinya terbaca kosong di situs
 * publik tanpa satu pun pesan kesalahan.
 */
export interface KoleksiLandingConfig {
  kunci: string;
  label: string;
  description: string;
  maksItem: number;
  fields: {
    name: string;
    label: string;
    type?: "text" | "textarea";
    placeholder?: string;
    multiline?: boolean;
  }[];
  /**
   * Kunci bernomor versi lama (`landing.pilar1_title`, …). Hanya empat blok
   * pertama yang pernah memakainya; FAQ dan tahapan PMB lahir sebagai koleksi.
   */
  lama?: { awalan: string; peta: Record<string, string> };
}

export const MAKS_ITEM_KOLEKSI_LANDING = 24;

export const KOLEKSI_LANDING: Record<string, KoleksiLandingConfig> = {
  hero_stats: {
    kunci: "landing.stat_items",
    label: "Kartu Statistik",
    description:
      "Kartu angka di bawah judul hero. Ikonnya diputar otomatis mengikuti urutan.",
    maksItem: MAKS_ITEM_KOLEKSI_LANDING,
    fields: [
      { name: "label", label: "Label", placeholder: "Akreditasi" },
      { name: "value", label: "Angka", placeholder: "A" },
      { name: "sub", label: "Keterangan", placeholder: "BAN-SM" },
    ],
    lama: {
      awalan: "stat",
      peta: { label: "label", value: "value", sub: "sub" },
    },
  },
  pillars_leader: {
    kunci: "landing.pilar_items",
    label: "Pilar Keunggulan",
    description: "Kartu pilar pendidikan. Jumlahnya bebas.",
    maksItem: MAKS_ITEM_KOLEKSI_LANDING,
    fields: [
      { name: "title", label: "Judul Pilar" },
      { name: "desc", label: "Deskripsi", type: "textarea" },
      { name: "tag", label: "Label Kecil (tag)" },
    ],
    lama: {
      awalan: "pilar",
      peta: { title: "title", desc: "desc", tag: "tag" },
    },
  },
  extracurricular: {
    kunci: "landing.ekskul_items",
    label: "Ekstrakurikuler",
    description: "Daftar klub dan kegiatan kesiswaan.",
    maksItem: MAKS_ITEM_KOLEKSI_LANDING,
    fields: [
      { name: "title", label: "Nama Kegiatan" },
      { name: "category", label: "Kategori" },
      { name: "desc", label: "Deskripsi", type: "textarea" },
    ],
    // Ejaan kunci lamanya `_cat`, sedangkan field koleksinya `category`.
    lama: {
      awalan: "ekskul",
      peta: { title: "title", category: "cat", desc: "desc" },
    },
  },
  facilities: {
    kunci: "landing.fasilitas_items",
    label: "Fasilitas",
    description: "Kartu fasilitas kampus beserta rincian spesifikasinya.",
    maksItem: MAKS_ITEM_KOLEKSI_LANDING,
    fields: [
      { name: "name", label: "Nama Fasilitas" },
      { name: "tag", label: "Label Kecil (tag)" },
      { name: "desc", label: "Deskripsi Singkat", type: "textarea" },
      { name: "specs", label: "Spesifikasi", multiline: true },
    ],
    lama: {
      awalan: "fasilitas",
      peta: { name: "name", tag: "tag", desc: "desc", specs: "specs" },
    },
  },
  pmb: {
    kunci: "landing.pmb_tahapan_items",
    label: "Tahapan Pendaftaran",
    description:
      "Urutan langkah pendaftaran. Nomor langkah dihitung otomatis dari urutan.",
    maksItem: MAKS_ITEM_KOLEKSI_LANDING,
    fields: [
      { name: "title", label: "Nama Tahapan", placeholder: "Isi Formulir" },
      { name: "desc", label: "Penjelasan", type: "textarea" },
    ],
  },
  faq: {
    kunci: "landing.faq_items",
    label: "Daftar Tanya-Jawab",
    description: "Pertanyaan pertama tampil terbuka di beranda.",
    maksItem: MAKS_ITEM_KOLEKSI_LANDING,
    fields: [
      { name: "q", label: "Pertanyaan" },
      { name: "a", label: "Jawaban", type: "textarea" },
    ],
  },
};

type ItemKoleksi = Record<string, unknown>;

function uraiJsonKoleksi(nilai: string | undefined): ItemKoleksi[] {
  try {
    const mentah = JSON.parse(String(nilai ?? "").trim() || "[]");
    if (!Array.isArray(mentah)) return [];
    return mentah.filter(
      (item): item is ItemKoleksi =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
  } catch {
    // JSON rusak = koleksi kosong, bukan galat: satu baris cacat tidak boleh
    // mengunci seluruh panel konten.
    return [];
  }
}

function kunciLama(koleksi: KoleksiLandingConfig): string[] {
  if (!koleksi.lama) return [];
  const hasil: string[] = [];
  for (let nomor = 1; nomor <= koleksi.maksItem; nomor++) {
    for (const akhiran of Object.values(koleksi.lama.peta)) {
      hasil.push(`landing.${koleksi.lama.awalan}${nomor}_${akhiran}`);
    }
  }
  return hasil;
}

/**
 * Isi repeater dari konten yang dimuat.
 *
 * Bila koleksinya masih kosong tetapi kunci bernomor lama berisi, repeater
 * diisi dari kunci lama — itu yang dilihat pengunjung situs saat ini. Tanpa
 * ini admin melihat repeater kosong sementara situsnya menampilkan isi, dan
 * menyimpan halaman akan terasa seperti menghapus konten yang tidak terlihat.
 */
export function muatKoleksiLanding(
  konten: Record<string, string | undefined>,
): Record<string, ItemKoleksi[]> {
  const hasil: Record<string, ItemKoleksi[]> = {};
  for (const koleksi of Object.values(KOLEKSI_LANDING)) {
    let daftar = uraiJsonKoleksi(konten[koleksi.kunci]);
    if (daftar.length === 0 && koleksi.lama) {
      const { awalan, peta } = koleksi.lama;
      for (let nomor = 1; nomor <= koleksi.maksItem; nomor++) {
        const item: ItemKoleksi = {};
        let adaIsi = false;
        for (const [field, akhiran] of Object.entries(peta)) {
          const nilai = String(
            konten[`landing.${awalan}${nomor}_${akhiran}`] ?? "",
          ).trim();
          if (!nilai) continue;
          adaIsi = true;
          const config = koleksi.fields.find((f) => f.name === field);
          item[field] = config?.multiline
            ? nilai
                .split("\n")
                .map((baris) => baris.trim())
                .filter(Boolean)
            : nilai;
        }
        if (adaIsi) daftar.push(item);
      }
    }
    daftar = daftar.slice(0, koleksi.maksItem);
    hasil[koleksi.kunci] = daftar;
  }
  return hasil;
}

/**
 * Konten siap simpan: koleksi diserialisasi jadi JSON, dan SELURUH kunci
 * bernomor lama dikosongkan.
 *
 * Pengosongan itu yang membuat perpindahan ke koleksi tuntas. Situs publik
 * masih membaca kunci lama sebagai cadangan ketika koleksinya kosong, jadi
 * tanpa ini menghapus semua item di repeater akan menghidupkan kembali isi
 * lama yang sudah dihapus. Koleksi kosong disimpan sebagai string kosong,
 * yang situs publik perlakukan sama dengan belum diisi.
 */
export function siapkanSimpanLanding(
  konten: Record<string, string>,
  koleksiItems: Record<string, ItemKoleksi[]>,
): Record<string, string> {
  const hasil = { ...konten };
  for (const koleksi of Object.values(KOLEKSI_LANDING)) {
    const daftar = (koleksiItems[koleksi.kunci] ?? []).slice(
      0,
      koleksi.maksItem,
    );
    hasil[koleksi.kunci] = daftar.length > 0 ? JSON.stringify(daftar) : "";
    for (const kunci of kunciLama(koleksi)) {
      if (kunci in hasil) hasil[kunci] = "";
    }
  }
  return hasil;
}
