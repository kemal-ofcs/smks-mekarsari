import type { Transaction } from "@libsql/client";
import {
  aturanShiftDariBaris,
  type HasilHitungDariJam,
  hitungUlangAbsensiDariJam,
} from "@/lib/attendance/time-policy";
import type { OperatorUser } from "@/lib/auth/operator-user";
import { DEFAULT_ATTENDANCE_SOURCE } from "@/lib/contracts/scanner";
import type { OperationalSyncEvent } from "@/lib/server/operational/sync-schema";

import {
  appendChange,
  number,
  resolveMonth,
  resolveYear,
  text,
} from "./shared";

/**
 * Penerapan event sinkronisasi absensi: scan, koreksi admin, penugasan backup, import offline, dan log scan.
 *
 * Dipecah dari `server/operational/sync-push.ts` (2.309 baris). Jalur impornya
 * TIDAK berubah: `@/lib/server/operational/sync-push` kini direktori dengan
 * `index.ts` yang memegang `processOperationalSyncEvent` dan dispatcher-nya.
 */

export async function applyAttendance(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  if (event.operation === "create") {
    const raw = event.payload.attendance;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Payload ABSENSI_HARIAN tidak valid.");
    }
    const data = raw as Record<string, unknown>;
    const sessionId = text(data, "id_sesi") || event.entityKey;
    if (!sessionId || !text(data, "tanggal") || !text(data, "id_karyawan")) {
      throw new Error("Data ABSENSI_HARIAN belum lengkap.");
    }
    await transaction.execute({
      sql: `INSERT INTO absensi_harian (
        id_absensi, tanggal, id_karyawan, nama, kelas_divisi, jam_masuk, jam_pulang,
        status_kehadiran, status_absen, keterangan, sumber, update_terakhir,
        menit_terlambat, menit_datang_awal, jam_kerja, lembur,
        jam_kerja_kurang, id_shift, bulan, tahun, id_sesi, mode_tugas,
        id_backup, id_karyawan_asal, tanggal_tugas
      ) VALUES ((SELECT id_absensi FROM absensi_harian WHERE id_sesi = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id_absensi) DO UPDATE SET
        jam_masuk = excluded.jam_masuk,
        jam_pulang = excluded.jam_pulang,
        status_kehadiran = excluded.status_kehadiran,
        status_absen = excluded.status_absen,
        keterangan = excluded.keterangan,
        sumber = excluded.sumber,
        update_terakhir = excluded.update_terakhir,
        menit_terlambat = excluded.menit_terlambat,
        menit_datang_awal = excluded.menit_datang_awal,
        jam_kerja = excluded.jam_kerja,
        lembur = excluded.lembur,
        jam_kerja_kurang = excluded.jam_kerja_kurang;`,
      args: [
        sessionId,
        text(data, "tanggal"),
        text(data, "id_karyawan"),
        text(data, "nama"),
        text(data, "kelas_divisi"),
        text(data, "jam_masuk"),
        text(data, "jam_pulang"),
        text(data, "status_kehadiran"),
        text(data, "status_absen"),
        text(data, "keterangan"),
        // `sumber` boleh absen di payload (Zod menandainya nullable+optional),
        // sehingga cabang bawaan ini BENAR-BENAR bisa tercapai. Nilainya WAJIB
        // salah satu dari lima yang diterima CHECK constraint
        // `absensi_harian.sumber`; sebelumnya di sini tertulis `"Otomatis"`,
        // yang bukan salah satunya — INSERT-nya ditolak cloud, event outbox-nya
        // gagal permanen (`next_retry_at = NULL`), dan seluruh antrean
        // sinkronisasi perangkat itu berhenti selamanya.
        //
        // `Generate Sistem` adalah pilihan yang jujur untuk baris tanpa sumber
        // yang dinyatakan, sekaligus prioritas TERENDAH dalam hierarki
        // rekonsiliasi — jadi ia tidak akan pernah menimpa catatan yang lebih
        // tinggi.
        text(data, "sumber") || DEFAULT_ATTENDANCE_SOURCE,
        text(data, "update_terakhir") || new Date().toISOString(),
        number(data, "menit_terlambat"),
        number(data, "menit_datang_awal"),
        number(data, "jam_kerja"),
        number(data, "lembur"),
        number(data, "jam_kerja_kurang"),
        number(data, "id_shift", 1),
        resolveMonth(data),
        resolveYear(data),
        sessionId,
        text(data, "mode_tugas") || "NORMAL",
        text(data, "id_backup"),
        text(data, "id_karyawan_asal"),
        text(data, "tanggal_tugas"),
      ],
    });
    const revision = await appendChange(
      transaction,
      actor,
      event,
      event.payload,
    );
    return { revision, payload: { id_sesi: sessionId } };
  }
  if (event.operation === "delete") {
    const sessionId = text(event.payload, "id_sesi") || event.entityKey;
    await transaction.execute({
      sql: "DELETE FROM absensi_harian WHERE id_sesi = ?;",
      args: [sessionId],
    });
    const revision = await appendChange(
      transaction,
      actor,
      event,
      event.payload,
    );
    return { revision, payload: { id_sesi: sessionId } };
  }
  if (event.operation === "update") {
    const sessionId = text(event.payload, "id_sesi") || event.entityKey;
    await transaction.execute({
      sql: `UPDATE absensi_harian SET
        jam_masuk = COALESCE(?, jam_masuk),
        jam_pulang = COALESCE(?, jam_pulang),
        status_kehadiran = COALESCE(?, status_kehadiran),
        status_absen = COALESCE(?, status_absen),
        keterangan = COALESCE(?, keterangan),
        update_terakhir = ?
      WHERE id_sesi = ?;`,
      args: [
        event.payload.jam_masuk !== undefined
          ? text(event.payload, "jam_masuk")
          : null,
        event.payload.jam_pulang !== undefined
          ? text(event.payload, "jam_pulang")
          : null,
        event.payload.status_kehadiran !== undefined
          ? text(event.payload, "status_kehadiran")
          : null,
        event.payload.status_absen !== undefined
          ? text(event.payload, "status_absen")
          : null,
        event.payload.keterangan !== undefined
          ? text(event.payload, "keterangan")
          : null,
        new Date().toISOString(),
        sessionId,
      ],
    });
    const revision = await appendChange(
      transaction,
      actor,
      event,
      event.payload,
    );
    return { revision, payload: { id_sesi: sessionId } };
  }
  if (event.operation !== "scan") {
    throw new Error("Operasi absensi tidak dikenali.");
  }
  const log = event.payload.log;
  if (!log || typeof log !== "object" || Array.isArray(log)) {
    throw new Error("Payload LOG_SCAN tidak valid.");
  }
  const logData = log as Record<string, unknown>;
  const idKaryawan = text(logData, "id_karyawan");
  const timestamp = text(logData, "timestamp_scan");
  if (!idKaryawan || !timestamp || !text(logData, "jenis_scan")) {
    throw new Error("Data LOG_SCAN belum lengkap.");
  }

  const attendance = event.payload.attendance;
  if (
    attendance &&
    typeof attendance === "object" &&
    !Array.isArray(attendance)
  ) {
    const data = attendance as Record<string, unknown>;
    const idSesi = text(data, "id_sesi");
    if (!idSesi || !text(data, "tanggal")) {
      throw new Error("Data ABSENSI_HARIAN belum lengkap.");
    }
    const existing = await transaction.execute({
      sql: `SELECT sumber, update_terakhir,
                   COALESCE(jam_masuk, '') AS jam_masuk,
                   COALESCE(jam_pulang, '') AS jam_pulang,
                   COALESCE(status_kehadiran, '') AS status_kehadiran
            FROM absensi_harian WHERE id_sesi = ? LIMIT 1;`,
      args: [idSesi],
    });
    const current = existing.rows[0];
    if (current && String(current.sumber) === "Koreksi Admin") {
      // Perlindungan berlaku pada KOLOM yang benar-benar diisi admin, bukan
      // seluruh baris. Scan pulang yang hanya mengisi jam_pulang kosong tidak
      // menimpa keputusan admin apa pun.
      const menimpa = (tersimpan: unknown, baru: unknown) => {
        const lama = String(tersimpan ?? "");
        return lama !== "" && lama !== String(baru ?? "");
      };
      // Koreksi Sakit/Izin/Dispen/Alfa sengaja MENGOSONGKAN kedua jam, jadi
      // aturan "boleh mengisi kolom kosong" saja akan membuat scan
      // menghidupkannya kembali menjadi Hadir.
      const keputusanKetidakhadiran =
        String(current.status_kehadiran ?? "") !== "Hadir";
      if (
        keputusanKetidakhadiran ||
        menimpa(current.jam_masuk, data.jam_masuk) ||
        menimpa(current.jam_pulang, data.jam_pulang)
      ) {
        throw new Error(
          "Data absensi sudah dikoreksi admin dan tidak boleh ditimpa scanner.",
        );
      }
    }
    // Operator memilih "Gunakan Versi Lokal": lewati pemeriksaan konkurensi
    // optimistis, kalau tidak konfliknya tidak pernah bisa diselesaikan.
    const forceLocal = event.payload.forceLocalOverride === true;
    const baseUpdatedAt = text(event.payload, "attendanceBaseUpdatedAt");
    if (
      !forceLocal &&
      ((current && !baseUpdatedAt) ||
        (current && String(current.update_terakhir) !== baseUpdatedAt) ||
        (!current && baseUpdatedAt))
    ) {
      throw new Error(
        "Data absensi server berubah setelah scan lokal diproses.",
      );
    }
  }

  const logResult = await transaction.execute({
    sql: `
      INSERT INTO log_scan (
        timestamp_scan, tanggal_kerja, jam_scan, id_karyawan, nama, divisi,
        jenis_scan, status_proses, sumber_data, catatan_sistem, keterangan,
        menit_terlambat, menit_datang_awal, id_referensi, kode_operator
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `,
    args: [
      timestamp,
      text(logData, "tanggal_kerja"),
      text(logData, "jam_scan"),
      idKaryawan,
      text(logData, "nama"),
      text(logData, "divisi"),
      text(logData, "jenis_scan"),
      text(logData, "status_proses"),
      "Scanner",
      text(logData, "catatan_sistem"),
      text(logData, "keterangan"),
      number(logData, "menit_terlambat"),
      number(logData, "menit_datang_awal"),
      text(logData, "id_referensi"),
      actor.kode_operator,
    ],
  });

  let idSesi = "";
  if (
    attendance &&
    typeof attendance === "object" &&
    !Array.isArray(attendance)
  ) {
    const data = attendance as Record<string, unknown>;
    idSesi = text(data, "id_sesi");
    await transaction.execute({
      sql: `
        INSERT INTO absensi_harian (
          id_absensi, tanggal, id_karyawan, nama, kelas_divisi, jam_masuk, jam_pulang,
          status_kehadiran, status_absen, keterangan, sumber, update_terakhir,
          menit_terlambat, menit_datang_awal, jam_kerja, lembur,
          jam_kerja_kurang, id_shift, bulan, tahun, id_sesi, mode_tugas,
          id_backup, id_karyawan_asal, tanggal_tugas
        ) VALUES ((SELECT id_absensi FROM absensi_harian WHERE id_sesi = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Scanner', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id_absensi) DO UPDATE SET
          jam_masuk = excluded.jam_masuk,
          jam_pulang = excluded.jam_pulang,
          status_kehadiran = excluded.status_kehadiran,
          status_absen = excluded.status_absen,
          keterangan = excluded.keterangan,
          sumber = 'Scanner',
          update_terakhir = excluded.update_terakhir,
          menit_terlambat = excluded.menit_terlambat,
          menit_datang_awal = excluded.menit_datang_awal,
          jam_kerja = excluded.jam_kerja,
          lembur = excluded.lembur,
          jam_kerja_kurang = excluded.jam_kerja_kurang;
      `,
      args: [
        idSesi,
        text(data, "tanggal"),
        text(data, "id_karyawan"),
        text(data, "nama"),
        text(data, "kelas_divisi"),
        text(data, "jam_masuk"),
        text(data, "jam_pulang"),
        text(data, "status_kehadiran"),
        text(data, "status_absen"),
        text(data, "keterangan"),
        text(data, "update_terakhir"),
        number(data, "menit_terlambat"),
        number(data, "menit_datang_awal"),
        number(data, "jam_kerja"),
        number(data, "lembur"),
        number(data, "jam_kerja_kurang"),
        number(data, "id_shift", 1),
        resolveMonth(data),
        resolveYear(data),
        idSesi,
        text(data, "mode_tugas") || "NORMAL",
        text(data, "id_backup"),
        text(data, "id_karyawan_asal"),
        text(data, "tanggal_tugas"),
      ],
    });
  }
  const revision = await appendChange(transaction, actor, event, event.payload);
  return {
    revision,
    payload: { id_log: Number(logResult.lastInsertRowid), id_sesi: idSesi },
  };
}

