/**
 * Metadata konfigurasi field dan kamus nilai bawaan (fallback) untuk CMS Halaman Landing Page.
 * Digunakan secara bersama oleh Panel Admin (web-desktop & mobile) dan Situs Publik (web-public).
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

export const LANDING_PAGE_SUBSECTIONS: CmsSubSectionConfig[] = [
  {
    id: "hero_stats",
    title: "Hero & Statistik Cepat",
    description:
      "Kelola teks headline, subheadline, badge akreditasi, dan 4 kotak metrik statistik di bagian paling atas halaman.",
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
      // Stat 1: Akreditasi
      {
        key: "landing.stat1_label",
        label: "Stat 1 — Label",
        type: "text",
        placeholder: "Akreditasi A",
      },
      {
        key: "landing.stat1_value",
        label: "Stat 1 — Nilai / Skor",
        type: "text",
        placeholder: "98 / 100",
      },
      {
        key: "landing.stat1_sub",
        label: "Stat 1 — Keterangan Bawah",
        type: "text",
        placeholder: "BAN-SM Predikat Unggul",
      },
      // Stat 2: Lulusan PTN/LN
      {
        key: "landing.stat2_label",
        label: "Stat 2 — Label",
        type: "text",
        placeholder: "Lulusan PTN/LN",
      },
      {
        key: "landing.stat2_value",
        label: "Stat 2 — Nilai / Persentase",
        type: "text",
        placeholder: "98.4%",
      },
      {
        key: "landing.stat2_sub",
        label: "Stat 2 — Keterangan Bawah",
        type: "text",
        placeholder: "UI, ITB, UGM & Luar Negeri",
      },
      // Stat 3: Prestasi
      {
        key: "landing.stat3_label",
        label: "Stat 3 — Label",
        type: "text",
        placeholder: "Prestasi 2024",
      },
      {
        key: "landing.stat3_value",
        label: "Stat 3 — Nilai / Jumlah",
        type: "text",
        placeholder: "150+",
      },
      {
        key: "landing.stat3_sub",
        label: "Stat 3 — Keterangan Bawah",
        type: "text",
        placeholder: "Tingkat Nasional & Dunia",
      },
      // Stat 4: Komunitas
      {
        key: "landing.stat4_label",
        label: "Stat 4 — Label",
        type: "text",
        placeholder: "Komunitas",
      },
      {
        key: "landing.stat4_value",
        label: "Stat 4 — Nilai / Jumlah",
        type: "text",
        placeholder: "1.250+",
      },
      {
        key: "landing.stat4_sub",
        label: "Stat 4 — Keterangan Bawah",
        type: "text",
        placeholder: "Siswa & Alumni Aktif",
      },
    ],
  },
  {
    id: "pillars_leader",
    title: "4 Pilar Keunggulan & Sambutan Pimpinan",
    description:
      "Kelola 4 pilar pendidikan institusi dan kartu sambutan pimpinan yayasan / kepala sekolah.",
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
      // Pilar 1
      {
        key: "landing.pilar1_title",
        label: "Pilar 1 — Judul",
        type: "text",
        placeholder: "Kurikulum Adaptif & Global",
      },
      {
        key: "landing.pilar1_desc",
        label: "Pilar 1 — Deskripsi",
        type: "textarea",
        rows: 3,
        placeholder:
          "Penyelarasan Kurikulum Merdeka dengan standar internasional, bilingual harian, serta muatan riset saintifik dan Coding terapan.",
      },
      {
        key: "landing.pilar1_tag",
        label: "Pilar 1 — Tag / Badge",
        type: "text",
        placeholder: "Bilingual Pathway",
      },
      // Pilar 2
      {
        key: "landing.pilar2_title",
        label: "Pilar 2 — Judul",
        type: "text",
        placeholder: "Pendidik Berintegritas & Magister",
      },
      {
        key: "landing.pilar2_desc",
        label: "Pilar 2 — Deskripsi",
        type: "textarea",
        rows: 3,
        placeholder:
          "Lebih dari 90% staf pengajar berkualifikasi Magister & Doktor lulusan perguruan tinggi terkemuka dengan rasio guru-siswa ideal 1:12.",
      },
      {
        key: "landing.pilar2_tag",
        label: "Pilar 2 — Tag / Badge",
        type: "text",
        placeholder: "Rasio Guru 1:12",
      },
      // Pilar 3
      {
        key: "landing.pilar3_title",
        label: "Pilar 3 — Judul",
        type: "text",
        placeholder: "Bina Karakter & Kepemimpinan",
      },
      {
        key: "landing.pilar3_desc",
        label: "Pilar 3 — Deskripsi",
        type: "textarea",
        rows: 3,
        placeholder:
          "Pembiasaan ibadah harian, program mentoring akhlak 1-on-1, wawasan kebangsaan, serta wadah kepemimpinan organisasi siswa aktif.",
      },
      {
        key: "landing.pilar3_tag",
        label: "Pilar 3 — Tag / Badge",
        type: "text",
        placeholder: "Mentoring Karakter",
      },
      // Pilar 4
      {
        key: "landing.pilar4_title",
        label: "Pilar 4 — Judul",
        type: "text",
        placeholder: "Fasilitas Digital & Lab AI",
      },
      {
        key: "landing.pilar4_desc",
        label: "Pilar 4 — Deskripsi",
        type: "textarea",
        rows: 3,
        placeholder:
          "Smart Classroom interaktif, Laboratorium Robotika & Kecerdasan Buatan modern, perpustakaan digital, serta sarana olahraga berstandar.",
      },
      {
        key: "landing.pilar4_tag",
        label: "Pilar 4 — Tag / Badge",
        type: "text",
        placeholder: "Smart Eco-Campus",
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
      "Kelola daftar 6 klub kegiatan kesiswaan unggulan yang ditampilkan pada tab program di landing page.",
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
      // Ekskul 1
      {
        key: "landing.ekskul1_title",
        label: "Klub 1 — Nama",
        type: "text",
        placeholder: "Robotika & Coding Club",
      },
      {
        key: "landing.ekskul1_cat",
        label: "Klub 1 — Kategori",
        type: "text",
        placeholder: "Sains & Teknologi",
      },
      {
        key: "landing.ekskul1_desc",
        label: "Klub 1 — Deskripsi",
        type: "textarea",
        rows: 2,
        placeholder:
          "Eksplorasi kecerdasan buatan, mikrokontroler IoT, kompetisi robotik nasional & internasional.",
      },
      // Ekskul 2
      {
        key: "landing.ekskul2_title",
        label: "Klub 2 — Nama",
        type: "text",
        placeholder: "Karya Ilmiah Remaja (KIR)",
      },
      {
        key: "landing.ekskul2_cat",
        label: "Klub 2 — Kategori",
        type: "text",
        placeholder: "Riset Akademis",
      },
      {
        key: "landing.ekskul2_desc",
        label: "Klub 2 — Deskripsi",
        type: "textarea",
        rows: 2,
        placeholder:
          "Inkubasi riset sains terapan, bioteknologi, dan publikasi jurnal ilmiah tingkat SMA.",
      },
      // Ekskul 3
      {
        key: "landing.ekskul3_title",
        label: "Klub 3 — Nama",
        type: "text",
        placeholder: "English Debate & Model UN",
      },
      {
        key: "landing.ekskul3_cat",
        label: "Klub 3 — Kategori",
        type: "text",
        placeholder: "Bahasa & Diplomasi",
      },
      {
        key: "landing.ekskul3_desc",
        label: "Klub 3 — Deskripsi",
        type: "textarea",
        rows: 2,
        placeholder:
          "Pengasahan retorika kritis, diplomasi internasional simulasi PBB, serta sertifikasi IELTS/TOEFL.",
      },
      // Ekskul 4
      {
        key: "landing.ekskul4_title",
        label: "Klub 4 — Nama",
        type: "text",
        placeholder: "Sport Club (Basket & Futsal)",
      },
      {
        key: "landing.ekskul4_cat",
        label: "Klub 4 — Kategori",
        type: "text",
        placeholder: "Olahraga & Fisik",
      },
      {
        key: "landing.ekskul4_desc",
        label: "Klub 4 — Deskripsi",
        type: "textarea",
        rows: 2,
        placeholder:
          "Pelatihan fisik intensif bersama pelatih berlisensi nasional, turnamen DBL dan liga antar-sekolah.",
      },
      // Ekskul 5
      {
        key: "landing.ekskul5_title",
        label: "Klub 5 — Nama",
        type: "text",
        placeholder: "Desain Grafis & Sinematografi",
      },
      {
        key: "landing.ekskul5_cat",
        label: "Klub 5 — Kategori",
        type: "text",
        placeholder: "Kreatif & Seni",
      },
      {
        key: "landing.ekskul5_desc",
        label: "Klub 5 — Deskripsi",
        type: "textarea",
        rows: 2,
        placeholder:
          "Produksi film pendek, fotografi jurnalistik, animasi 3D, serta manajemen media digital sekolah.",
      },
      // Ekskul 6
      {
        key: "landing.ekskul6_title",
        label: "Klub 6 — Nama",
        type: "text",
        placeholder: "Olimpiade Sains Nasional (OSN)",
      },
      {
        key: "landing.ekskul6_cat",
        label: "Klub 6 — Kategori",
        type: "text",
        placeholder: "Intensif Prestasi",
      },
      {
        key: "landing.ekskul6_desc",
        label: "Klub 6 — Deskripsi",
        type: "textarea",
        rows: 2,
        placeholder:
          "Bimbingan khusus calon juara OSN di bidang Matematika, Fisika, Kimia, Astronomi, dan Informatika.",
      },
    ],
  },
  {
    id: "facilities",
    title: "Fasilitas Kampus & Spesifikasi",
    description:
      "Kelola 6 sarana prasarana modern unggulan beserta rincian spesifikasi teknis untuk modal preview.",
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
      // Fasilitas 1
      {
        key: "landing.fasilitas1_name",
        label: "Fasilitas 1 — Nama",
        type: "text",
        placeholder: "Interactive Smart Classroom",
      },
      {
        key: "landing.fasilitas1_tag",
        label: "Fasilitas 1 — Kategori/Tag",
        type: "text",
        placeholder: "Akademik Digital",
      },
      {
        key: "landing.fasilitas1_desc",
        label: "Fasilitas 1 — Ringkasan",
        type: "textarea",
        rows: 2,
        placeholder:
          "Papan tulis pintar 86 inci 4K, sistem tata udara sentral, dan koneksi internet serat optik dedicated.",
      },
      {
        key: "landing.fasilitas1_specs",
        label: "Fasilitas 1 — Spesifikasi (1 baris per poin)",
        type: "textarea",
        rows: 4,
        placeholder:
          "Interactive Smart Board 86 Inch 4K Touch\nKapasitas ergonomis 24 siswa per kelas\nSistem sirkulasi udara HEPA Filter & AC Inverter\nHigh-speed Wi-Fi 6 per ruangan",
        description:
          "Tuliskan 1 poin per baris untuk ditampilkan dalam dialog spesifikasi.",
      },
      // Fasilitas 2
      {
        key: "landing.fasilitas2_name",
        label: "Fasilitas 2 — Nama",
        type: "text",
        placeholder: "Laboratorium Robotika & AI",
      },
      {
        key: "landing.fasilitas2_tag",
        label: "Fasilitas 2 — Kategori/Tag",
        type: "text",
        placeholder: "High-Tech Lab",
      },
      {
        key: "landing.fasilitas2_desc",
        label: "Fasilitas 2 — Ringkasan",
        type: "textarea",
        rows: 2,
        placeholder:
          "Workstation Core i9 generasi terbaru, perangkat mikrokontroler IoT, 3D Printer, dan arena uji robot.",
      },
      {
        key: "landing.fasilitas2_specs",
        label: "Fasilitas 2 — Spesifikasi (1 baris per poin)",
        type: "textarea",
        rows: 4,
        placeholder:
          "40 Unit Workstation Grafis High-Performance\n3D Printer & CNC Laser Cutter untuk prototipe\nToolkit sensor IoT, drone autonomous, dan kit robotik\nLisensi software riset AI & IDE pemrograman",
        description:
          "Tuliskan 1 poin per baris untuk ditampilkan dalam dialog spesifikasi.",
      },
      // Fasilitas 3
      {
        key: "landing.fasilitas3_name",
        label: "Fasilitas 3 — Nama",
        type: "text",
        placeholder: "Perpustakaan Digital & E-Learning",
      },
      {
        key: "landing.fasilitas3_tag",
        label: "Fasilitas 3 — Kategori/Tag",
        type: "text",
        placeholder: "Pusat Riset",
      },
      {
        key: "landing.fasilitas3_desc",
        label: "Fasilitas 3 — Ringkasan",
        type: "textarea",
        rows: 2,
        placeholder:
          "Akses 10.000+ e-book, jurnal internasional terakreditasi, kubikel riset hening, dan ruang diskusi.",
      },
      {
        key: "landing.fasilitas3_specs",
        label: "Fasilitas 3 — Spesifikasi (1 baris per poin)",
        type: "textarea",
        rows: 4,
        placeholder:
          "Akses repositori jurnal Cambridge & JSTOR\nTablet e-reader & workstation katalog digital\nSilent study pods untuk belajar mandiri\nKoleksi literatur fisik 15.000 judul terkurasi",
        description:
          "Tuliskan 1 poin per baris untuk ditampilkan dalam dialog spesifikasi.",
      },
      // Fasilitas 4
      {
        key: "landing.fasilitas4_name",
        label: "Fasilitas 4 — Nama",
        type: "text",
        placeholder: "Indoor Sport Hall & Gymnasium",
      },
      {
        key: "landing.fasilitas4_tag",
        label: "Fasilitas 4 — Kategori/Tag",
        type: "text",
        placeholder: "Kebugaran Fisik",
      },
      {
        key: "landing.fasilitas4_desc",
        label: "Fasilitas 4 — Ringkasan",
        type: "textarea",
        rows: 2,
        placeholder:
          "Lapangan multifungsi basket berstandar FIBA, lapangan futsal vinyl, bulu tangkis, dan fitness corner.",
      },
      {
        key: "landing.fasilitas4_specs",
        label: "Fasilitas 4 — Spesifikasi (1 baris per poin)",
        type: "textarea",
        rows: 4,
        placeholder:
          "Lantai kayu parket standar turnamen DBL/FIBA\nTribun penonton kapasitas 600 orang\nPeralatan kebugaran & conditioning modern\nLoker privat dan kamar mandi bilas bersih",
        description:
          "Tuliskan 1 poin per baris untuk ditampilkan dalam dialog spesifikasi.",
      },
      // Fasilitas 5
      {
        key: "landing.fasilitas5_name",
        label: "Fasilitas 5 — Nama",
        type: "text",
        placeholder: "Studio Podcast & Penyiaran Media",
      },
      {
        key: "landing.fasilitas5_tag",
        label: "Fasilitas 5 — Kategori/Tag",
        type: "text",
        placeholder: "Komunikasi Kreatif",
      },
      {
        key: "landing.fasilitas5_desc",
        label: "Fasilitas 5 — Ringkasan",
        type: "textarea",
        rows: 2,
        placeholder:
          "Peredam suara akustik profesional, kamera cinema 4K, mikrofon broadcast, dan software editing video.",
      },
      {
        key: "landing.fasilitas5_specs",
        label: "Fasilitas 5 — Spesifikasi (1 baris per poin)",
        type: "textarea",
        rows: 4,
        placeholder:
          "Ruang rekaman kedap suara standar broadcast\nMulti-camera setup 4K & switcher video live\nMikrofon podcast Shure dengan audio interface\nWadah kreasi karya jurnalistik siswa & warta sekolah",
        description:
          "Tuliskan 1 poin per baris untuk ditampilkan dalam dialog spesifikasi.",
      },
      // Fasilitas 6
      {
        key: "landing.fasilitas6_name",
        label: "Fasilitas 6 — Nama",
        type: "text",
        placeholder: "Auditorium & Gedung Serbaguna",
      },
      {
        key: "landing.fasilitas6_tag",
        label: "Fasilitas 6 — Kategori/Tag",
        type: "text",
        placeholder: "Ajang Prestasi",
      },
      {
        key: "landing.fasilitas6_desc",
        label: "Fasilitas 6 — Ringkasan",
        type: "textarea",
        rows: 2,
        placeholder:
          "Kapasitas 1.000 kursi dengan tata panggung audio-visual canggih untuk wisuda, seminar, dan festival seni.",
      },
      {
        key: "landing.fasilitas6_specs",
        label: "Fasilitas 6 — Spesifikasi (1 baris per poin)",
        type: "textarea",
        rows: 4,
        placeholder:
          "Kapasitas ampiteater 1.000 audiens\nVideotron LED raksasa P2.5 High-Definition\nSistem tata suara digital line array 20.000 watt\nRuang transit VIP dan ruang rias pengisi acara",
        description:
          "Tuliskan 1 poin per baris untuk ditampilkan dalam dialog spesifikasi.",
      },
    ],
  },
];

/**
 * Kamus seluruh nilai bawaan (fallback) untuk konten Landing Page.
 */
