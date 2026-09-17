import type { Transaction } from "@libsql/client";
import type { OperatorUser } from "@/lib/auth/operator-user";
import type { OperationalSyncEvent } from "@/lib/server/operational/sync-schema";
import {
  normalizeHolidayDate,
  normalizeScopeType,
  normalizeScopeValue,
} from "@/lib/validations/holiday-whitelist";

import { appendChange, number, text } from "./shared";

/**
 * Penerapan event sinkronisasi untuk data master: karyawan, shift, hari libur, dan whitelist hari libur.
 *
 * Dipecah dari `server/operational/sync-push.ts` (2.309 baris). Jalur impornya
 * TIDAK berubah: `@/lib/server/operational/sync-push` kini direktori dengan
 * `index.ts` yang memegang `processOperationalSyncEvent` dan dispatcher-nya.
 */

export async function applyEmployee(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  const payload = event.payload;
  if (event.operation === "create") {
    const id = text(payload, "id_unik");
    const code = text(payload, "kode_karyawan");
    const name = text(payload, "nama");
    const division = text(payload, "divisi");
    if (!id || !code || name.length < 2 || !division) {
      throw new Error("Data karyawan belum lengkap atau tidak valid.");
    }
    const existing = await transaction.execute({
      sql: `SELECT id_unik, kode_karyawan FROM master_data
            WHERE id_unik = ? OR kode_karyawan = ?;`,
      args: [id, code],
    });
    const sameEmployee = existing.rows.some(
      (row) => String(row.id_unik) === id,
    );
    const codeOwnedByAnotherEmployee = existing.rows.some(
      (row) => String(row.kode_karyawan) === code && String(row.id_unik) !== id,
    );
    if (!sameEmployee && codeOwnedByAnotherEmployee) {
      throw new Error("Kode karyawan sudah digunakan oleh karyawan lain.");
    }
    if (!sameEmployee) {
      await transaction.execute({
        sql: `
        INSERT INTO master_data (
          id_unik, kode_karyawan, nama, divisi, jabatan_status, no_hp, lp,
          id_shift, status_aktif, tanggal_daftar, catatan, token_absensi,
          qr_code, status_qr, jenis_personil, tanggal_mulai_aktif,
          tanggal_selesai_aktif, unit, status_backup
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Generated', ?, ?, ?, ?, 'NORMAL');
      `,
        args: [
          id,
          code,
          name,
          division,
          text(payload, "jabatan_status") || "-",
          text(payload, "no_hp"),
          text(payload, "lp") || "L",
          number(payload, "id_shift", 1),
          text(payload, "status_aktif") || "Aktif",
          text(payload, "tanggal_daftar") ||
            new Date().toISOString().slice(0, 10),
          text(payload, "catatan"),
          text(payload, "token_absensi"),
          text(payload, "qr_code"),
          text(payload, "jenis_personil") || "Pegawai",
          text(payload, "tanggal_mulai_aktif") ||
            new Date().toISOString().slice(0, 10),
          text(payload, "tanggal_selesai_aktif"),
          text(payload, "unit"),
        ],
      });
      await transaction.execute({
        sql: `
        INSERT INTO id_card (
          id_unik, nama, divisi, idcard_status, tanggal_generate
        ) SELECT ?, ?, ?, 'Belum', ?
        WHERE NOT EXISTS (SELECT 1 FROM id_card WHERE id_unik = ?);
      `,
        args: [id, name, division, new Date().toISOString().slice(0, 10), id],
      });
    }
  } else if (event.operation === "update") {
    await transaction.execute({
      sql: `
        UPDATE master_data SET kode_karyawan = ?, nama = ?, divisi = ?,
          jabatan_status = ?, no_hp = ?, lp = ?, id_shift = ?,
          status_aktif = ?, catatan = ?, jenis_personil = ?,
          tanggal_mulai_aktif = ?, tanggal_selesai_aktif = ?, unit = ?
        WHERE id_unik = ?;
      `,
      args: [
        text(payload, "kode_karyawan"),
        text(payload, "nama"),
        text(payload, "divisi"),
        text(payload, "jabatan_status"),
        text(payload, "no_hp"),
        text(payload, "lp"),
        number(payload, "id_shift"),
        text(payload, "status_aktif"),
        text(payload, "catatan"),
        text(payload, "jenis_personil") || "Pegawai",
        text(payload, "tanggal_mulai_aktif") || null,
        text(payload, "tanggal_selesai_aktif") || null,
        text(payload, "unit") || null,
        event.entityKey,
      ],
    });
    await transaction.execute({
      sql: "UPDATE id_card SET nama = ?, divisi = ? WHERE id_unik = ?;",
      args: [text(payload, "nama"), text(payload, "divisi"), event.entityKey],
    });
    await transaction.execute({
      sql: "UPDATE absensi_harian SET nama = ?, kelas_divisi = ? WHERE id_karyawan = ?;",
      args: [text(payload, "nama"), text(payload, "divisi"), event.entityKey],
    });
    await transaction.execute({
      sql: "UPDATE log_scan SET nama = ?, divisi = ? WHERE id_karyawan = ?;",
      args: [text(payload, "nama"), text(payload, "divisi"), event.entityKey],
    });
    await transaction.execute({
      sql: "UPDATE backup_karyawan SET nama_karyawan_pengganti = ?, divisi_pengganti = ? WHERE id_karyawan_pengganti = ?;",
      args: [text(payload, "nama"), text(payload, "divisi"), event.entityKey],
    });
    await transaction.execute({
      sql: "UPDATE backup_karyawan SET nama_karyawan_asal = ?, divisi_asal = ? WHERE id_karyawan_asal = ?;",
      args: [text(payload, "nama"), text(payload, "divisi"), event.entityKey],
    });
    await transaction.execute({
      sql: "UPDATE koreksi_admin SET nama = ?, divisi = ? WHERE id_karyawan = ?;",
      args: [text(payload, "nama"), text(payload, "divisi"), event.entityKey],
    });
  } else if (event.operation === "status") {
    const status = text(payload, "status_aktif");
    if (status !== "Aktif" && status !== "Nonaktif") {
      throw new Error("Status karyawan tidak valid.");
    }
    await transaction.execute({
      sql: "UPDATE master_data SET status_aktif = ? WHERE id_unik = ?;",
      args: [status, event.entityKey],
    });
  } else if (event.operation === "token") {
    await transaction.execute({
      sql: `
        UPDATE master_data SET token_absensi = ?, qr_code = ?, status_qr = 'Generated'
        WHERE id_unik = ?;
      `,
      args: [
        text(payload, "token_absensi"),
        text(payload, "qr_code"),
        event.entityKey,
      ],
    });
  } else {
    throw new Error("Operasi Karyawan tidak dikenali.");
  }
  const revision = await appendChange(transaction, actor, event, payload);
  return {
    revision,
    payload: { id_unik: event.entityKey },
  };
}

