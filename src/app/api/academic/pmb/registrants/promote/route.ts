import type { NextRequest } from "next/server";
import { requireWebPermission } from "@/lib/server/auth/authorize";
import {
  ensureServerDatabaseInitialized,
  getServerDatabase,
} from "@/lib/server/db";
import {
  noStoreJson,
  readJsonBody,
  toApiErrorResponse,
} from "@/lib/server/http/api-response";
import { assertSameOriginMutation } from "@/lib/server/http/request-security";
import { saveStudent } from "@/lib/services/academic";
import {
  getPmbRegistrant,
  markPmbRegistered,
  PmbValidationError,
} from "@/lib/services/pmb-admin";
import type { PmbPromotionInput } from "@/types/pmb";

export const runtime = "nodejs";

/**
 * Angkat pendaftar yang diterima menjadi siswa aktif.
 *
 * Dua izin dituntut sekaligus, dan itu disengaja. `pmb.promote` adalah izin
 * aksinya; `students.manage` adalah izin atas DATA yang benar-benar disentuh —
 * aksi ini membuat baris `master_data`, `siswa_data`, dan `id_card`, lalu
 * menyebarkannya ke seluruh perangkat lewat sinkronisasi. Least privilege
 * berjalan dua arah: jangan meminta izin yang terlalu luas, dan jangan
 * menyembunyikan tulisan berdampak luas di balik izin yang sempit.
 *
 * Tidak ada satu pun INSERT ke `master_data` di berkas ini: pembuatan siswa
 * diserahkan utuh ke `saveStudent`, jalur yang sudah menangani token QR acak,
 * baris kartu identitas, dan pendaftaran outbox-nya sekaligus.
 *
 * Urutannya disengaja — siswanya dibuat LEBIH DULU, barisnya ditandai
 * sesudahnya. Kalau penandaan gagal, yang tersisa adalah siswa yang sudah ada
 * beserta pendaftar yang masih berstatus `Diterima`; panitia akan mencoba lagi
 * dan `assertUniqueValue` pada NIS akan menolak duplikatnya. Urutan sebaliknya
 * menghasilkan pendaftar yang tercatat `Terdaftar` tanpa siswa mana pun yang
 * mewakilinya, dan tidak ada yang akan mencarinya lagi.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    await requireWebPermission(request, "pmb.promote");
    await requireWebPermission(request, "students.manage");
    await ensureServerDatabaseInitialized();

    const input = await readJsonBody<PmbPromotionInput>(request);
    if (!String(input.idRombel ?? "").trim()) {
      throw new PmbValidationError(
        "Rombel tujuan wajib dipilih sebelum pendaftar diangkat menjadi siswa.",
      );
    }

    const client = getServerDatabase();
    const { pendaftar } = await getPmbRegistrant(client, input.idPendaftar);

    if (pendaftar.status !== "Diterima") {
      throw new PmbValidationError(
        "Hanya pendaftar berstatus 'Diterima' yang dapat diangkat menjadi siswa.",
      );
    }

    const bersih = (nilai: unknown) => {
      const teks = String(nilai ?? "").trim();
      return teks || null;
    };

    const hasil = await saveStudent({
      nama_lengkap: String(pendaftar.nama_lengkap ?? "").trim(),
      nisn: bersih(pendaftar.nisn),
      jenis_kelamin: pendaftar.jenis_kelamin === "P" ? "P" : "L",
      id_rombel: String(input.idRombel).trim(),
      nama_wali: bersih(pendaftar.nama_wali),
      no_whatsapp_wali: bersih(pendaftar.no_whatsapp_wali),
      alamat: bersih(pendaftar.alamat),
      status: "Aktif",
      ...(input.idShift ? { id_shift: input.idShift } : {}),
      ...(input.angkatan ? { angkatan: input.angkatan } : {}),
    });

    await markPmbRegistered(client, input.idPendaftar, hasil.id_siswa);
    return noStoreJson({ sukses: true, idSiswa: hasil.id_siswa });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
