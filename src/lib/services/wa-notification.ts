import "server-only";

import crypto from "node:crypto";
import type { Client } from "@libsql/client";
import {
  isValidOperatorPhone,
  normalizeOperatorPhone,
} from "@/lib/operators/contact";
import { ApiRequestError } from "@/lib/server/http/api-response";
import {
  isValidWaNotificationStatus,
  isWaNotificationKind,
  parseAmbangAlfaDays,
  parseAmbangAlfaLimit,
  settingEnabled,
  validateWaTemplate,
  WA_AUTO_SEND_KEY,
  WA_NOTIFICATION_KINDS,
  WA_NOTIFICATION_STATUSES,
  WA_NOTIFY_AMBANG_ALFA_DAYS_KEY,
  WA_NOTIFY_AMBANG_ALFA_KEY,
  WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY,
  WA_NOTIFY_BOLOS_KEY,
  WA_NOTIFY_IMPORT_MANUAL_KEY,
  WA_NOTIFY_KOREKSI_ADMIN_KEY,
  WA_NOTIFY_SCAN_MASUK_KEY,
  WA_NOTIFY_SCAN_PULANG_KEY,
  WA_TEMPLATE_LABELS,
  type WaTemplateMap,
  waTemplateKey,
} from "@/lib/validations/wa-notification";
import type {
  WaConfig,
  WaConfigDraft,
  WaConfigProvider,
  WaNotificationDraft,
  WaNotificationFilter,
  WaNotificationItem,
} from "@/types/wa-notification";

export function generateWaNotificationId(): string {
  return `wa_${crypto.randomBytes(16).toString("hex")}`;
}

export async function listWaNotifications(
  client: Client,
  filter?: WaNotificationFilter,
): Promise<{ items: WaNotificationItem[] }> {
  let sql = `
    SELECT n.id_notifikasi, n.dedupe_key, n.jenis, n.id_siswa, n.tujuan_nomor,
           n.isi_pesan, n.status, n.attempt_count, n.last_error, n.sent_at,
           n.created_at, n.updated_at,
           COALESCE(s.nama_lengkap, m.nama, '') AS nama_siswa,
           COALESCE(r.nama_rombel, m.divisi, '') AS nama_rombel
    FROM notifikasi_wa n
    LEFT JOIN siswa_data s ON s.id_siswa = n.id_siswa
    LEFT JOIN akademik_rombel r ON r.id_rombel = s.id_rombel
    LEFT JOIN master_data m ON m.id_unik = n.id_siswa
    WHERE 1=1
  `;
  const args: (string | number)[] = [];

  const status = filter?.status?.trim();
  if (status && status !== "Semua") {
    sql += " AND n.status = ?";
    args.push(status);
  }

  const jenis = filter?.jenis?.trim();
  if (jenis && jenis !== "Semua") {
    sql += " AND n.jenis = ?";
    args.push(jenis);
  }

  const idSiswa = (filter?.idSiswa ?? filter?.id_siswa)?.trim();
  if (idSiswa) {
    sql += " AND n.id_siswa = ?";
    args.push(idSiswa);
  }

  const tanggal = filter?.tanggal?.trim();
  if (tanggal) {
    sql += " AND n.created_at LIKE ?";
    args.push(`${tanggal}%`);
  }

  sql += " ORDER BY n.created_at DESC";
  const limit = Math.min(Math.max(filter?.limit ?? 200, 1), 1000);
  sql += ` LIMIT ${limit};`;

  const result = await client.execute({ sql, args });
  const items: WaNotificationItem[] = result.rows.map((row) => ({
    id_notifikasi: String(row.id_notifikasi ?? ""),
    dedupe_key: String(row.dedupe_key ?? ""),
    jenis: String(row.jenis ?? "scan_masuk") as WaNotificationItem["jenis"],
    id_siswa: row.id_siswa != null ? String(row.id_siswa) : null,
    tujuan_nomor: String(row.tujuan_nomor ?? ""),
    isi_pesan: String(row.isi_pesan ?? ""),
    status: String(row.status ?? "Menunggu") as WaNotificationItem["status"],
    attempt_count: Number(row.attempt_count ?? 0),
    last_error: row.last_error != null ? String(row.last_error) : null,
    sent_at: row.sent_at != null ? String(row.sent_at) : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    nama_siswa: String(row.nama_siswa ?? ""),
    nama_rombel: String(row.nama_rombel ?? ""),
  }));

  return { items };
}