export async function applyShift(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  const payload = event.payload;
  let entityKey = event.entityKey;
  let serverId = number(payload, "id_shift");
  if (event.operation === "create") {
    const code = number(payload, "kode_shift");
    const existing = await transaction.execute({
      sql: "SELECT id_shift FROM tbl_shift WHERE kode_shift = ? LIMIT 1;",
      args: [code],
    });
    if (existing.rows.length > 0) {
      serverId = Number(existing.rows[0]?.id_shift);
    } else {
      const result = await transaction.execute({
        sql: `
        INSERT INTO tbl_shift (
          kode_shift, nama_shift, jam_masuk, jam_pulang, awal_absen_menit,
          batas_masuk_menit, toleransi_masuk_menit, jam_kerja_normal_menit,
          istirahat_menit, batas_pulang_menit, offset_istirahat_mulai,
          offset_generate_alfa, buffer_shift_malam_menit, izinkan_multi_sesi,
          shift_lanjutan_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `,
        args: [
          code,
          text(payload, "nama_shift"),
          text(payload, "jam_masuk"),
          text(payload, "jam_pulang"),
          number(payload, "awal_absen_menit", 120),
          number(payload, "batas_masuk_menit", 60),
          number(payload, "toleransi_masuk_menit"),
          number(payload, "jam_kerja_normal_menit", 480),
          number(payload, "istirahat_menit", 60),
          number(payload, "batas_pulang_menit", 240),
          number(payload, "offset_istirahat_mulai", 240),
          number(payload, "offset_generate_alfa", 180),
          number(payload, "buffer_shift_malam_menit", 120),
          number(payload, "izinkan_multi_sesi", 0),
          number(payload, "shift_lanjutan_id", 0),
        ],
      });
      serverId = Number(result.lastInsertRowid);
    }
    entityKey = String(serverId);
  } else if (event.operation === "update") {
    serverId = Number(event.entityKey);
    await transaction.execute({
      sql: `
        UPDATE tbl_shift SET 
          nama_shift = ?, jam_masuk = ?, jam_pulang = ?,
          awal_absen_menit = ?, batas_masuk_menit = ?, toleransi_masuk_menit = ?,
          jam_kerja_normal_menit = ?, istirahat_menit = ?, batas_pulang_menit = ?,
          offset_istirahat_mulai = ?, offset_generate_alfa = ?, buffer_shift_malam_menit = ?,
          izinkan_multi_sesi = ?,
          shift_lanjutan_id = ?
        WHERE id_shift = ?;
      `,
      args: [
        text(payload, "nama_shift"),
        text(payload, "jam_masuk"),
        text(payload, "jam_pulang"),
        number(payload, "awal_absen_menit", 120),
        number(payload, "batas_masuk_menit", 60),
        number(payload, "toleransi_masuk_menit"),
        number(payload, "jam_kerja_normal_menit", 480),
        number(payload, "istirahat_menit", 60),
        number(payload, "batas_pulang_menit", 240),
        number(payload, "offset_istirahat_mulai", 240),
        number(payload, "offset_generate_alfa", 180),
        number(payload, "buffer_shift_malam_menit", 120),
        number(payload, "izinkan_multi_sesi", 0),
        number(payload, "shift_lanjutan_id", 0),
        serverId,
      ],
    });
  } else if (event.operation === "delete") {
    serverId = Number(event.entityKey);
    const used = await transaction.execute({
      sql: "SELECT COUNT(*) AS total FROM master_data WHERE id_shift = ?;",
      args: [serverId],
    });
    if (Number(used.rows[0]?.total ?? 0) > 0) {
      throw new Error("Shift masih digunakan oleh karyawan.");
    }
    await transaction.execute({
      sql: "DELETE FROM tbl_shift WHERE id_shift = ?;",
      args: [serverId],
    });
  } else {
    throw new Error("Operasi Shift tidak dikenali.");
  }

  const changeEvent = { ...event, entityKey };
  const revision = await appendChange(transaction, actor, changeEvent, payload);
  return {
    revision,
    payload: {
      id_shift: serverId,
      local_id_shift: number(payload, "local_id_shift"),
    },
  };
}