export async function applyCorrection(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  if (event.operation === "delete") {
    const reference = text(event.payload, "id_referensi") || event.entityKey;
    const korRes = await transaction.execute({
      sql: "SELECT id_karyawan, tanggal FROM koreksi_admin WHERE id_referensi = ? LIMIT 1;",
      args: [reference],
    });
    const kor = korRes.rows[0];

    await transaction.execute({
      sql: "DELETE FROM koreksi_admin WHERE id_referensi = ?;",
      args: [reference],
    });
    await transaction.execute({
      sql: "DELETE FROM log_scan WHERE id_referensi = ?;",
      args: [reference],
    });

    if (kor) {
      const idKaryawan = String(kor.id_karyawan);
      const tanggal = String(kor.tanggal);
      const remRes = await transaction.execute({
        sql: "SELECT * FROM log_scan WHERE id_karyawan = ? AND tanggal_kerja = ? ORDER BY jam_scan ASC;",
        args: [idKaryawan, tanggal],
      });
      const absRes = await transaction.execute({
        sql: "SELECT * FROM absensi_harian WHERE id_karyawan = ? AND (tanggal = ? OR tanggal = date(?, '-1 day')) ORDER BY (CASE WHEN tanggal = ? THEN 0 ELSE 1 END) ASC LIMIT 1;",
        args: [idKaryawan, tanggal, tanggal, tanggal],
      });
      if (absRes.rows.length > 0) {
        const abs = absRes.rows[0] as Record<string, unknown>;
        const idSesi = String(abs.id_sesi);
        if (remRes.rows.length === 0) {
          await transaction.execute({
            sql: "DELETE FROM absensi_harian WHERE id_karyawan = ? AND (tanggal = ? OR tanggal = date(?, '-1 day'));",
            args: [idKaryawan, tanggal, tanggal],
          });
        } else {
          const inLog = remRes.rows.find(
            (r) => String(r.jenis_scan) === "Masuk",
          );
          const outLog = remRes.rows.find(
            (r) => String(r.jenis_scan) === "Pulang",
          );
          const inVal = inLog
            ? `${tanggal} ${String(inLog.jam_scan).slice(0, 8)}`
            : "";
          const outVal = outLog
            ? `${tanggal} ${String(outLog.jam_scan).slice(0, 8)}`
            : "";
          const statusAbsen =
            inVal && outVal
              ? "Lengkap"
              : inVal
                ? "Belum Pulang"
                : "Perlu Verifikasi";

          const hasil = await hitungUlangDariLogTersisa(
            transaction,
            Number(abs.id_shift || 1),
            inVal,
            outVal,
          );

          await transaction.execute({
            sql: `UPDATE absensi_harian SET jam_masuk = ?, jam_pulang = ?, status_kehadiran = 'Hadir',
                  status_absen = ?, update_terakhir = ?, menit_terlambat = ?, menit_datang_awal = ?,
                  jam_kerja = ?, lembur = ?, jam_kerja_kurang = ? WHERE id_sesi = ?;`,
            args: [
              inVal,
              outVal,
              statusAbsen,
              new Date().toISOString(),
              hasil.menitTerlambat,
              hasil.menitDatangAwal,
              hasil.jamKerja,
              hasil.lembur,
              hasil.jamKerjaKurang,
              idSesi,
            ],
          });
        }
      }
    }

    const revision = await appendChange(
      transaction,
      actor,
      event,
      event.payload,
    );
    return { revision, payload: { id_referensi: reference } };
  }
  if (event.operation !== "create") {
    throw new Error("Operasi Koreksi Admin tidak dikenali.");
  }
  const correction = event.payload.correction;
  const attendance = event.payload.attendance;
  const log = event.payload.log;
  if (
    !correction ||
    typeof correction !== "object" ||
    Array.isArray(correction) ||
    !attendance ||
    typeof attendance !== "object" ||
    Array.isArray(attendance) ||
    !log ||
    typeof log !== "object" ||
    Array.isArray(log)
  ) {
    throw new Error("Payload Koreksi Admin tidak valid.");
  }
  const data = correction as Record<string, unknown>;
  const daily = attendance as Record<string, unknown>;
  const logData = log as Record<string, unknown>;
  const reference = text(data, "id_referensi");
  const sessionId = text(daily, "id_sesi");
  if (!reference || !sessionId || !text(data, "jenis_koreksi")) {
    throw new Error("Data Koreksi Admin belum lengkap.");
  }
  const existing = await transaction.execute({
    sql: "SELECT update_terakhir FROM absensi_harian WHERE id_sesi = ? LIMIT 1;",
    args: [sessionId],
  });
  const current = existing.rows[0];
  const base = text(event.payload, "attendanceBaseUpdatedAt");
  if (
    (current && !base) ||
    (current && String(current.update_terakhir) !== base) ||
    (!current && base)
  ) {
    throw new Error(
      "Data absensi server berubah setelah Koreksi Admin lokal dibuat.",
    );
  }
  const correctionResult = await transaction.execute({
    sql: `INSERT INTO koreksi_admin (
      id_referensi, tanggal, id_karyawan, nama, divisi, jenis_koreksi,
      jam_koreksi, keterangan_admin, status_proses, timestamp, kode_operator
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Sudah Diproses', ?, ?);`,
    args: [
      reference,
      text(data, "tanggal"),
      text(data, "id_karyawan"),
      text(data, "nama"),
      text(data, "divisi"),
      text(data, "jenis_koreksi"),
      text(data, "jam_koreksi"),
      text(data, "keterangan_admin"),
      text(data, "timestamp"),
      actor.kode_operator,
    ],
  });
  const logResult = await transaction.execute({
    sql: `INSERT INTO log_scan (
      timestamp_scan, tanggal_kerja, jam_scan, id_karyawan, nama, divisi,
      jenis_scan, status_proses, sumber_data, catatan_sistem, keterangan,
      menit_terlambat, menit_datang_awal, id_referensi, kode_operator
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Berhasil', 'Koreksi Admin', ?, ?, ?, ?, ?, ?);`,
    args: [
      text(logData, "timestamp_scan"),
      text(logData, "tanggal_kerja"),
      text(logData, "jam_scan"),
      text(logData, "id_karyawan"),
      text(logData, "nama"),
      text(logData, "divisi"),
      text(logData, "jenis_scan"),
      text(logData, "catatan_sistem"),
      text(logData, "keterangan"),
      number(logData, "menit_terlambat"),
      number(logData, "menit_datang_awal"),
      reference,
      actor.kode_operator,
    ],
  });
  await transaction.execute({
    sql: `INSERT INTO absensi_harian (
      id_absensi, tanggal, id_karyawan, nama, kelas_divisi, jam_masuk, jam_pulang,
      status_kehadiran, status_absen, keterangan, sumber, update_terakhir,
      menit_terlambat, menit_datang_awal, jam_kerja, lembur,
      jam_kerja_kurang, id_shift, bulan, tahun, id_sesi, mode_tugas,
      id_backup, id_karyawan_asal, tanggal_tugas
    ) VALUES ((SELECT id_absensi FROM absensi_harian WHERE id_sesi = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Koreksi Admin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id_absensi) DO UPDATE SET
      jam_masuk = excluded.jam_masuk, jam_pulang = excluded.jam_pulang,
      status_kehadiran = excluded.status_kehadiran,
      status_absen = excluded.status_absen, keterangan = excluded.keterangan,
      sumber = 'Koreksi Admin', update_terakhir = excluded.update_terakhir,
      menit_terlambat = excluded.menit_terlambat,
      menit_datang_awal = excluded.menit_datang_awal,
      jam_kerja = excluded.jam_kerja, lembur = excluded.lembur,
      jam_kerja_kurang = excluded.jam_kerja_kurang;`,
    args: [
      sessionId,
      text(daily, "tanggal"),
      text(daily, "id_karyawan"),
      text(daily, "nama"),
      text(daily, "kelas_divisi"),
      text(daily, "jam_masuk"),
      text(daily, "jam_pulang"),
      text(daily, "status_kehadiran"),
      text(daily, "status_absen"),
      text(daily, "keterangan"),
      text(daily, "update_terakhir"),
      number(daily, "menit_terlambat"),
      number(daily, "menit_datang_awal"),
      number(daily, "jam_kerja"),
      number(daily, "lembur"),
      number(daily, "jam_kerja_kurang"),
      number(daily, "id_shift", 1),
      resolveMonth(daily),
      resolveYear(daily),
      sessionId,
      text(daily, "mode_tugas") || "NORMAL",
      text(daily, "id_backup"),
      text(daily, "id_karyawan_asal"),
      text(daily, "tanggal_tugas"),
    ],
  });
  const revision = await appendChange(transaction, actor, event, event.payload);
  return {
    revision,
    payload: {
      id_koreksi: Number(correctionResult.lastInsertRowid),
      id_log: Number(logResult.lastInsertRowid),
      id_referensi: reference,
      id_sesi: sessionId,
    },
  };
}

