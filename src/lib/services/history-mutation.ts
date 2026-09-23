import "server-only";

import { rebuildAttendanceFromLogs } from "@/lib/attendance/rebuild-from-logs";
import {
  aturanShiftDariBaris,
  hitungUlangAbsensiDariJam,
  parseTimeToMinutes,
} from "@/lib/attendance/time-policy";
import { db, ensureDbInitialized } from "@/lib/db";

export interface EditAbsensiHarianPatch {
  jam_masuk?: string; // e.g. "07:00" or "YYYY-MM-DD HH:mm:ss"
  jam_pulang?: string;
  status_kehadiran?: string; // "Hadir" | "Sakit" | "Izin" | "Dispen" | "Alfa"
  status_absen?: string; // "Lengkap" | "Belum Pulang" | "Tidak Hadir" | "Perlu Verifikasi"
  keterangan?: string;
}

function formatDateTime(dateStr: string, timeStr: string): string {
  if (!timeStr) return "";
  const cleanTime = timeStr.includes(" ")
    ? timeStr.split(" ")[1]
    : timeStr.includes("T")
      ? timeStr.split("T")[1]
      : timeStr;
  if (!cleanTime) return "";
  const parts = cleanTime.split(":");
  if (parts.length < 2) return "";
  const h = parts[0].padStart(2, "0");
  const m = parts[1].padStart(2, "0");
  const s = (parts[2] || "00").slice(0, 2).padStart(2, "0");
  return `${dateStr} ${h}:${m}:${s}`;
}