export async function queueWaNotification(
  client: Client,
  draft: WaNotificationDraft,
): Promise<{ sukses: boolean; id_notifikasi: string }> {
  const id = draft.id_notifikasi?.trim() || generateWaNotificationId();
  const dedupeKey = draft.dedupe_key.trim();
  if (!dedupeKey) {
    throw new Error("Kunci deduplikasi (dedupe_key) wajib diisi.");
  }

  const validJenis = ["scan_masuk", "scan_pulang", "bolos", "ambang_alfa"];
  if (!validJenis.includes(draft.jenis)) {
    throw new Error("Jenis notifikasi tidak valid.");
  }

  // SENGAJA tidak memeriksa sakelar `wa_notify_*`.
  //
  // Sakelar itu mengatur PRODUKSI OTOMATIS — scanner yang mengantre sendiri
  // pada setiap kartu yang ditempel. Fungsi ini adalah jalur eksplisit: sebuah
  // permintaan sadar untuk mengantrekan satu pesan tertentu. Menutupnya dengan
  // sakelar yang sama akan membuat tindakan yang disengaja gagal tanpa alasan
  // yang masuk akal bagi orang yang melakukannya.
  //
  // Yang membendung banjir antrean adalah gerbang di `scanner.rs`, bukan di
  // sini. Jangan memindahkannya ke sini "supaya konsisten".

  const canonPhone = normalizeOperatorPhone(draft.tujuan_nomor);
  if (!isValidOperatorPhone(canonPhone)) {
    throw new Error(
      "Nomor tujuan WhatsApp tidak valid. Format: 08... atau +62...",
    );
  }

  const isiPesan = draft.isi_pesan.trim();
  if (!isiPesan) {
    throw new Error("Isi pesan notifikasi WhatsApp tidak boleh kosong.");
  }
  if (isiPesan.length > 5000) {
    throw new Error("Isi pesan WhatsApp melebihi batas 5000 karakter.");
  }

  // Status asing DITOLAK, bukan dinormalkan menjadi `Menunggu`. Baris yang
  // terlanjur berstatus `Menunggu` akan benar-benar dikirim ke nomor wali
  // seorang siswa pada siklus pengurasan berikutnya — kesalahan yang tidak bisa
  // ditarik kembali.
  const status = draft.status ?? "Menunggu";
  if (!isValidWaNotificationStatus(status)) {
    throw new Error(
      `Status notifikasi tidak valid. Pilihan: ${WA_NOTIFICATION_STATUSES.join(", ")}.`,
    );
  }

  await client.execute({
    sql: `
      INSERT INTO notifikasi_wa (
        id_notifikasi, dedupe_key, jenis, id_siswa, tujuan_nomor,
        isi_pesan, status, attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
      ON CONFLICT(id_notifikasi) DO UPDATE SET
        dedupe_key = excluded.dedupe_key,
        jenis = excluded.jenis,
        id_siswa = excluded.id_siswa,
        tujuan_nomor = excluded.tujuan_nomor,
        isi_pesan = excluded.isi_pesan,
        status = excluded.status,
        updated_at = datetime('now');
    `,
    args: [
      id,
      dedupeKey,
      draft.jenis,
      draft.id_siswa?.trim() || null,
      canonPhone,
      isiPesan,
      status,
    ],
  });

  return { sukses: true, id_notifikasi: id };
}

export async function cancelWaNotification(
  client: Client,
  idNotifikasi: string,
): Promise<{ sukses: boolean }> {
  await client.execute({
    sql: `
      UPDATE notifikasi_wa
      SET status = 'Dibatalkan', updated_at = datetime('now')
      WHERE id_notifikasi = ? AND status = 'Menunggu';
    `,
    args: [idNotifikasi.trim()],
  });

  return { sukses: true };
}

