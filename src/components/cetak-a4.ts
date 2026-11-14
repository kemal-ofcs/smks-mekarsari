import type { KopSekolah } from "@/lib/validations/inventory";

/**
 * Pembantu cetak A4 bersama: berita acara inventaris dan surat kepegawaian
 * (HRIS Fase 3b). Dokumen dirakit sebagai HTML lalu dicetak lewat dialog cetak
 * browser/WebView2 ("Simpan sebagai PDF" tersedia di sana). WebView Android
 * tidak punya dialog cetak, jadi pemanggil menyembunyikan tombolnya di Mobile.
 *
 * Huruf serif dipakai karena mengikuti kebiasaan surat resmi sekolah, dan
 * warnanya selalu hitam di atas putih apa pun tema aplikasinya. Kuitansi A5
 * (`keuangan/kuitansi.ts`) punya pembantunya sendiri.
 */

export const ROOT_ID = "kos-print-root";

export function esc(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** `2026-11-15` → "Minggu, 15 November 2026"; `hari: false` tanpa nama hari. */
export function tanggalPanjang(tanggal: string | null, hari = true): string {
  if (!tanggal) return "";
  const waktu = new Date(`${tanggal}T00:00:00Z`);
  if (Number.isNaN(waktu.getTime())) return tanggal;
  return new Intl.DateTimeFormat("id-ID", {
    ...(hari ? { weekday: "long" as const } : {}),
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(waktu);
}

/** Kop sekolah; baris kedua bawaannya cabang, surat kepegawaian memakai nama unit. */
export function kop(
  kopSekolah: KopSekolah,
  barisDua: string | null | undefined = kopSekolah.cabang,
): string {
  const kontak = [kopSekolah.telepon, kopSekolah.email, kopSekolah.website]
    .filter(Boolean)
    .map(esc)
    .join(" · ");
  return `
    <header class="kop">
      ${kopSekolah.logo_url ? `<img src="${esc(kopSekolah.logo_url)}" alt="" class="logo">` : ""}
      <div>
        <div class="nama">${esc(kopSekolah.nama || "Nama Sekolah")}</div>
        ${barisDua ? `<div>${esc(barisDua)}</div>` : ""}
        ${kopSekolah.alamat ? `<div class="kecil">${esc(kopSekolah.alamat)}</div>` : ""}
        ${kontak ? `<div class="kecil">${kontak}</div>` : ""}
      </div>
    </header>`;
}

export function tandaTangan(
  label: string,
  nama: string | null,
  nip?: string | null,
): string {
  return `
    <div class="ttd">
      <div>${esc(label)}</div>
      <div class="ruang"></div>
      <div class="garis">${nama ? esc(nama) : "&nbsp;"}</div>
      ${nip ? `<div class="kecil">NIP ${esc(nip)}</div>` : ""}
    </div>`;
}

export const GAYA_A4 = `
  @media screen { #${ROOT_ID} { display: none; } }
  @media print {
    @page { size: A4 portrait; margin: 15mm; }
    body > *:not(#${ROOT_ID}) { display: none !important; }
    #${ROOT_ID} { display: block !important; }
  }
  #${ROOT_ID} { color: #000; background: #fff; font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.4; }
  #${ROOT_ID} .kop { display: flex; gap: 12px; align-items: center; border-bottom: 3px double #000; padding-bottom: 8px; margin-bottom: 16px; }
  #${ROOT_ID} .logo { width: 64px; height: 64px; object-fit: contain; }
  #${ROOT_ID} .nama { font-size: 16pt; font-weight: bold; text-transform: uppercase; }
  #${ROOT_ID} .kecil { font-size: 10pt; }
  #${ROOT_ID} h1 { font-size: 13pt; text-align: center; margin: 0; text-decoration: underline; }
  #${ROOT_ID} .nomor { text-align: center; margin-bottom: 16px; }
  #${ROOT_ID} table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10.5pt; }
  #${ROOT_ID} th, #${ROOT_ID} td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; text-align: left; }
  #${ROOT_ID} .angka { text-align: right; }
  #${ROOT_ID} .tanda { display: flex; justify-content: space-between; gap: 16px; margin-top: 32px; page-break-inside: avoid; }
  #${ROOT_ID} .ttd { flex: 1; text-align: center; }
  #${ROOT_ID} .ruang { height: 64px; }
  #${ROOT_ID} .garis { border-top: 1px solid #000; padding-top: 2px; }
`;

/** Pasang `isi` (sudah membawa `<style>`) di akar cetak lalu buka dialog cetak. */
export function cetakDiAkar(isi: string): void {
  document.getElementById(ROOT_ID)?.remove();
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.innerHTML = isi;
  document.body.appendChild(root);
  // Beri waktu logo selesai dimuat sebelum dialog cetak dibuka.
  setTimeout(() => {
    window.focus();
    window.print();
    setTimeout(() => root.remove(), 3000);
  }, 300);
}

/** Cetak dokumen A4 dengan gaya dasar (`GAYA_A4`) ditambah `gaya` khusus dokumen. */
export function cetakA4(html: string, gaya = ""): void {
  cetakDiAkar(`<style>${GAYA_A4}${gaya}</style>${html}`);
}