export async function editAbsensiHarian(
  idSesi: string,
  patch: EditAbsensiHarianPatch,
  kodeOperator: string,
) {
  await ensureDbInitialized();

  const existRes = await db.execute({
    sql: "SELECT * FROM absensi_harian WHERE id_sesi = ? LIMIT 1;",
    args: [idSesi],
  });

  if (existRes.rows.length === 0) {
    return { sukses: false, pesan: "Data absensi harian tidak ditemukan." };
  }

  const current = existRes.rows[0] as Record<string, unknown>;
  const tanggal = String(current.tanggal);
  const idShift = Number(current.id_shift || 1);
  const nowStr = new Date().toISOString();

  // Fetch shift details
  const shiftRes = await db.execute({
    sql: "SELECT jam_masuk, jam_pulang, jam_kerja_normal_menit, istirahat_menit, offset_istirahat_mulai FROM tbl_shift WHERE id_shift = ? LIMIT 1;",
    args: [idShift],
  });
  const aturanShift = aturanShiftDariBaris(
    shiftRes.rows[0] as Record<string, unknown> | undefined,
  );
  const shiftInMin = parseTimeToMinutes(aturanShift.jamMasuk) ?? 420;
  const shiftOutMin = parseTimeToMinutes(aturanShift.jamPulang) ?? 900;
  const isOvernightShift = shiftOutMin < shiftInMin;

  const nextDate = (() => {
    const d = new Date(tanggal);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  // Format jam masuk and jam pulang cleanly
  let checkInVal =
    patch.jam_masuk !== undefined
      ? patch.jam_masuk.trim()
      : String(current.jam_masuk || "");
  checkInVal = formatDateTime(tanggal, checkInVal);

  let checkOutVal =
    patch.jam_pulang !== undefined
      ? patch.jam_pulang.trim()
      : String(current.jam_pulang || "");
  if (checkOutVal) {
    const outMin = parseTimeToMinutes(checkOutVal) ?? 0;
    const inMin = parseTimeToMinutes(checkInVal);
    const isCross =
      inMin !== null ? outMin < inMin : isOvernightShift && outMin < shiftInMin;
    const outDate = isCross ? nextDate : tanggal;
    checkOutVal = formatDateTime(outDate, checkOutVal);
  }

  const statusKehadiran =
    patch.status_kehadiran !== undefined
      ? patch.status_kehadiran.trim()
      : String(current.status_kehadiran || "Hadir");

  const keterangan =
    patch.keterangan !== undefined
      ? patch.keterangan.trim()
      : String(current.keterangan || "");

  let calculatedLate = 0;
  let calculatedEarly = 0;
  let calculatedWork = 0;
  let calculatedOvertime = 0;
  let calculatedShortage = 0;

  if (["Sakit", "Izin", "Dispen", "Alfa"].includes(statusKehadiran)) {
    checkInVal = "";
    checkOutVal = "";
  } else {
    const inMin = parseTimeToMinutes(checkInVal);
    const outMin = parseTimeToMinutes(checkOutVal);

    let duration: number | null = null;
    if (inMin !== null && outMin !== null) {
      duration = outMin - inMin;
      if (duration < 0) {
        duration += 1440;
      } else if (
        checkOutVal.startsWith(nextDate) &&
        checkInVal.startsWith(tanggal) &&
        nextDate !== tanggal
      ) {
        duration += 1440;
      }
    }

    const hasil = hitungUlangAbsensiDariJam({
      masukMenit: inMin,
      durasiMenit: duration,
      shift: aturanShift,
    });
    calculatedLate = hasil.menitTerlambat;
    calculatedEarly = hasil.menitDatangAwal;
    calculatedWork = hasil.jamKerja;
    calculatedOvertime = hasil.lembur;
    calculatedShortage = hasil.jamKerjaKurang;
  }

  const statusAbsen =
    patch.status_absen !== undefined
      ? patch.status_absen.trim()
      : ["Sakit", "Izin", "Dispen", "Alfa"].includes(statusKehadiran)
        ? "Tidak Hadir"
        : checkInVal && checkOutVal
          ? "Lengkap"
          : checkInVal
            ? "Belum Pulang"
            : "Perlu Verifikasi";

  // ── Atomic transaction: UPDATE absensi + INSERT audit trail ────────────
  const tx = await db.transaction("write");
  try {
    await tx.execute({
      sql: `UPDATE absensi_harian SET
            jam_masuk = ?,
            jam_pulang = ?,
            status_kehadiran = ?,
            status_absen = ?,
            keterangan = ?,
            update_terakhir = ?,
            menit_terlambat = ?,
            menit_datang_awal = ?,
            jam_kerja = ?,
            lembur = ?,
            jam_kerja_kurang = ?
          WHERE id_sesi = ?;`,
      args: [
        checkInVal,
        checkOutVal,
        statusKehadiran,
        statusAbsen,
        keterangan,
        nowStr,
        calculatedLate,
        calculatedEarly,
        calculatedWork,
        calculatedOvertime,
        calculatedShortage,
        idSesi,
      ],
    });

    // Audit trail
    await tx.execute({
      sql: `INSERT INTO audit_absensi (
            waktu, jenis, tanggal, id_karyawan, nama, baris_referensi, detail, status
          ) VALUES (?, 'Edit Absensi', ?, ?, ?, ?, ?, 'Berhasil');`,
      args: [
        nowStr,
        tanggal,
        String(current.id_karyawan),
        String(current.nama),
        idSesi,
        `Diedit oleh Operator ${kodeOperator}. Jam Masuk: '${checkInVal}', Jam Pulang: '${checkOutVal}', Status: '${statusKehadiran}/${statusAbsen}'.`,
      ],
    });

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  return {
    sukses: true,
    pesan: "Data absensi harian berhasil diperbarui.",
  };
}

export async function hapusAbsensiHarian(
  idSesi: string,
  kodeOperator = "SYSTEM",
) {
  await ensureDbInitialized();

  const existRes = await db.execute({
    sql: "SELECT id_karyawan, tanggal, nama FROM absensi_harian WHERE id_sesi = ? LIMIT 1;",
    args: [idSesi],
  });

  if (existRes.rows.length === 0) {
    return { sukses: false, pesan: "Data absensi harian tidak ditemukan." };
  }

  const current = existRes.rows[0] as Record<string, unknown>;

  // Satu batch: penghapusan tanpa jejak audit tidak boleh terjadi. Waktu dari
  // jam database dalam WIB, format yang sama dengan jalur Rust.
  await db.batch(
    [
      {
        sql: "DELETE FROM absensi_harian WHERE id_sesi = ?;",
        args: [idSesi],
      },
      {
        sql: `INSERT INTO audit_absensi (
              waktu, jenis, tanggal, id_karyawan, nama, baris_referensi, detail, status
            ) VALUES (strftime('%Y-%m-%d %H:%M:%S', 'now', '+7 hours'), 'Hapus Absensi', ?, ?, ?, ?, ?, 'Berhasil');`,
        args: [
          String(current.tanggal),
          String(current.id_karyawan),
          String(current.nama),
          idSesi,
          `Dihapus oleh Operator ${kodeOperator}.`,
        ],
      },
    ],
    "write",
  );

  return {
    sukses: true,
    pesan: "Data absensi harian berhasil dihapus.",
  };
}

export async function hapusLogScan(
  idLog: number | string,
  kodeOperator = "SYSTEM",
) {
  await ensureDbInitialized();

  const logRes = await db.execute({
    sql: "SELECT * FROM log_scan WHERE id_log = ? LIMIT 1;",
    args: [idLog],
  });

  if (logRes.rows.length === 0) {
    return { sukses: false, pesan: "Log scan tidak ditemukan." };
  }

  const log = logRes.rows[0] as Record<string, unknown>;
  const idKaryawan = String(log.id_karyawan);
  const tanggalKerja = String(log.tanggal_kerja);
  const jenisScanDeleted = String(log.jenis_scan || "");
  const referensi = String(log.id_referensi ?? "");
  let deletedAbsensiIdSesi: string[] = [];

  const tx = await db.transaction("write");
  try {
    await tx.execute({
      sql: "DELETE FROM log_scan WHERE id_log = ?;",
      args: [idLog],
    });

    // Log yang ditolak tidak pernah membentuk absensi, jadi menghapusnya
    // tidak boleh menyentuh absensi_harian sama sekali.
    if (
      (jenisScanDeleted === "Masuk" || jenisScanDeleted === "Pulang") &&
      String(log.status_proses ?? "") !== "Ditolak"
    ) {
      const rebuilt = await rebuildAttendanceFromLogs(
        tx,
        idKaryawan,
        tanggalKerja,
        {
          kind: "scan-log",
          jenisScan: jenisScanDeleted,
          ofCorrection: referensi.startsWith("KOR-"),
        },
      );
      deletedAbsensiIdSesi = rebuilt.deletedIdSesi;
    }

    // Riwayat asal ikut terhapus begitu tidak ada lagi log yang merujuknya.
    // Selama masih ada log lain dengan referensi sama — misalnya satu import
    // yang membuat baris Masuk DAN Pulang — riwayatnya dipertahankan supaya
    // log yang tersisa tidak menggantung tanpa asal-usul.
    //
    // Prefiks id_referensi membedakan sumbernya: `KOR-` koreksi admin, `IMP-`
    // import manual. ID penugasan backup tidak berawalan keduanya, jadi
    // penugasan backup tidak pernah ikut terhapus.
    if (referensi) {
      const sisaRes = await tx.execute({
        sql: "SELECT COUNT(*) AS total FROM log_scan WHERE COALESCE(id_referensi, '') = ?;",
        args: [referensi],
      });
      const masihDirujuk = Number(sisaRes.rows[0]?.total ?? 0) > 0;

      if (!masihDirujuk) {
        if (referensi.startsWith("KOR-")) {
          await tx.execute({
            sql: "DELETE FROM koreksi_admin WHERE id_referensi = ?;",
            args: [referensi],
          });
        } else if (referensi.startsWith("IMP-")) {
          await tx.execute({
            sql: "DELETE FROM import_offline WHERE event_key = ?;",
            args: [referensi],
          });
        }
      }
    }

    await tx.execute({
      sql: `INSERT INTO audit_absensi (
            waktu, jenis, tanggal, id_karyawan, nama, baris_referensi, detail, status
          ) VALUES (strftime('%Y-%m-%d %H:%M:%S', 'now', '+7 hours'), 'Hapus Log Scan', ?, ?, ?, ?, ?, 'Berhasil');`,
      args: [
        tanggalKerja,
        idKaryawan,
        String(log.nama),
        String(idLog),
        `Log scan ${log.jenis_scan} (${log.jam_scan}) dihapus oleh Operator ${kodeOperator}.`,
      ],
    });

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  return {
    sukses: true,
    pesan: "Log scan berhasil dihapus dan absensi telah diperbarui.",
    deletedAbsensiIdSesi,
  };
}

export async function hapusImportOffline(
  eventKey: string,
  kodeOperator: string,
) {
  await ensureDbInitialized();

  const importRes = await db.execute({
    sql: "SELECT * FROM import_offline WHERE event_key = ? LIMIT 1;",
    args: [eventKey],
  });

  if (importRes.rows.length === 0) {
    return { sukses: false, pesan: "Data import offline tidak ditemukan." };
  }

  const imp = importRes.rows[0] as Record<string, unknown>;
  const idUnik = String(imp.id_unik);
  const tanggal = String(imp.tanggal);

  const tx = await db.transaction("write");
  try {
    await tx.execute({
      sql: "DELETE FROM import_offline WHERE event_key = ?;",
      args: [eventKey],
    });
    await tx.execute({
      sql: "DELETE FROM log_scan WHERE id_referensi = ? OR (id_karyawan = ? AND tanggal_kerja = ? AND (sumber_data = 'Import Offline' OR sumber_data = 'Import Manual'));",
      args: [eventKey, idUnik, tanggal],
    });

    await rebuildAttendanceFromLogs(tx, idUnik, tanggal, { kind: "import" });

    await tx.execute({
      sql: `INSERT INTO audit_absensi (
            waktu, jenis, tanggal, id_karyawan, nama, baris_referensi, detail, status
          ) VALUES (strftime('%Y-%m-%d %H:%M:%S', 'now', '+7 hours'), 'Hapus Import Offline', ?, ?, ?, ?, ?, 'Berhasil');`,
      args: [
        tanggal,
        idUnik,
        String(imp.nama || "-"),
        eventKey,
        `Baris import offline dihapus oleh Operator ${kodeOperator}.`,
      ],
    });

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  return { sukses: true, pesan: "Data import offline berhasil dihapus." };
}