export async function applyBackup(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  if (event.operation === "create") {
    const source = event.payload.backup;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("Payload penugasan backup tidak valid.");
    }
    const data = source as Record<string, unknown>;
    const id = text(data, "id_backup");
    if (
      !id ||
      !text(data, "id_karyawan_asal") ||
      !text(data, "id_karyawan_pengganti")
    ) {
      throw new Error("Data penugasan backup belum lengkap.");
    }
    const employees = await transaction.execute({
      sql: `SELECT COUNT(*) AS total FROM master_data WHERE status_aktif = 'Aktif'
            AND id_unik IN (?, ?);`,
      args: [
        text(data, "id_karyawan_asal"),
        text(data, "id_karyawan_pengganti"),
      ],
    });
    if (Number(employees.rows[0]?.total ?? 0) !== 2) {
      throw new Error("Karyawan asal atau pengganti tidak aktif di server.");
    }
    await transaction.execute({
      sql: `INSERT INTO backup_karyawan (
        id_backup, tanggal_tugas, id_karyawan_asal, nama_karyawan_asal,
        divisi_asal, id_shift_asal, id_karyawan_pengganti,
        nama_karyawan_pengganti, divisi_pengganti, id_shift_normal_pengganti,
        id_shift_backup, alasan_backup, status_tugas, kode_operator,
        waktu_input, catatan
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Aktif', ?, ?, ?);`,
      args: [
        id,
        text(data, "tanggal_tugas"),
        text(data, "id_karyawan_asal"),
        text(data, "nama_karyawan_asal"),
        text(data, "divisi_asal"),
        number(data, "id_shift_asal"),
        text(data, "id_karyawan_pengganti"),
        text(data, "nama_karyawan_pengganti"),
        text(data, "divisi_pengganti"),
        number(data, "id_shift_normal_pengganti"),
        number(data, "id_shift_backup"),
        text(data, "alasan_backup"),
        actor.kode_operator,
        text(data, "waktu_input"),
        text(data, "catatan"),
      ],
    });
  } else if (event.operation === "cancel") {
    const changed = await transaction.execute({
      sql: `UPDATE backup_karyawan SET status_tugas = 'Dibatalkan',
            waktu_dibatalkan = ?, operator_pembatalan = ?
            WHERE id_backup = ? AND status_tugas = 'Aktif';`,
      args: [
        text(event.payload, "waktu_dibatalkan"),
        actor.kode_operator,
        event.entityKey,
      ],
    });
    if (changed.rowsAffected === 0) {
      throw new Error("Penugasan backup aktif tidak ditemukan di server.");
    }
  } else if (event.operation === "delete") {
    const existing = await transaction.execute({
      sql: "SELECT id_karyawan_pengganti FROM backup_karyawan WHERE id_backup = ? LIMIT 1;",
      args: [event.entityKey],
    });
    const pengganti = existing.rows[0]?.id_karyawan_pengganti
      ? String(existing.rows[0].id_karyawan_pengganti)
      : null;

    await transaction.execute({
      sql: "DELETE FROM backup_karyawan WHERE id_backup = ?;",
      args: [event.entityKey],
    });

    if (pengganti) {
      await transaction.execute({
        sql: `UPDATE master_data
              SET status_backup = CASE
                WHEN EXISTS(
                  SELECT 1 FROM backup_karyawan
                  WHERE id_karyawan_pengganti = ?1 AND status_tugas = 'Aktif'
                ) THEN 'BACKUP' ELSE 'NORMAL' END
              WHERE id_unik = ?1;`,
        args: [pengganti],
      });
    }
  } else {
    throw new Error("Operasi penugasan backup tidak dikenali.");
  }
  const revision = await appendChange(transaction, actor, event, event.payload);
  return { revision, payload: { id_backup: event.entityKey } };
}