export const LANDING_PAGE_DEFAULTS: Record<string, string> = {
  // Hero & Quick Stats
  "landing.hero_badge": "Akreditasi A Unggul (BAN-SM)",
  "landing.hero_title":
    "Wujudkan Generasi Pemimpin Cerdas, Berkarakter & Berdaya Saing Global",
  "landing.hero_subtitle":
    "Pendidikan holistik memadukan ketangguhan karakter moral, pengayaan kurikulum internasional, serta ekosistem pembelajaran modern berbasis riset dan teknologi masa depan.",
  "landing.stat1_label": "Akreditasi A",
  "landing.stat1_value": "98 / 100",
  "landing.stat1_sub": "BAN-SM Predikat Unggul",
  "landing.stat2_label": "Lulusan PTN/LN",
  "landing.stat2_value": "98.4%",
  "landing.stat2_sub": "UI, ITB, UGM & Luar Negeri",
  "landing.stat3_label": "Prestasi 2024",
  "landing.stat3_value": "150+",
  "landing.stat3_sub": "Tingkat Nasional & Dunia",
  "landing.stat4_label": "Komunitas",
  "landing.stat4_value": "1.250+",
  "landing.stat4_sub": "Siswa & Alumni Aktif",

  // 4 Pilar & Sambutan Pimpinan
  "landing.pillars_eyebrow": "Keunggulan Institusi",
  "landing.pillars_title": "4 Pilar Pendidikan Masa Depan",
  "landing.pillars_subtitle":
    "Kami memadukan ketangguhan moral spiritual, kurikulum berstandar internasional, serta ekosistem pembelajaran modern untuk melahirkan inovator muda yang berakhlak mulia.",
  "landing.pillars_badge": "Green & Digital Eco-Campus Bersertifikasi",

  "landing.pilar1_title": "Kurikulum Adaptif & Global",
  "landing.pilar1_desc":
    "Penyelarasan Kurikulum Merdeka dengan standar internasional, bilingual harian, serta muatan riset saintifik dan Coding terapan.",
  "landing.pilar1_tag": "Bilingual Pathway",

  "landing.pilar2_title": "Pendidik Berintegritas & Magister",
  "landing.pilar2_desc":
    "Lebih dari 90% staf pengajar berkualifikasi Magister & Doktor lulusan perguruan tinggi terkemuka dengan rasio guru-siswa ideal 1:12.",
  "landing.pilar2_tag": "Rasio Guru 1:12",

  "landing.pilar3_title": "Bina Karakter & Kepemimpinan",
  "landing.pilar3_desc":
    "Pembiasaan ibadah harian, program mentoring akhlak 1-on-1, wawasan kebangsaan, serta wadah kepemimpinan organisasi siswa aktif.",
  "landing.pilar3_tag": "Mentoring Karakter",

  "landing.pilar4_title": "Fasilitas Digital & Lab AI",
  "landing.pilar4_desc":
    "Smart Classroom interaktif, Laboratorium Robotika & Kecerdasan Buatan modern, perpustakaan digital, serta sarana olahraga berstandar.",
  "landing.pilar4_tag": "Smart Eco-Campus",

  "landing.sambutan_nama": "Nanang Kosim",
  "landing.sambutan_jabatan": "Kepala Yayasan",
  "landing.sambutan_badge": "Dewan Pembina Kurikulum",
  "landing.sambutan_quote":
    "“Pendidikan sejati bukan sekadar mengisi wadah pengetahuan, melainkan menyalakan api keingintahuan, memperkuat kompas moral, dan membekali anak-anak kita dengan keberanian untuk menjadi pemecah masalah di panggung global.”",
  "landing.sambutan_body":
    "Kami menyambut hangat setiap calon siswa dan orang tua untuk bertumbuh bersama dalam keluarga besar sekolah kami. Mari persiapkan generasi emas yang mandiri, berkarakter, dan berdaya saing internasional.",

  // Ekstrakurikuler Unggulan
  "landing.ekskul_eyebrow": "Eksplorasi Minat & Bakat",
  "landing.ekskul_title": "Program Akademik & Pengembangan Diri",
  "landing.ekskul_subtitle":
    "Pilihan kurikulum terintegrasi dan wadah ekstrakurikuler komprehensif untuk mengasah potensi intelektual, artistik, dan kepemimpinan setiap siswa.",

  "landing.ekskul1_title": "Robotika & Coding Club",
  "landing.ekskul1_cat": "Sains & Teknologi",
  "landing.ekskul1_desc":
    "Eksplorasi kecerdasan buatan, mikrokontroler IoT, kompetisi robotik nasional & internasional.",

  "landing.ekskul2_title": "Karya Ilmiah Remaja (KIR)",
  "landing.ekskul2_cat": "Riset Akademis",
  "landing.ekskul2_desc":
    "Inkubasi riset sains terapan, bioteknologi, dan publikasi jurnal ilmiah tingkat SMA.",

  "landing.ekskul3_title": "English Debate & Model UN",
  "landing.ekskul3_cat": "Bahasa & Diplomasi",
  "landing.ekskul3_desc":
    "Pengasahan retorika kritis, diplomasi internasional simulasi PBB, serta sertifikasi IELTS/TOEFL.",

  "landing.ekskul4_title": "Sport Club (Basket & Futsal)",
  "landing.ekskul4_cat": "Olahraga & Fisik",
  "landing.ekskul4_desc":
    "Pelatihan fisik intensif bersama pelatih berlisensi nasional, turnamen DBL dan liga antar-sekolah.",

  "landing.ekskul5_title": "Desain Grafis & Sinematografi",
  "landing.ekskul5_cat": "Kreatif & Seni",
  "landing.ekskul5_desc":
    "Produksi film pendek, fotografi jurnalistik, animasi 3D, serta manajemen media digital sekolah.",

  "landing.ekskul6_title": "Olimpiade Sains Nasional (OSN)",
  "landing.ekskul6_cat": "Intensif Prestasi",
  "landing.ekskul6_desc":
    "Bimbingan khusus calon juara OSN di bidang Matematika, Fisika, Kimia, Astronomi, dan Informatika.",

  // Fasilitas Kampus & Spesifikasi
  "landing.fasilitas_eyebrow": "Infrastruktur Kampus",
  "landing.fasilitas_title": "Fasilitas Modern Penunjang Potensi",
  "landing.fasilitas_subtitle":
    "Sarana dan prasarana berstandar internasional yang dirancang untuk kenyamanan belajar, kesehatan raga, dan eksplorasi kreativitas tanpa batas.",

  "landing.fasilitas1_name": "Interactive Smart Classroom",
  "landing.fasilitas1_tag": "Akademik Digital",
  "landing.fasilitas1_desc":
    "Papan tulis pintar 86 inci 4K, sistem tata udara sentral, dan koneksi internet serat optik dedicated.",
  "landing.fasilitas1_specs":
    "Interactive Smart Board 86 Inch 4K Touch\nKapasitas ergonomis 24 siswa per kelas\nSistem sirkulasi udara HEPA Filter & AC Inverter\nHigh-speed Wi-Fi 6 per ruangan",

  "landing.fasilitas2_name": "Laboratorium Robotika & AI",
  "landing.fasilitas2_tag": "High-Tech Lab",
  "landing.fasilitas2_desc":
    "Workstation Core i9 generasi terbaru, perangkat mikrokontroler IoT, 3D Printer, dan arena uji robot.",
  "landing.fasilitas2_specs":
    "40 Unit Workstation Grafis High-Performance\n3D Printer & CNC Laser Cutter untuk prototipe\nToolkit sensor IoT, drone autonomous, dan kit robotik\nLisensi software riset AI & IDE pemrograman",

  "landing.fasilitas3_name": "Perpustakaan Digital & E-Learning",
  "landing.fasilitas3_tag": "Pusat Riset",
  "landing.fasilitas3_desc":
    "Akses 10.000+ e-book, jurnal internasional terakreditasi, kubikel riset hening, dan ruang diskusi.",
  "landing.fasilitas3_specs":
    "Akses repositori jurnal Cambridge & JSTOR\nTablet e-reader & workstation katalog digital\nSilent study pods untuk belajar mandiri\nKoleksi literatur fisik 15.000 judul terkurasi",

  "landing.fasilitas4_name": "Indoor Sport Hall & Gymnasium",
  "landing.fasilitas4_tag": "Kebugaran Fisik",
  "landing.fasilitas4_desc":
    "Lapangan multifungsi basket berstandar FIBA, lapangan futsal vinyl, bulu tangkis, dan fitness corner.",
  "landing.fasilitas4_specs":
    "Lantai kayu parket standar turnamen DBL/FIBA\nTribun penonton kapasitas 600 orang\nPeralatan kebugaran & conditioning modern\nLoker privat dan kamar mandi bilas bersih",

  "landing.fasilitas5_name": "Studio Podcast & Penyiaran Media",
  "landing.fasilitas5_tag": "Komunikasi Kreatif",
  "landing.fasilitas5_desc":
    "Peredam suara akustik profesional, kamera cinema 4K, mikrofon broadcast, dan software editing video.",
  "landing.fasilitas5_specs":
    "Ruang rekaman kedap suara standar broadcast\nMulti-camera setup 4K & switcher video live\nMikrofon podcast Shure dengan audio interface\nWadah kreasi karya jurnalistik siswa & warta sekolah",

  "landing.fasilitas6_name": "Auditorium & Gedung Serbaguna",
  "landing.fasilitas6_tag": "Ajang Prestasi",
  "landing.fasilitas6_desc":
    "Kapasitas 1.000 kursi dengan tata panggung audio-visual canggih untuk wisuda, seminar, dan festival seni.",
  "landing.fasilitas6_specs":
    "Kapasitas ampiteater 1.000 audiens\nVideotron LED raksasa P2.5 High-Definition\nSistem tata suara digital line array 20.000 watt\nRuang transit VIP dan ruang rias pengisi acara",
};

