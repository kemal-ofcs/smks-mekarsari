import { type NextRequest, NextResponse } from "next/server";
import { getServerDatabase } from "@/lib/server/db";
import { isSameOriginMutation } from "@/lib/server/http/request-security";

export const runtime = "nodejs";

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Apakah database ini sudah punya setidaknya satu akun operator?
 *
 * Dipakai halaman login Web supaya database yang masih kosong tidak menjadi
 * jalan buntu: form login tampil, tidak ada akun untuk dipakai, dan tidak ada
 * petunjuk apa pun harus berbuat apa. Orang yang melihatnya mengira aplikasinya
 * rusak.
 *
 * Endpoint ini BISA dipanggil tanpa login, jadi tiga batas berikut disengaja
 * dan wajib dipertahankan:
 *
 * 1. JAWABANNYA SATU BOOLEAN. Tidak ada jumlah akun, username, atau nama —
 *    pemanggil anonim tidak berhak mengetahui isi tabel operator.
 *
 * 2. HANYA MEMBACA. Ia tidak memanggil `ensureServerDatabaseInitialized` dan
 *    tidak menulis apa pun. Tabel yang belum ada berarti "belum ada akun",
 *    bukan alasan untuk menyiapkan skema dari permintaan tanpa sesi.
 *
 * 3. TIDAK ADA JALAN MEMBUAT AKUN DARI SINI, dan tidak boleh pernah ditambahkan.
 *    Aplikasi Web ter-deploy ke internet: layar "buat Superadmin pertama" tanpa
 *    login berarti siapa pun yang pertama membuka URL-nya bisa mengklaim seluruh
 *    sistem. Karena itu provisioning hanya ada di Desktop/Mobile, tempat yang
 *    menjalankannya adalah orang yang duduk di depan mesinnya sendiri. Endpoint
 *    ini hanya boleh MENUNJUK ke sana.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return noStoreJson(
      { sukses: false, pesan: "Origin tidak diizinkan." },
      403,
    );
  }

  try {
    const result = await getServerDatabase().execute(
      "SELECT EXISTS(SELECT 1 FROM master_operator) AS ada;",
    );
    const ada = Number(result.rows[0]?.ada ?? 0) === 1;
    return noStoreJson({ sukses: true, hasOperator: ada });
  } catch (error) {
    // Dua kegagalan yang WAJIB dibedakan, karena jawabannya berlawanan:
    //
    // - Tabel `master_operator` belum ada: database yang benar-benar baru dan
    //   belum pernah diprovisioning. Itu jawaban yang sah — "belum ada akun" —
    //   jadi `false`, dan halaman login menunjukkan jalan provisioning.
    //
    // - Apa pun selain itu (jaringan putus, token Turso salah, database tak
    //   terjangkau): kita TIDAK TAHU isinya, jadi `null`. Menjawab `false` di
    //   sini akan menyuruh orang memprovisioning database yang sebenarnya sudah
    //   berisi, hanya karena koneksinya sedang bermasalah.
    const pesan = error instanceof Error ? error.message : String(error);
    const tabelBelumAda = /no such table/i.test(pesan);
    return noStoreJson({
      sukses: true,
      hasOperator: tabelBelumAda ? false : null,
    });
  }
}