/**
 * Menghitung ulang metrik absensi dari log scan yang tersisa setelah sebuah
 * koreksi/import dihapus, dengan rumus yang sama dengan scanner.
 */
async function hitungUlangDariLogTersisa(
  transaction: Transaction,
  idShift: number,
  inVal: string,
  outVal: string,
): Promise<HasilHitungDariJam> {
  const shiftRes = await transaction.execute({
    sql: "SELECT jam_masuk, jam_pulang, jam_kerja_normal_menit, istirahat_menit, offset_istirahat_mulai FROM tbl_shift WHERE id_shift = ? LIMIT 1;",
    args: [idShift],
  });
  const parseMin = (t: string): number | null => {
    if (!t) return null;
    const clean = t.includes(" ") ? t.split(" ")[1] : t;
    const parts = clean.split(":");
    if (parts.length < 2) return null;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };
  const inMin = parseMin(inVal);
  const outMin = parseMin(outVal);
  let duration: number | null = null;
  if (inMin !== null && outMin !== null) {
    duration = outMin - inMin;
    if (duration < 0) duration += 1440;
  }
  return hitungUlangAbsensiDariJam({
    masukMenit: inMin,
    durasiMenit: duration,
    shift: aturanShiftDariBaris(
      shiftRes.rows[0] as Record<string, unknown> | undefined,
    ),
  });
}

