import "server-only";

import type { Client } from "@libsql/client";
import {
  ensureServerDatabaseInitialized,
  getServerDatabase,
} from "@/lib/server/db";

/**
 * Facade untuk service domain lama. Semua pemanggil memakai singleton dan
 * aturan konfigurasi database server yang sama dengan Route Handler.
 *
 * Koneksinya dibuat pada AKSES PERTAMA, bukan saat modul ini di-import.
 *
 * Sebelumnya baris ini berbunyi `export const db = getServerDatabase()`, yang
 * menyelesaikan konfigurasi database begitu modul dimuat. Akibatnya build
 * Desktop dan Mobile GAGAL TOTAL: `next build` mengumpulkan page data untuk
 * setiap `src/app/api/**` route, setiap route mengimpor service, setiap service
 * mengimpor modul ini — dan `resolveServerDatabaseConfig` melempar
 * "TURSO_DATABASE_URL wajib tersedia" karena `NODE_ENV=production` sementara
 * mesin yang membangun tidak punya kredensial cloud.
 *
 * Route API itu sendiri tidak pernah ikut ke static export — Desktop dan Mobile
 * bicara ke Rust lewat IPC. Yang menjatuhkan build hanyalah efek samping saat
 * modulnya dievaluasi.
 *
 * Dengan proxy ini konfigurasi diselesaikan saat PERMINTAAN dilayani, tempat
 * kegagalannya memang seharusnya muncul: sebagai error yang bisa dijawab,
 * bukan sebagai build yang tidak bisa selesai.
 */
export const db: Client = new Proxy({} as Client, {
  get(_target, property, receiver) {
    // `await db` atau `Promise.resolve(db)` akan menyentuh `then`. Menjawabnya
    // tanpa menyentuh `getServerDatabase()` mencegah koneksi lahir hanya karena
    // sebuah nilai kebetulan melewati rantai promise.
    if (property === "then") return undefined;

    const client = getServerDatabase();
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, property) {
    return Reflect.has(getServerDatabase(), property);
  },
});

export const ensureDbInitialized = ensureServerDatabaseInitialized;
