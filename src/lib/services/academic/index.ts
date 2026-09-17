/**
 * Barel modul akademik.
 *
 * `@/lib/services/academic` dulu satu berkas 1.434 baris berisi sepuluh
 * entitas. Isinya kini terbagi per tanggung jawab, tetapi jalur impor publiknya
 * sengaja dipertahankan persis: 22 route handler mengimpor dari sini.
 */
export * from "./personnel";
export * from "./schedule";
export * from "./structure";