/**
 * Whitelist Shift/Divisi hari libur.
 *
 * Kuncinya TEXT buatan klien, bukan AUTOINCREMENT, sehingga tidak ada
 * penerjemahan id lokal -> id server seperti pada `applyHoliday`: baris yang
 * sama dari perangkat mana pun selalu jatuh ke id yang sama, dan
 * `ON CONFLICT(id) DO UPDATE` membuat push ulang idempoten.
 */
export async function applyHolidayWhitelist(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  const payload = event.payload;
  const id = text(payload, "id") || event.entityKey;
  if (!id) {
    throw new Error("Whitelist hari libur tanpa id tidak dapat diproses.");
  }

  if (event.operation === "delete") {
    await transaction.execute({
      sql: "DELETE FROM hari_libur_whitelist WHERE id = ?;",
      args: [id],
    });
  } else {
    const scopeType = normalizeScopeType(text(payload, "scope_type"));
    const scopeValue =
      scopeType === null
        ? null
        : normalizeScopeValue(scopeType, text(payload, "scope_value"));
    if (scopeType === null || scopeValue === null) {
      throw new Error(
        "Cakupan whitelist hari libur tidak sah. Gunakan kode Shift berupa angka atau nama Divisi.",
      );
    }

    const now = new Date().toISOString();
    await transaction.execute({
      sql: `INSERT INTO hari_libur_whitelist (
              id, scope_type, scope_value, tanggal_libur, keterangan,
              status_aktif, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              scope_type = excluded.scope_type,
              scope_value = excluded.scope_value,
              tanggal_libur = excluded.tanggal_libur,
              keterangan = excluded.keterangan,
              status_aktif = excluded.status_aktif,
              updated_at = excluded.updated_at;`,
      args: [
        id,
        scopeType,
        scopeValue,
        normalizeHolidayDate(text(payload, "tanggal_libur")),
        text(payload, "keterangan") || null,
        number(payload, "status_aktif", 1) === 0 ? 0 : 1,
        text(payload, "created_at") || now,
        text(payload, "updated_at") || now,
      ],
    });
  }

  const revision = await appendChange(transaction, actor, event, payload);
  return { revision, payload: { id } };
}

