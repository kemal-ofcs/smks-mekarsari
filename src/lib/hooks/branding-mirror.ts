"use client";

/**
 * Cermin lokal satu nilai branding, supaya UI punya sesuatu untuk digambar
 * pada milidetik pertama — sebelum database sempat dibaca.
 *
 * SUMBER KEBENARAN selalu database (`company_profile` atau `setting_gex_system`
 * yang ikut snapshot sinkronisasi). `localStorage` di sini HANYA cermin
 * tampilan: ia tidak pernah menang atas nilai yang baru dibaca, dan kegagalan
 * menulisnya (kuota penuh, mode privat) tidak boleh menggagalkan apa pun.
 *
 * Tiga hook memakai pabrik ini — logo, nama aplikasi, nama perusahaan. Dulu
 * ketiganya menyalin mesin yang sama: `emit`, `readCache`, `writeCache`,
 * `setSnapshot`, `handleStorage`, `handleLocalChange`, plus penjaga
 * `refreshInFlight`. Perbaikan pada salah satunya — misalnya menutup kebocoran
 * listener — hanya mendarat di satu dari tiga tempat.
 *
 * Setiap pemanggil memegang state-nya sendiri lewat closure, jadi satu nilai
 * yang berubah tidak pernah membangunkan pelanggan nilai lain.
 */
export interface BrandingMirrorSpec<T> {
  /** Kunci `localStorage`. Tidak pernah ikut sinkronisasi. */
  cacheKey: string;
  /** Nama event `window` untuk perubahan dari tab/komponen yang sama. */
  changeEvent: string;
  /** Nilai saat cache kosong, gagal dibaca, atau saat render di server. */
  fallback: T;
  /** Bentuk isi cache menjadi nilai. */
  decode: (raw: string | null) => T;
  /** Bentuk nilai menjadi isi cache; `null` berarti hapus entri cache. */
  encode: (value: T) => string | null;
  /** Rapikan nilai sebelum dibandingkan dan disimpan di snapshot. */
  normalize: (value: T) => T;
  /** Baca ulang nilai dari database. Kegagalan sengaja diabaikan. */
  fetchRemote: () => Promise<T>;
  /** Event yang menandai satu siklus sinkronisasi selesai. */
  syncCompletedEvent: string;
}

export interface BrandingMirror<T> {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  /** Perbarui cermin setelah nilainya berhasil disimpan ke database. */
  sync: (value: T) => void;
}

export function createBrandingMirror<T>(
  spec: BrandingMirrorSpec<T>,
): BrandingMirror<T> {
  const listeners = new Set<() => void>();

  let snapshot: T = spec.fallback;
  let snapshotLoaded = false;
  let refreshInFlight = false;

  function emit() {
    for (const listener of listeners) listener();
  }

  function readCache(): T {
    try {
      return spec.decode(localStorage.getItem(spec.cacheKey));
    } catch {
      return spec.fallback;
    }
  }

  function writeCache(value: T) {
    try {
      const encoded = spec.encode(value);
      if (encoded) localStorage.setItem(spec.cacheKey, encoded);
      else localStorage.removeItem(spec.cacheKey);
    } catch {
      // Kuota penyimpanan penuh. Cache boleh gagal — database tetap sumber kebenaran.
    }
  }

  function setSnapshot(value: T) {
    snapshotLoaded = true;
    const next = spec.normalize(value);
    if (snapshot === next) return;
    snapshot = next;
    emit();
  }

  function refreshFromRemote() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    spec
      .fetchRemote()
      .then((value) => {
        writeCache(value);
        setSnapshot(value);
      })
      .catch(() => {
        // Offline atau data belum siap: biarkan cermin lokal yang tampil.
      })
      .finally(() => {
        refreshInFlight = false;
      });
  }

  function subscribe(onStoreChange: () => void) {
    listeners.add(onStoreChange);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === spec.cacheKey) {
        setSnapshot(readCache());
      }
    };
    const handleLocalChange = () => setSnapshot(readCache());

    window.addEventListener("storage", handleStorage);
    window.addEventListener(spec.changeEvent, handleLocalChange);
    // Snapshot sync bisa membawa nilai baru dari perangkat lain.
    window.addEventListener(spec.syncCompletedEvent, refreshFromRemote);

    refreshFromRemote();

    return () => {
      listeners.delete(onStoreChange);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(spec.changeEvent, handleLocalChange);
      window.removeEventListener(spec.syncCompletedEvent, refreshFromRemote);
    };
  }

  function getSnapshot(): T {
    if (!snapshotLoaded) {
      snapshot = readCache();
      snapshotLoaded = true;
    }
    return snapshot;
  }

  return {
    subscribe,
    getSnapshot,
    getServerSnapshot: () => spec.fallback,
    sync(value: T) {
      writeCache(value);
      setSnapshot(value);
      window.dispatchEvent(new Event(spec.changeEvent));
    },
  };
}