/**
 * Koleksi berulang per sub-tab landing.
 *
 * Empat blok ini dulu berupa slot bernomor yang jumlahnya mati di dalam kode
 * (`pilar1_title` sampai `pilar4_title`), sehingga menambah pilar kelima
 * mustahil tanpa menyunting panel ini DAN komponen publiknya sekaligus.
 * Sekarang tiap blok satu baris `konten_publik` berisi JSON array.
 *
 * `kunci` dan `fields[].name` adalah KONTRAK dengan
 * `web-public/src/lib/services/landing-collections.ts`, yang diuji di sana.
 * Mengubah salah satunya di satu sisi saja membuat koleksinya terbaca kosong
 * di situs publik, tanpa satu pun pesan kesalahan yang menjelaskannya.
 *
 * Field bernomor lama SENGAJA dibiarkan di daftar di atas: situs publik masih
 * membacanya sebagai lapis cadangan, jadi pemasangan yang sudah mengisinya
 * tidak kehilangan apa pun sebelum sempat memindahkannya ke koleksi.
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
      { name: "label", label: "Label", placeholder: "Akreditasi A" },
      { name: "value", label: "Angka", placeholder: "98 / 100" },
      {
        name: "sub",
        label: "Keterangan",
        placeholder: "BAN-SM Predikat Unggul",
      },
    ],
  },
  pillars_leader: {
    kunci: "landing.pilar_items",
    label: "Pilar Keunggulan",
    description:
      "Kartu pilar pendidikan. Jumlahnya bebas; judul bagiannya tetap disunting di field di atas.",
    maksItem: MAKS_ITEM_KOLEKSI_LANDING,
    fields: [
      { name: "title", label: "Judul Pilar" },
      { name: "desc", label: "Deskripsi", type: "textarea" },
      { name: "tag", label: "Label Kecil (tag)" },
    ],
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
  },
};