export async function applyHoliday(
  transaction: Transaction,
  actor: OperatorUser,
  event: OperationalSyncEvent,
) {
  const payload = event.payload;
  let serverId = 0;
  let entityKey = event.entityKey;

  if (event.operation === "create") {
    const tanggal = text(payload, "tanggal");
    const existing = await transaction.execute({
      sql: "SELECT id_libur FROM tbl_hari_libur WHERE tanggal = ? LIMIT 1;",
      args: [tanggal],
    });
    if (existing.rows.length > 0) {
      serverId = Number(existing.rows[0].id_libur);
      await transaction.execute({
        sql: `UPDATE tbl_hari_libur SET
                nama_libur = ?, jenis_libur = ?, keterangan = ?, status_aktif = ?
              WHERE id_libur = ?;`,
        args: [
          text(payload, "nama_libur"),
          text(payload, "jenis_libur") || "Libur Nasional",
          text(payload, "keterangan") || null,
          number(payload, "status_aktif", 1),
          serverId,
        ],
      });
    } else {
      const result = await transaction.execute({
        sql: `INSERT INTO tbl_hari_libur (
                tanggal, nama_libur, jenis_libur, keterangan, status_aktif
              ) VALUES (?, ?, ?, ?, ?);`,
        args: [
          tanggal,
          text(payload, "nama_libur"),
          text(payload, "jenis_libur") || "Libur Nasional",
          text(payload, "keterangan") || null,
          number(payload, "status_aktif", 1),
        ],
      });
      serverId = Number(result.lastInsertRowid);
    }
    entityKey = String(serverId);
  } else if (event.operation === "update") {
    serverId = Number(event.entityKey) || Number(payload.id_libur);
    await transaction.execute({
      sql: `UPDATE tbl_hari_libur SET
              tanggal = COALESCE(NULLIF(?, ''), tanggal),
              nama_libur = COALESCE(NULLIF(?, ''), nama_libur),
              jenis_libur = COALESCE(NULLIF(?, ''), jenis_libur),
              keterangan = ?,
              status_aktif = COALESCE(?, status_aktif)
            WHERE id_libur = ?;`,
      args: [
        text(payload, "tanggal"),
        text(payload, "nama_libur"),
        text(payload, "jenis_libur"),
        text(payload, "keterangan") || null,
        payload.status_aktif !== undefined
          ? Number(payload.status_aktif)
          : null,
        serverId,
      ],
    });
  } else if (event.operation === "delete") {
    serverId = Number(event.entityKey) || Number(payload.id_libur);
    const tanggal = text(payload, "tanggal");
    if (serverId > 0) {
      await transaction.execute({
        sql: "DELETE FROM tbl_hari_libur WHERE id_libur = ?;",
        args: [serverId],
      });
    } else if (tanggal) {
      await transaction.execute({
        sql: "DELETE FROM tbl_hari_libur WHERE tanggal = ?;",
        args: [tanggal],
      });
    }
  } else {
    throw new Error("Operasi Hari Libur tidak dikenali.");
  }

  const changeEvent = { ...event, entityKey };
  const revision = await appendChange(transaction, actor, changeEvent, payload);
  return {
    revision,
    payload: {
      id_libur: serverId,
      entityKey,
      ...payload,
    },
  };
}