export async function getWaConfig(client: Client): Promise<WaConfig> {
  const result = await client.execute({
    sql: `
      SELECT id, provider, api_key, api_url, sender_number, is_active, daily_limit,
             scan_masuk_enabled, scan_pulang_enabled, bolos_enabled, ambang_alfa_enabled,
      koreksi_admin_enabled, import_manual_enabled,
             created_at, updated_at
      FROM app_wa_config
      WHERE id = 'default'
      LIMIT 1;
    `,
  });

  const row = result.rows[0];
  if (!row) {
    const settingsRes = await client.execute({
      sql: "SELECT key, value FROM setting_gex_system WHERE key IN (?, ?, ?);",
      args: [
        WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY,
        WA_NOTIFY_AMBANG_ALFA_DAYS_KEY,
        WA_AUTO_SEND_KEY,
      ],
    });
    const settingsMap = new Map<string, string>();
    for (const r of settingsRes.rows) {
      settingsMap.set(String(r.key), String(r.value ?? ""));
    }
    const ambangAlfaLimit = parseAmbangAlfaLimit(
      settingsMap.get(WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY),
    );
    const ambangAlfaDays = parseAmbangAlfaDays(
      settingsMap.get(WA_NOTIFY_AMBANG_ALFA_DAYS_KEY),
    );

    return {
      id: "default",
      provider: "fonnte",
      apiKey: "",
      hasApiKey: false,
      apiUrl: null,
      senderNumber: null,
      isActive: false,
      dailyLimit: 1000,
      // Keempatnya MATI, sama dengan yang dibaca `waNotifyEnabled` untuk
      // kunci `wa_notify_*` yang belum ada. Dua yang terakhir dulu bernilai
      // true di sini, sehingga kartu Pengaturan menampilkannya hidup sementara
      // mesinnya tidak pernah mengantre apa pun.
      scanMasukEnabled: false,
      scanPulangEnabled: false,
      bolosEnabled: false,
      ambangAlfaEnabled: false,
      koreksiAdminEnabled: false,
      importManualEnabled: false,
      ambangAlfaLimit,
      ambangAlfaDays,
      autoSendEnabled: settingEnabled(settingsMap.get(WA_AUTO_SEND_KEY)),
      createdAt: "",
      updatedAt: "",
    };
  }

  const rawKey = row.api_key == null ? "" : String(row.api_key).trim();
  const settingsRes = await client.execute({
    sql: "SELECT key, value FROM setting_gex_system WHERE key IN (?, ?, ?);",
    args: [
      WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY,
      WA_NOTIFY_AMBANG_ALFA_DAYS_KEY,
      WA_AUTO_SEND_KEY,
    ],
  });
  const settingsMap = new Map<string, string>();
  for (const r of settingsRes.rows) {
    settingsMap.set(String(r.key), String(r.value ?? ""));
  }
  const ambangAlfaLimit = parseAmbangAlfaLimit(
    settingsMap.get(WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY),
  );
  const ambangAlfaDays = parseAmbangAlfaDays(
    settingsMap.get(WA_NOTIFY_AMBANG_ALFA_DAYS_KEY),
  );

  return {
    id: "default",
    provider:
      (String(row.provider ?? "fonnte") as WaConfigProvider) || "fonnte",
    apiKey: "", // Never expose raw apiKey to client (Rule 11)
    hasApiKey: rawKey.length > 0,
    apiUrl: row.api_url != null ? String(row.api_url) : null,
    senderNumber: row.sender_number != null ? String(row.sender_number) : null,
    isActive: Number(row.is_active ?? 0) === 1,
    dailyLimit: Number(row.daily_limit ?? 1000),
    scanMasukEnabled: Number(row.scan_masuk_enabled ?? 0) === 1,
    scanPulangEnabled: Number(row.scan_pulang_enabled ?? 0) === 1,
    bolosEnabled: Number(row.bolos_enabled ?? 0) === 1,
    ambangAlfaEnabled: Number(row.ambang_alfa_enabled ?? 0) === 1,
    koreksiAdminEnabled: Number(row.koreksi_admin_enabled ?? 0) === 1,
    importManualEnabled: Number(row.import_manual_enabled ?? 0) === 1,
    ambangAlfaLimit,
    ambangAlfaDays,
    autoSendEnabled: settingEnabled(settingsMap.get(WA_AUTO_SEND_KEY)),
    createdAt: row.created_at != null ? String(row.created_at) : "",
    updatedAt: row.updated_at != null ? String(row.updated_at) : "",
  };
}

