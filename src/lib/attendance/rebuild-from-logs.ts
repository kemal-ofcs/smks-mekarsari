import type { InStatement, ResultSet } from "@libsql/client";
import {
  aturanShiftDariBaris,
  hitungUlangAbsensiDariJam,
  parseTimeToMinutes,
} from "@/lib/attendance/time-policy";

/** `Client` maupun `Transaction` libSQL. */
export interface SqlExecutor {
  execute(statement: InStatement): Promise<ResultSet>;
}

/** Asal log scan yang baru saja dihapus. */
export type LogRemoval =
  /**
   * Koreksi admin dihapus: barisnya kembali `Hadir` bersumber `Scanner` dari
   * log yang tersisa, supaya tidak lagi dilindungi sebagai koreksi admin.
   */
  | { kind: "correction" }
  /** Import offline/manual dihapus. */
  | { kind: "import" }
  /**
   * Satu log scan dihapus. Jam jenis lain yang tidak ikut dihapus
   * dipertahankan meskipun lognya tidak ada di database ini.
   */
  | { kind: "scan-log"; jenisScan: string; ofCorrection: boolean };

export interface RebuildResult {
  deletedIdSesi: string[];
}

function formatDateTime(dateStr: string, timeStr: string): string {
  const cleanTime = timeStr.includes(" ")
    ? timeStr.split(" ")[1]
    : timeStr.includes("T")
      ? timeStr.split("T")[1]
      : timeStr;
  const parts = (cleanTime ?? "").split(":");
  if (parts.length < 2) return "";
  const h = parts[0].padStart(2, "0");
  const m = parts[1].padStart(2, "0");
  const s = (parts[2] || "00").slice(0, 2).padStart(2, "0");
  return `${dateStr} ${h}:${m}:${s}`;
}

/**
 * Bangun ulang absensi `(idKaryawan, tanggal)` dari log scan yang tersisa.
 * Cerminan `rebuild_attendance_from_logs` di `administration.rs`; keduanya
 * WAJIB tetap sama.
 *
 * Hanya baris bertanggal PERSIS `tanggal`: pulang shift malam sudah dicatat
 * pada tanggal kerja mulai shift. Dulu query-nya ikut mencocokkan
 * `date(?, '-1 day')`, sehingga menghapus log hari ini yang tidak punya baris
 * absensi — misalnya "Scan Ditolak" — menghapus absensi KEMARIN.
 *
 * Pemanggil wajib menjalankannya di dalam transaksi yang sama dengan
 * penghapusan lognya.
 */