export async function applyOfflineImport(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  if (event.operation === "delete") {
    const eventKey = text(event.payload, "event_key") || event.entityKey;
    const impRes = await transaction.execute({
      sql: "SELECT id_unik, tanggal FROM import_offline WHERE event_key = ? LIMIT 1;",
      args: [eventKey],
    });
    const imp = impRes.rows[0];

    await transaction.execute({
      sql: "DELETE FROM import_offline WHERE event_key = ?;",
      args: [eventKey],
    });
    if (imp) {
      const idUnik = String(imp.id_unik);
      const tanggal = String(imp.tanggal);
      await transaction.execute({
        sql: "DELETE FROM log_scan WHERE id_referensi = ? OR (id_karyawan = ? AND tanggal_kerja = ? AND sumber_data = 'Import Offline');",
        args: [eventKey, idUnik, tanggal],
      });
      const remRes = await transaction.execute({
        sql: "SELECT * FROM log_scan WHERE id_karyawan = ? AND tanggal_kerja = ? ORDER BY jam_scan ASC;",
        args: [idUnik, tanggal],
      });
      const absRes = await transaction.execute({
        sql: "SELECT * FROM absensi_harian WHERE id_karyawan = ? AND (tanggal = ? OR tanggal = date(?, '-1 day')) ORDER BY (CASE WHEN tanggal = ? THEN 0 ELSE 1 END) ASC LIMIT 1;",
        args: [idUnik, tanggal, tanggal, tanggal],
      });
      if (absRes.rows.length > 0) {
        const abs = absRes.rows[0] as Record<string, unknown>;
        const idSesi = String(abs.id_sesi);
        if (remRes.rows.length === 0) {
          await transaction.execute({
            sql: "DELETE FROM absensi_harian WHERE id_karyawan = ? AND (tanggal = ? OR tanggal = date(?, '-1 day'));",
            args: [idUnik, tanggal, tanggal],
          });
        } else {
          const inLog = remRes.rows.find(
            (r) => String(r.jenis_scan) === "Masuk",
          );
          const outLog = remRes.rows.find(
            (r) => String(r.jenis_scan) === "Pulang",
          );
          const inVal = inLog
            ? `${tanggal} ${String(inLog.jam_scan).slice(0, 8)}`
            : "";
          const outVal = outLog
            ? `${tanggal} ${String(outLog.jam_scan).slice(0, 8)}`
            : "";
          const statusAbsen =
            inVal && outVal
              ? "Lengkap"
              : inVal
                ? "Belum Pulang"
                : "Perlu Verifikasi";

          const hasil = await hitungUlangDariLogTersisa(
            transaction,
            Number(abs.id_shift || 1),
            inVal,
            outVal,
          );

          await transaction.execute({
            sql: `UPDATE absensi_harian SET jam_masuk = ?, jam_pulang = ?, status_kehadiran = 'Hadir',
                  status_absen = ?, update_terakhir = ?, menit_terlambat = ?, menit_datang_awal = ?,
                  jam_kerja = ?, lembur = ?, jam_kerja_kurang = ? WHERE id_sesi = ?;`,
            args: [
              inVal,
              outVal,
              statusAbsen,
              new Date().toISOString(),
              hasil.menitTerlambat,
              hasil.menitDatangAwal,
              hasil.jamKerja,
              hasil.lembur,
              hasil.jamKerjaKurang,
              idSesi,
            ],
          });
        }
      }
    } else {
      await transaction.execute({
        sql: "DELETE FROM log_scan WHERE id_referensi = ?;",
        args: [eventKey],
      });
    }
    const revision = await appendChange(
      transaction,
      actor,
      event,
      event.payload,
    );
    return { revision, payload: { event_key: eventKey } };
  }
  const importValue = event.payload.import;
  const attendanceValue = event.payload.attendance;
  const logsValue = event.payload.logs;
  if (
    event.operation !== "row" ||
    !importValue ||
    typeof importValue !== "object" ||
    Array.isArray(importValue) ||
    !attendanceValue ||
    typeof attendanceValue !== "object" ||
    Array.isArray(attendanceValue) ||
    !Array.isArray(logsValue)
  ) {
    throw new Error("Payload Import Offline tidak valid.");
  }
  const imported = importValue as Record<string, unknown>;
  const daily = attendanceValue as Record<string, unknown>;
  const sessionId = text(daily, "id_sesi");
  const currentResult = await transaction.execute({
    sql: "SELECT sumber, update_terakhir FROM absensi_harian WHERE id_sesi = ? LIMIT 1;",
    args: [sessionId],
  });
  const current = currentResult.rows[0];
  if (current && String(current.sumber) === "Koreksi Admin") {
    throw new Error("Data sudah dikoreksi admin; import tidak boleh menimpa.");
  }
  const base = text(event.payload, "attendanceBaseUpdatedAt");
  if (
    (current && !base) ||
    (current && String(current.update_terakhir) !== base) ||
    (!current && base)
  ) {
    throw new Error(
      "Data absensi server berubah setelah Import Offline lokal dibuat.",
    );
  }
  const importResult = await transaction.execute({
    sql: `INSERT INTO import_offline (event_key, timestamp_input, tanggal, id_unik,
      nama, divisi, jam_masuk, jam_pulang, status_kehadiran, status_absen,
      keterangan, status_proses, diproses_pada, pesan_error, kode_operator)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Sudah Diproses', ?, '', ?);`,
    args: [
      text(imported, "event_key"),
      text(imported, "timestamp_input"),
      text(imported, "tanggal"),
      text(imported, "id_unik"),
      text(imported, "nama"),
      text(imported, "divisi"),
      text(imported, "jam_masuk"),
      text(imported, "jam_pulang"),
      text(imported, "status_kehadiran"),
      text(imported, "status_absen"),
      text(imported, "keterangan"),
      text(imported, "diproses_pada") || new Date().toISOString(),
      actor.kode_operator,
    ],
  });
  const logIds: number[] = [];
  for (const logItem of logsValue) {
    if (!logItem || typeof logItem !== "object" || Array.isArray(logItem)) {
      continue;
    }
    const log = logItem as Record<string, unknown>;
    const logRes = await transaction.execute({
      sql: `INSERT INTO log_scan (timestamp_scan, tanggal_kerja, jam_scan, id_karyawan,
        nama, divisi, jenis_scan, status_proses, sumber_data, catatan_sistem,
        keterangan, menit_terlambat, menit_datang_awal, id_referensi, kode_operator)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Berhasil', 'Import Offline', ?, ?, ?, ?, ?, ?);`,
      args: [
        text(log, "timestamp_scan"),
        text(log, "tanggal_kerja"),
        text(log, "jam_scan"),
        text(log, "id_karyawan"),
        text(log, "nama"),
        text(log, "divisi"),
        text(log, "jenis_scan"),
        text(log, "catatan_sistem"),
        text(log, "keterangan"),
        number(log, "menit_terlambat"),
        number(log, "menit_datang_awal"),
        text(log, "id_referensi"),
        actor.kode_operator,
      ],
    });
    logIds.push(Number(logRes.lastInsertRowid));
  }
  await transaction.execute({
    sql: `INSERT INTO absensi_harian (id_absensi, tanggal, id_karyawan, nama, kelas_divisi,
      jam_masuk, jam_pulang, status_kehadiran, status_absen, keterangan, sumber,
      update_terakhir, menit_terlambat, menit_datang_awal, jam_kerja, lembur,
      jam_kerja_kurang, id_shift, bulan, tahun, id_sesi, mode_tugas, id_backup,
      id_karyawan_asal, tanggal_tugas)
      VALUES ((SELECT id_absensi FROM absensi_harian WHERE id_sesi = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Import Offline', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id_absensi) DO UPDATE SET jam_masuk = excluded.jam_masuk,
      jam_pulang = excluded.jam_pulang, status_kehadiran = excluded.status_kehadiran,
      status_absen = excluded.status_absen, keterangan = excluded.keterangan,
      sumber = 'Import Offline', update_terakhir = excluded.update_terakhir,
      menit_terlambat = excluded.menit_terlambat,
      menit_datang_awal = excluded.menit_datang_awal, jam_kerja = excluded.jam_kerja,
      lembur = excluded.lembur, jam_kerja_kurang = excluded.jam_kerja_kurang;`,
    args: [
      sessionId,
      text(daily, "tanggal"),
      text(daily, "id_karyawan"),
      text(daily, "nama"),
      text(daily, "kelas_divisi"),
      text(daily, "jam_masuk"),
      text(daily, "jam_pulang"),
      text(daily, "status_kehadiran"),
      text(daily, "status_absen"),
      text(daily, "keterangan"),
      text(daily, "update_terakhir"),
      number(daily, "menit_terlambat"),
      number(daily, "menit_datang_awal"),
      number(daily, "jam_kerja"),
      number(daily, "lembur"),
      number(daily, "jam_kerja_kurang"),
      number(daily, "id_shift", 1),
      resolveMonth(daily),
      resolveYear(daily),
      sessionId,
      text(daily, "mode_tugas") || "NORMAL",
      text(daily, "id_backup"),
      text(daily, "id_karyawan_asal"),
      text(daily, "tanggal_tugas"),
    ],
  });
  const revision = await appendChange(transaction, actor, event, event.payload);
  return {
    revision,
    payload: {
      id_import: Number(importResult.lastInsertRowid),
      log_ids: logIds,
      event_key: event.entityKey,
      id_sesi: sessionId,
    },
  };
}

export async function applyLogScan(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  if (event.operation !== "delete") {
    throw new Error("Operasi Log Scan tidak dikenali.");
  }
  const idLog = number(event.payload, "id_log", 0);
  const ref = text(event.payload, "id_referensi");
  if (idLog > 0) {
    await transaction.execute({
      sql: "DELETE FROM log_scan WHERE id_log = ?;",
      args: [idLog],
    });
  } else if (ref) {
    await transaction.execute({
      sql: "DELETE FROM log_scan WHERE id_referensi = ?;",
      args: [ref],
    });
  } else {
    await transaction.execute({
      sql: "DELETE FROM log_scan WHERE id_log = ?;",
      args: [event.entityKey],
    });
  }
  const revision = await appendChange(transaction, actor, event, event.payload);
  return { revision, payload: { entityKey: event.entityKey } };
}