export async function saveWaConfig(
  client: Client,
  draft: WaConfigDraft,
): Promise<{ sukses: boolean }> {
  const validProviders: WaConfigProvider[] = ["fonnte", "wablas", "custom"];
  if (!validProviders.includes(draft.provider)) {
    throw new Error(
      "Provider WhatsApp tidak valid. Pilih fonnte, wablas, atau custom.",
    );
  }

  // Preserve existing apiKey if not provided in draft (Rule 11)
  let finalApiKey = draft.apiKey.trim();
  if (!finalApiKey) {
    const existing = await client.execute({
      sql: "SELECT api_key FROM app_wa_config WHERE id = 'default' LIMIT 1;",
    });
    finalApiKey = existing.rows[0]?.api_key
      ? String(existing.rows[0].api_key).trim()
      : "";
  }

  const dailyLimit = Math.max(Number(draft.dailyLimit || 1000), 1);

  const konfigurasi = {
    sql: `
      INSERT INTO app_wa_config (
        id, provider, api_key, api_url, sender_number, is_active, daily_limit,
        scan_masuk_enabled, scan_pulang_enabled, bolos_enabled, ambang_alfa_enabled,
        koreksi_admin_enabled, import_manual_enabled,
        created_at, updated_at
      ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        api_key = excluded.api_key,
        api_url = excluded.api_url,
        sender_number = excluded.sender_number,
        is_active = excluded.is_active,
        daily_limit = excluded.daily_limit,
        scan_masuk_enabled = excluded.scan_masuk_enabled,
        scan_pulang_enabled = excluded.scan_pulang_enabled,
        bolos_enabled = excluded.bolos_enabled,
        ambang_alfa_enabled = excluded.ambang_alfa_enabled,
        koreksi_admin_enabled = excluded.koreksi_admin_enabled,
        import_manual_enabled = excluded.import_manual_enabled,
        updated_at = datetime('now');
    `,
    args: [
      draft.provider,
      finalApiKey,
      draft.apiUrl?.trim() || null,
      draft.senderNumber?.trim() || null,
      draft.isActive ? 1 : 0,
      dailyLimit,
      draft.scanMasukEnabled ? 1 : 0,
      draft.scanPulangEnabled ? 1 : 0,
      draft.bolosEnabled ? 1 : 0,
      draft.ambangAlfaEnabled ? 1 : 0,
      draft.koreksiAdminEnabled ? 1 : 0,
      draft.importManualEnabled ? 1 : 0,
    ],
  };

  // Cerminkan keempat sakelar dan parameter ambang batas ke `setting_gex_system`.
  const cerminan: Array<{ sql: string; args: (string | number)[] }> = (
    [
      [WA_NOTIFY_SCAN_MASUK_KEY, draft.scanMasukEnabled ? "true" : "false"],
      [WA_NOTIFY_SCAN_PULANG_KEY, draft.scanPulangEnabled ? "true" : "false"],
      [WA_NOTIFY_BOLOS_KEY, draft.bolosEnabled ? "true" : "false"],
      [WA_NOTIFY_AMBANG_ALFA_KEY, draft.ambangAlfaEnabled ? "true" : "false"],
      [
        WA_NOTIFY_KOREKSI_ADMIN_KEY,
        draft.koreksiAdminEnabled ? "true" : "false",
      ],
      [
        WA_NOTIFY_IMPORT_MANUAL_KEY,
        draft.importManualEnabled ? "true" : "false",
      ],
      [
        WA_NOTIFY_AMBANG_ALFA_LIMIT_KEY,
        String(parseAmbangAlfaLimit(draft.ambangAlfaLimit)),
      ],
      [
        WA_NOTIFY_AMBANG_ALFA_DAYS_KEY,
        String(parseAmbangAlfaDays(draft.ambangAlfaDays)),
      ],
      [WA_AUTO_SEND_KEY, draft.autoSendEnabled ? "true" : "false"],
    ] as const
  ).map(([key, val]) => ({
    sql: `
      INSERT INTO setting_gex_system (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    `,
    args: [key, val],
  }));

  // Satu batch: konfigurasi dan cerminannya wajib berubah bersama. Bila hanya
  // salah satunya tersimpan, terminal dan pengirim akan menganut sakelar yang
  // berbeda tanpa satu pun pesan kesalahan.
  await client.batch([konfigurasi, ...cerminan], "write");

  return { sukses: true };
}

/** Template tersimpan per jenis; string kosong berarti teks bawaan. */
export async function getWaTemplates(client: Client): Promise<WaTemplateMap> {
  const result = await client.execute({
    sql: `SELECT key, value FROM setting_gex_system WHERE key IN (${WA_NOTIFICATION_KINDS.map(() => "?").join(", ")});`,
    args: WA_NOTIFICATION_KINDS.map(waTemplateKey),
  });
  const tersimpan = new Map(
    result.rows.map((row) => [String(row.key), String(row.value ?? "")]),
  );
  return Object.fromEntries(
    WA_NOTIFICATION_KINDS.map((jenis) => [
      jenis,
      tersimpan.get(waTemplateKey(jenis)) ?? "",
    ]),
  ) as WaTemplateMap;
}

/**
 * Simpan keenam template sekaligus — cerminan `save_wa_templates` di Rust.
 * Semuanya divalidasi dulu; satu yang salah membatalkan seluruh penyimpanan.
 */
export async function saveWaTemplates(
  client: Client,
  body: unknown,
): Promise<WaTemplateMap> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiRequestError("Format template tidak valid.", 400);
  }
  const input = body as Record<string, unknown>;
  const asing = Object.keys(input).find((key) => !isWaNotificationKind(key));
  if (asing) {
    throw new ApiRequestError(`Jenis notifikasi tidak dikenal: ${asing}.`, 400);
  }
  const hasil = {} as WaTemplateMap;
  for (const jenis of WA_NOTIFICATION_KINDS) {
    const raw = typeof input[jenis] === "string" ? input[jenis] : "";
    const check = validateWaTemplate(jenis, raw as string);
    if (!check.ok) {
      throw new ApiRequestError(
        `${WA_TEMPLATE_LABELS[jenis]}: ${check.pesan}`,
        400,
      );
    }
    hasil[jenis] = check.value;
  }
  await client.batch(
    WA_NOTIFICATION_KINDS.map((jenis) => ({
      sql: `
        INSERT INTO setting_gex_system (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value;
      `,
      args: [waTemplateKey(jenis), hasil[jenis]],
    })),
    "write",
  );
  return hasil;
}