export async function rebuildAttendanceFromLogs(
  executor: SqlExecutor,
  idKaryawan: string,
  tanggal: string,
  removal: LogRemoval,
): Promise<RebuildResult> {
  const result: RebuildResult = { deletedIdSesi: [] };
  const sessions = (
    await executor.execute({
      sql: "SELECT id_sesi, id_shift, jam_masuk, jam_pulang, COALESCE(menit_terlambat, 0) AS menit_terlambat, COALESCE(menit_datang_awal, 0) AS menit_datang_awal, COALESCE(sumber, '') AS sumber FROM absensi_harian WHERE id_karyawan = ? AND tanggal = ? ORDER BY id_sesi LIMIT 20;",
      args: [idKaryawan, tanggal],
    })
  ).rows as unknown as Array<Record<string, unknown>>;
  if (sessions.length === 0) return result;

  // Menghapus log scan atau import tidak boleh membatalkan keputusan admin;
  // admin menyunting baris itu sendiri lewat riwayat. Menghapus koreksinya
  // sendiri (atau log milik koreksi itu) tetap membangun ulang barisnya.
  const protectAdmin =
    removal.kind === "import" ||
    (removal.kind === "scan-log" && !removal.ofCorrection);
  if (
    protectAdmin &&
    sessions.some((session) => String(session.sumber) === "Koreksi Admin")
  ) {
    return result;
  }

  const firstLog = async (sql: string) => {
    const value = (await executor.execute({ sql, args: [idKaryawan, tanggal] }))
      .rows[0]?.jam_scan;
    return value === undefined || value === null ? null : String(value);
  };
  const inLog = await firstLog(
    "SELECT jam_scan FROM log_scan WHERE id_karyawan = ? AND tanggal_kerja = ? AND jenis_scan = 'Masuk' AND status_proses <> 'Ditolak' ORDER BY timestamp_scan ASC, jam_scan ASC LIMIT 1;",
  );
  const outLog = await firstLog(
    "SELECT jam_scan FROM log_scan WHERE id_karyawan = ? AND tanggal_kerja = ? AND jenis_scan = 'Pulang' AND status_proses <> 'Ditolak' ORDER BY timestamp_scan DESC, jam_scan DESC LIMIT 1;",
  );

  const deleteSession = async (idSesi: string) => {
    await executor.execute({
      sql: "DELETE FROM absensi_harian WHERE id_sesi = ?;",
      args: [idSesi],
    });
    result.deletedIdSesi.push(idSesi);
  };

  const deletedKind = removal.kind === "scan-log" ? removal.jenisScan : null;

  if (sessions.length > 1) {
    // ponytail: log_scan tidak menyimpan id_sesi, jadi log tidak bisa
    // dipetakan ke sesinya. Hanya bila tak satu pun scan tersisa seluruh sesi
    // tanggal itu ikut dihapus; selebihnya admin menyuntingnya lewat riwayat.
    if (inLog === null && outLog === null && deletedKind === null) {
      for (const session of sessions)
        await deleteSession(String(session.id_sesi));
    }
    return result;
  }

  const session = sessions[0];
  const idSesi = String(session.id_sesi);
  // Jenis yang TIDAK dihapus dipertahankan dari barisnya bila lognya tidak ada
  // di sini — misalnya pulang yang discan terminal lain.
  const keeps = (jenis: string) =>
    deletedKind !== null && deletedKind !== jenis;

  const inVal =
    inLog !== null
      ? formatDateTime(tanggal, inLog)
      : keeps("Masuk")
        ? String(session.jam_masuk ?? "")
        : "";

  const shiftRow = (
    await executor.execute({
      sql: "SELECT jam_masuk, jam_pulang, jam_kerja_normal_menit, istirahat_menit, offset_istirahat_mulai FROM tbl_shift WHERE id_shift = ? LIMIT 1;",
      args: [Number(session.id_shift || 1)],
    })
  ).rows[0] as Record<string, unknown> | undefined;

  let outVal = "";
  if (outLog !== null) {
    const shiftStart = parseTimeToMinutes(String(shiftRow?.jam_masuk ?? ""));
    const shiftEnd = parseTimeToMinutes(String(shiftRow?.jam_pulang ?? ""));
    const inMinute = parseTimeToMinutes(inVal);
    const outMinute = parseTimeToMinutes(outLog);
    const overnightShift =
      shiftStart !== null && shiftEnd !== null && shiftEnd < shiftStart;
    const crossesMidnight =
      inMinute !== null && outMinute !== null && outMinute < inMinute;
    let outDate = tanggal;
    if (overnightShift || crossesMidnight) {
      const next = await executor.execute({
        sql: "SELECT date(?, '+1 day') AS tanggal;",
        args: [tanggal],
      });
      outDate = String(next.rows[0]?.tanggal ?? tanggal);
    }
    outVal = formatDateTime(outDate, outLog);
  } else if (keeps("Pulang")) {
    outVal = String(session.jam_pulang ?? "");
  }

  if (!inVal && !outVal) {
    await deleteSession(idSesi);
    return result;
  }

  const inMin = parseTimeToMinutes(inVal);
  const outMin = parseTimeToMinutes(outVal);
  let duration: number | null = null;
  if (inMin !== null && outMin !== null) {
    duration = outMin - inMin;
    if (duration < 0) duration += 1440;
  }
  const hasil = hitungUlangAbsensiDariJam({
    masukMenit: inMin,
    durasiMenit: duration,
    shift: aturanShiftDariBaris(shiftRow),
  });
  // Log Pulang yang dihapus tidak mengubah kapan karyawannya masuk, jadi
  // terlambat/datang awal yang sudah tercatat dipertahankan.
  const keepEntry = deletedKind === "Pulang" && Boolean(inVal);
  const statusAbsen =
    inVal && outVal ? "Lengkap" : inVal ? "Belum Pulang" : "Perlu Verifikasi";

  await executor.execute({
    sql: `UPDATE absensi_harian SET
          jam_masuk = ?, jam_pulang = ?,
          status_kehadiran = CASE WHEN ?3 = 1 THEN 'Hadir' ELSE status_kehadiran END,
          sumber = CASE WHEN ?3 = 1 THEN 'Scanner' ELSE sumber END,
          status_absen = ?, update_terakhir = strftime('%Y-%m-%d %H:%M:%S', 'now', '+7 hours'),
          menit_terlambat = ?, menit_datang_awal = ?, jam_kerja = ?, lembur = ?, jam_kerja_kurang = ?
          WHERE id_sesi = ?;`,
    args: [
      inVal,
      outVal,
      removal.kind === "correction" ? 1 : 0,
      statusAbsen,
      keepEntry ? Number(session.menit_terlambat) : hasil.menitTerlambat,
      keepEntry ? Number(session.menit_datang_awal) : hasil.menitDatangAwal,
      hasil.jamKerja,
      hasil.lembur,
      hasil.jamKerjaKurang,
      idSesi,
    ],
  });
  return result;
}
