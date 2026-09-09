"use client";

import { redirect } from "next/navigation";
import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { DatabaseBackupCard } from "@/components/DatabaseBackupCard";
import { MailSettingsCard } from "@/components/MailSettingsCard";
import { PasswordRecoveryCard } from "@/components/PasswordRecoveryCard";
import { GeofencingCard } from "@/components/settings/GeofencingCard";
import { KeamananAbsensiCard } from "@/components/settings/KeamananAbsensiCard";
import { KeamananPemindaiCard } from "@/components/settings/KeamananPemindaiCard";
import { KonfigurasiDatabaseCard } from "@/components/settings/KonfigurasiDatabaseCard";
import { LogoAplikasiCard } from "@/components/settings/LogoAplikasiCard";
import { OtomasiAlfaCard } from "@/components/settings/OtomasiAlfaCard";
import { ProfilInstansiCard } from "@/components/settings/ProfilInstansiCard";
import { SinkronisasiDesktopCard } from "@/components/settings/SinkronisasiDesktopCard";
import { TemaVisualCard } from "@/components/settings/TemaVisualCard";
import { TwoFactorCard } from "@/components/TwoFactorCard";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { getCurrentCoordinates } from "@/lib/client/geolocation";
import { formatBytes, optimizeImageFile } from "@/lib/client/image-optimizer";
import { BRANDING } from "@/lib/constants/branding";
import { useAuth } from "@/lib/context/AuthContext";
import {
  getAutoAlfaSetting,
  type RingkasanAlfa,
  saveAutoAlfaSetting,
  triggerGenerateAlfa,
} from "@/lib/gateways/alfa";
import {
  getAppDisplayName,
  saveAppDisplayName,
} from "@/lib/gateways/app-setting";
import {
  type CompanyProfile,
  getCompanyProfile,
  updateCompanyProfile,
} from "@/lib/gateways/company-profile";
import {
  type GeofenceSettings,
  getGeofenceSettings,
  saveGeofenceSettings,
} from "@/lib/gateways/geofence";
import {
  getScanSecurity,
  saveScanSecurity,
} from "@/lib/gateways/scan-security";
import {
  getScannerSafetySettings,
  type ScannerSafetySettings,
  saveScannerSafetySettings,
} from "@/lib/gateways/scanner-settings";
import {
  clearFailedSync,
  forceResyncSettings,
  getSyncConflicts,
  getSyncStatus,
  isDesktopSyncAvailable,
  resolveSyncConflicts,
  resolveSyncConflictsLocal,
  retryFailedSync,
  SYNC_COMPLETED_EVENT,
  SYNC_FAILED_EVENT,
  type SyncConflict,
  type SyncStatus,
  syncNow,
} from "@/lib/gateways/sync-status";
import {
  clearTursoConfig,
  getDatabaseConfig,
  saveTursoConfig,
  type TursoConnectionStatus,
  testTursoConnection,
} from "@/lib/gateways/turso-config";
import { syncAppLogoCache, useAppLogo } from "@/lib/hooks/useAppLogo";
import { syncAppNameCache } from "@/lib/hooks/useAppName";
import { syncCompanyNameCache } from "@/lib/hooks/useCompanyName";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { useOnlineStatus } from "@/lib/hooks/useOnlineStatus";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import {
  type DatabaseProvider,
  describeProvider,
  providerNeedsEndpoint,
  reviewDatabaseEndpoint,
} from "@/lib/validations/database-endpoint";
import { validateGeofenceSettings } from "@/lib/validations/geofence";
import { validateIpAllowlistEntries } from "@/lib/validations/ip-allowlist";
import { validateScannerSafetySettings } from "@/lib/validations/scanner-settings";

const MAX_LOGO_SIZE = 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const _SYNC_TABLE_LABELS = [
  ["employees", "Karyawan"],
  ["idCards", "ID Card"],
  ["shifts", "Shift"],
  ["holidays", "Hari Libur"],
  ["settings", "Pengaturan"],
  ["companyProfiles", "Profil Instansi"],
  ["idCardTemplates", "Template ID Card"],
  ["backups", "Penugasan backup"],
  ["corrections", "Koreksi"],
  ["imports", "Import offline"],
  ["attendance", "Absensi harian"],
  ["scanLogs", "Riwayat scan"],
  ["payrollRuns", "Batch Payroll"],
  ["payrollItems", "Slip Gaji"],
  ["salaryConfigs", "Rate Gaji"],
] as const;

function _formatSyncTime(timestamp: number | null | undefined) {
  if (!timestamp) return "Belum pernah berhasil";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(timestamp * 1000));
}

interface FeedbackMessage {
  message: string;
  type: "success" | "error";
}

export default function SettingsPage() {
  // Penjaga anti klik ganda (Aturan 5). `useState` tidak cukup: pembaruannya
  // dijadwalkan, sehingga dua klik dalam satu tick React sama-sama membaca
  // nilai lama dan keduanya lolos. Dideklarasikan di ATAS, sebelum setiap
  // early return, supaya urutan hook tidak pernah berubah antar-render.
  const isSubmittingRef = useRef(false);

  const isHydrated = useHydrated();
  const isOnline = useOnlineStatus();
  const logoUrl = useAppLogo();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [syncBusy, setSyncBusy] = useState(false);
  const [autoSyncError, setAutoSyncError] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [tursoUrl, setTursoUrl] = useState<string>("");
  const [tursoProvider, setTursoProvider] = useState<DatabaseProvider>("turso");
  const [tursoAllowInsecure, setTursoAllowInsecure] = useState<boolean>(false);
  const [tursoTokenSaved, setTursoTokenSaved] = useState<boolean>(false);
  const [tursoToken, setTursoToken] = useState<string>("");
  const [showTursoToken, setShowTursoToken] = useState<boolean>(false);
  const [tursoTestStatus, setTursoTestStatus] =
    useState<TursoConnectionStatus | null>(null);
  const [tursoBusy, setTursoBusy] = useState<boolean>(false);
  const [tursoTesting, setTursoTesting] = useState<boolean>(false);
  const [geofence, setGeofence] = useState<GeofenceSettings>({
    enabled: false,
    latitude: 0,
    longitude: 0,
    radiusMeter: 100,
  });
  const [geofenceBusy, setGeofenceBusy] = useState(false);
  // Daftar IP absensi. Disimpan sebagai teks per baris di form supaya
  // Superadmin bisa menempel banyak alamat sekaligus; normalisasi dan
  // pembuangan entri tidak valid dilakukan saat disimpan.
  const [ipAllowlist, setIpAllowlist] = useState<string[]>([]);
  const [ipAllowlistDraft, setIpAllowlistDraft] = useState("");
  const [ipDeviceAddresses, setIpDeviceAddresses] = useState<string[]>([]);
  const [ipAllowlistBusy, setIpAllowlistBusy] = useState(false);
  // Sakelar induk tingkat perusahaan. Sakelar per role di Master Operator hanya
  // berlaku ketika fiturnya dihidupkan di sini.
  const [scanPhotoEnabled, setScanPhotoEnabled] = useState(false);
  const [scanIpEnabled, setScanIpEnabled] = useState(false);
  const [currentDeviceCoords, setCurrentDeviceCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [scannerSafety, setScannerSafety] = useState<ScannerSafetySettings>({
    antiDoubleScanSeconds: 60,
    batasMultiScanMenit: 5,
  });
  const [scannerSafetyBusy, setScannerSafetyBusy] = useState(false);
  const [autoAlfaEnabled, setAutoAlfaEnabled] = useState(true);
  const [autoAlfaBusy, setAutoAlfaBusy] = useState(false);
  const [alfaTriggerBusy, setAlfaTriggerBusy] = useState(false);
  const [alfaModalResult, setAlfaModalResult] = useState<RingkasanAlfa | null>(
    null,
  );
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>({
    id: "default_company",
    company_name: BRANDING.defaultCompanyName,
    branch_name: BRANDING.defaultBranchName,
    logo_url: null,
    signature_url: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    leader_name: null,
    leader_title: null,
    leader_nip: null,
    card_terms: null,
    timezone: "Asia/Jakarta",
    updated_at: "",
  });
  const [appDisplayName, setAppDisplayName] = useState<string>(
    BRANDING.appDisplayName,
  );
  const [companyProfileBusy, setCompanyProfileBusy] = useState(false);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    let cancelled = false;

    getCompanyProfile()
      .then((profile) => {
        if (!cancelled) setCompanyProfile(profile);
      })
      .catch(() => undefined);

    getAppDisplayName()
      .then((name) => {
        if (!cancelled) setAppDisplayName(name);
      })
      .catch(() => undefined);

    if (isDesktopSyncAvailable()) {
      getSyncStatus()
        .then((status) => {
          if (!cancelled) setSyncStatus(status);
        })
        .catch(() => undefined);
    }

    getAutoAlfaSetting()
      .then((enabled) => {
        if (!cancelled) setAutoAlfaEnabled(enabled);
      })
      .catch(() => undefined);

    if (user?.isSuperadmin) {
      // Provider ikut dimuat: tanpa itu perangkat yang terhubung ke server LAN
      // selalu menampilkan ulang formulir dalam mode Turso, dan penyimpanan
      // berikutnya akan menolak alamat LAN-nya sendiri.
      getDatabaseConfig()
        .then((config) => {
          if (cancelled || !config.configured) return;
          setTursoUrl(config.databaseUrl);
          setTursoProvider(config.provider);
          setTursoAllowInsecure(config.allowInsecureTransport);
          setTursoTokenSaved(config.authTokenSaved);
        })
        .catch(() => undefined);
    }

    setGeofenceBusy(true);
    setScannerSafetyBusy(true);
    setIpAllowlistBusy(true);
    getGeofenceSettings()
      .then((settings) => {
        if (!cancelled) setGeofence(settings);
      })
      .catch((error) => {
        if (!cancelled) {
          setFeedback({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Pengaturan geofencing tidak dapat dibaca.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setGeofenceBusy(false);
      });

    getScannerSafetySettings()
      .then((settings) => {
        if (!cancelled) setScannerSafety(settings);
      })
      .catch((error) => {
        if (!cancelled) {
          setFeedback({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Pengaturan keamanan scanner tidak dapat dibaca.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setScannerSafetyBusy(false);
      });

    // Hanya Superadmin yang boleh membaca daftar ini (sama seperti geofencing),
    // jadi jangan memicu pesan "akses ditolak" untuk operator biasa.
    if (!user?.isSuperadmin) {
      setIpAllowlistBusy(false);
      return () => {
        cancelled = true;
      };
    }

    getScanSecurity()
      .then((settings) => {
        if (cancelled) return;
        setScanPhotoEnabled(settings.photoEnabled);
        setScanIpEnabled(settings.ipRestrictionEnabled);
        setIpAllowlist(settings.entries);
        setIpAllowlistDraft(settings.entries.join("\n"));
        setIpDeviceAddresses(settings.deviceAddresses);
      })
      .catch((error) => {
        if (!cancelled) {
          setFeedback({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Pengaturan keamanan absensi tidak dapat dibaca.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setIpAllowlistBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isHydrated, user?.isSuperadmin]);

  // Dengarkan event auto-sync selesai untuk memperbarui status Cloud Sync secara real-time
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    const onSyncCompleted = (event: Event) => {
      const detail = (event as CustomEvent<SyncStatus>).detail;
      if (detail && !detail.pushError) setAutoSyncError(null);
      if (isDesktopSyncAvailable()) {
        getSyncStatus()
          .then((status) => setSyncStatus(status))
          .catch(() => undefined);
        getSyncConflicts()
          .then((items) => setConflicts(items))
          .catch(() => undefined);
      }
    };
    // Kegagalan auto-sync dulu ditelan diam-diam sehingga tidak ada cara tahu
    // sync sedang mati. Sekarang alasannya ditampilkan di panel Cloud Sync.
    const onSyncFailed = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setAutoSyncError(detail?.message ?? "Sinkronisasi otomatis gagal.");
    };
    window.addEventListener(SYNC_COMPLETED_EVENT, onSyncCompleted);
    window.addEventListener(SYNC_FAILED_EVENT, onSyncFailed);
    return () => {
      window.removeEventListener(SYNC_COMPLETED_EVENT, onSyncCompleted);
      window.removeEventListener(SYNC_FAILED_EVENT, onSyncFailed);
    };
  }, [isHydrated, isAuthenticated]);

  const handleAutoAlfaToggle = async (enabled: boolean) => {
    if (isSubmittingRef.current) return;
    setAutoAlfaBusy(true);
    isSubmittingRef.current = true;
    try {
      await saveAutoAlfaSetting(enabled);
      setAutoAlfaEnabled(enabled);
      setFeedback({
        type: "success",
        message: `Pengaturan Auto Alfa berhasil diubah menjadi ${enabled ? "Aktif" : "Nonaktif"}.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Gagal menyimpan pengaturan Auto Alfa.",
      });
    } finally {
      isSubmittingRef.current = false;
      setAutoAlfaBusy(false);
    }
  };

  const handleTriggerAlfaNow = async () => {
    setAlfaTriggerBusy(true);
    try {
      const result = await triggerGenerateAlfa();
      setAlfaModalResult(result);
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Gagal menjalankan Generate Alfa manual.",
      });
    } finally {
      setAlfaTriggerBusy(false);
    }
  };

  const refreshSync = async (synchronize = false) => {
    setSyncBusy(true);
    try {
      const status = synchronize ? await syncNow() : await getSyncStatus();
      const conflictItems = await getSyncConflicts();
      setSyncStatus(status);
      setConflicts(conflictItems);
      if (synchronize)
        setFeedback({
          type: "success",
          message:
            "Sinkronisasi berhasil: event lokal terkirim dan snapshot server diterapkan ke database Desktop.",
        });
    } catch (error) {
      try {
        const [currentStatus, currentConflicts] = await Promise.all([
          getSyncStatus(),
          getSyncConflicts(),
        ]);
        setSyncStatus(currentStatus);
        setConflicts(currentConflicts);
      } catch {
        // Pesan utama tetap berasal dari kegagalan sinkronisasi.
      }
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Status sinkronisasi tidak dapat dibaca.",
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const retryFailed = async () => {
    setSyncBusy(true);
    try {
      const status = await retryFailedSync();
      setSyncStatus(status);
      setConflicts(await getSyncConflicts());
      setFeedback({
        type: "success",
        message: "Antrean gagal sudah dicoba ulang.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error ? error.message : "Retry sinkronisasi gagal.",
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const resolveConflicts = async (eventId?: string) => {
    setSyncBusy(true);
    try {
      const status = await resolveSyncConflicts(eventId);
      setSyncStatus(status);
      setConflicts(await getSyncConflicts());
      setFeedback({
        type: "success",
        message: eventId
          ? "Konflik berhasil diselesaikan (mengikuti master cloud)."
          : "Semua konflik berhasil diselesaikan (mengikuti master cloud).",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Gagal menyelesaikan konflik sinkronisasi.",
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const resolveConflictsLocal = async (eventId?: string) => {
    setSyncBusy(true);
    try {
      const status = await resolveSyncConflictsLocal(eventId);
      setSyncStatus(status);
      setConflicts(await getSyncConflicts());
      setFeedback({
        type: "success",
        message: eventId
          ? "Data lokal berhasil diprioritaskan dan dikirim ke cloud."
          : "Semua data lokal berhasil diprioritaskan dan dikirim ke cloud.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Gagal memprioritaskan data lokal ke cloud.",
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const clearFailed = async () => {
    setSyncBusy(true);
    try {
      const status = await clearFailedSync();
      setSyncStatus(status);
      setConflicts(await getSyncConflicts());
      setFeedback({
        type: "success",
        message: "Antrean gagal berhasil dibersihkan.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Gagal membersihkan antrean gagal.",
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const resyncSettings = async () => {
    setSyncBusy(true);
    try {
      const result = await forceResyncSettings();
      if (result) {
        setSyncStatus(result.status);
        setConflicts(await getSyncConflicts());
        setFeedback({
          type: "success",
          message: `${result.enqueue.pesan} Sinkronisasi ke server berhasil.`,
        });
      }
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Gagal menyinkronkan ulang pengaturan ke server.",
      });
    } finally {
      setSyncBusy(false);
    }
  };

  // Cermin sisi klien dari `normalize_database_url` di Rust. Backend tetap
  // penjaga sebenarnya; ini hanya supaya formulir bisa menjelaskan lebih awal.
  const tursoEndpoint = reviewDatabaseEndpoint(
    tursoUrl,
    tursoProvider,
    tursoAllowInsecure,
  );
  const tursoProviderInfo = describeProvider(tursoProvider);

  const handleTursoSave = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    // Tahan input yang jelas salah di sini supaya pengguna melihat alasannya di
    // sebelah field, bukan sebagai kegagalan IPC generik setelah penyimpanan.
    // Mode Database Lokal tidak punya alamat maupun token, dan validator
    // endpoint memang MENOLAKNYA secara sengaja — kalau ia diloloskan, alamat
    // remote yang dipasangkan dengan mode lokal akan melewati seluruh aturan
    // transport. Karena itu kedua pemeriksaan di bawah hanya berlaku untuk
    // provider yang benar-benar memakai endpoint.
    const needsEndpoint = providerNeedsEndpoint(tursoProvider);
    if (needsEndpoint && !tursoEndpoint.valid) {
      setFeedback({
        type: "error",
        message:
          tursoEndpoint.issue?.message ?? "URL database tidak dapat dipakai.",
      });
      return;
    }
    if (
      needsEndpoint &&
      tursoEndpoint.tokenRequired &&
      !tursoToken.trim() &&
      !tursoTokenSaved
    ) {
      setFeedback({
        type: "error",
        message: "Auth Token wajib diisi untuk alamat database ini.",
      });
      return;
    }
    setTursoBusy(true);
    isSubmittingRef.current = true;
    try {
      await saveTursoConfig(
        needsEndpoint ? tursoUrl.trim() : "",
        needsEndpoint ? tursoToken.trim() : "",
        {
          provider: tursoProvider,
          allowInsecureTransport: tursoAllowInsecure,
        },
      );
      setTursoTokenSaved(tursoToken.trim().length > 0 ? true : tursoTokenSaved);
      setFeedback({
        type: "success",
        message: `Konfigurasi ${describeProvider(tursoProvider).label} berhasil disimpan ke vault terenkripsi!`,
      });
      const status = await testTursoConnection(
        tursoUrl.trim(),
        tursoToken.trim(),
        {
          provider: tursoProvider,
          allowInsecureTransport: tursoAllowInsecure,
        },
      );
      setTursoTestStatus(status);
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Gagal menyimpan konfigurasi database cloud Turso.",
      });
    } finally {
      isSubmittingRef.current = false;
      setTursoBusy(false);
    }
  };

  const handleTursoTest = async () => {
    setTursoTesting(true);
    try {
      const status = await testTursoConnection(
        tursoUrl.trim() || undefined,
        tursoToken.trim() || undefined,
        {
          provider: tursoProvider,
          allowInsecureTransport: tursoAllowInsecure,
        },
      );
      setTursoTestStatus(status);
      if (status.connected) {
        setFeedback({
          type: "success",
          message: `Koneksi ke database berhasil! Latensi: ${status.latency_ms ?? 0} ms`,
        });
      } else {
        setFeedback({
          type: "error",
          message: `Koneksi database gagal: ${status.error_message ?? "Tidak dapat terhubung"}`,
        });
      }
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Gagal menguji koneksi ke database cloud.",
      });
    } finally {
      setTursoTesting(false);
    }
  };

  const handleTursoClear = async () => {
    if (
      !confirm(
        "Apakah Anda yakin ingin menghapus konfigurasi database cloud Turso dari perangkat ini?",
      )
    ) {
      return;
    }
    setTursoBusy(true);
    try {
      await clearTursoConfig();
      setTursoUrl("");
      setTursoToken("");
      setTursoProvider("turso");
      setTursoAllowInsecure(false);
      setTursoTokenSaved(false);
      setTursoTestStatus(null);
      setFeedback({
        type: "success",
        message: "Konfigurasi database cloud Turso berhasil direset.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Gagal mereset konfigurasi database cloud.",
      });
    } finally {
      setTursoBusy(false);
    }
  };

  const handleLogoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    if (isSubmittingRef.current) return;
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setFeedback({
        type: "error",
        message: "Gunakan gambar PNG, JPG, atau WebP.",
      });
      event.target.value = "";
      return;
    }

    if (file.size > MAX_LOGO_SIZE) {
      setFeedback({
        type: "error",
        message: "Ukuran logo maksimal 1 MB agar aplikasi tetap ringan.",
      });
      event.target.value = "";
      return;
    }

    // Logo disimpan ke `company_profile.logo_url` supaya ikut outbox dan
    // tersebar ke cloud, Desktop lain, dan Mobile. Sebelumnya logo hanya
    // ditulis ke localStorage perangkat ini sehingga tidak pernah tersinkron.
    setLogoBusy(true);
    isSubmittingRef.current = true;
    try {
      const optimized = await optimizeImageFile(file, {
        maxWidth: 600,
        maxHeight: 600,
        quality: 0.92,
        mimeType: "image/png",
        fit: "contain",
      });
      const updated = await updateCompanyProfile({
        ...companyProfile,
        logo_url: optimized.dataUrl,
      });
      setCompanyProfile(updated);
      syncAppLogoCache(updated.logo_url);
      setFeedback({
        type: "success",
        message: `Logo tersimpan di profil instansi (${formatBytes(optimized.originalSizeBytes)} ➔ ${formatBytes(optimized.optimizedSizeBytes)}) dan akan tersinkron ke perangkat lain.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Logo tidak dapat disimpan. Silakan coba file lain.",
      });
    } finally {
      isSubmittingRef.current = false;
      setLogoBusy(false);
      event.target.value = "";
    }
  };

  const handleResetLogo = async () => {
    if (isSubmittingRef.current) return;
    setLogoBusy(true);
    isSubmittingRef.current = true;
    try {
      const updated = await updateCompanyProfile({
        ...companyProfile,
        logo_url: null,
      });
      setCompanyProfile(updated);
      syncAppLogoCache(updated.logo_url);
      setFeedback({
        type: "success",
        message:
          "Logo dikembalikan ke identitas default untuk semua perangkat.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Gagal mengembalikan logo ke default.",
      });
    } finally {
      isSubmittingRef.current = false;
      setLogoBusy(false);
    }
  };

  const handleCompanyProfileSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!companyProfile.company_name.trim()) {
      setFeedback({
        type: "error",
        message: "Nama instansi tidak boleh kosong.",
      });
      return;
    }
    setCompanyProfileBusy(true);
    try {
      const [updated, updatedAppName] = await Promise.all([
        updateCompanyProfile(companyProfile),
        saveAppDisplayName(appDisplayName),
      ]);
      setCompanyProfile(updated);
      setAppDisplayName(updatedAppName);
      syncAppLogoCache(updated.logo_url);
      syncCompanyNameCache(updated.company_name);
      syncAppNameCache(updatedAppName);
      setFeedback({
        type: "success",
        message: "Profil instansi & identitas ID Card berhasil disimpan.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Gagal menyimpan profil instansi.",
      });
    } finally {
      setCompanyProfileBusy(false);
    }
  };

  const handleCompanyLogoUpload = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setFeedback({
        type: "error",
        message: "Gunakan format PNG, JPG, atau WebP.",
      });
      event.target.value = "";
      return;
    }
    try {
      const optimized = await optimizeImageFile(file, {
        maxWidth: 600,
        maxHeight: 600,
        quality: 0.92,
        mimeType: "image/png",
        fit: "contain",
      });
      setCompanyProfile((prev) => ({
        ...prev,
        logo_url: optimized.dataUrl,
      }));
      setFeedback({
        type: "success",
        message: `Logo instansi berhasil dioptimasi (${formatBytes(optimized.originalSizeBytes)} ➔ ${formatBytes(optimized.optimizedSizeBytes)}).`,
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Gagal memproses file logo.",
      });
    } finally {
      event.target.value = "";
    }
  };

  const handleSignatureUpload = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setFeedback({
        type: "error",
        message: "Gunakan format PNG transparan atau JPG.",
      });
      event.target.value = "";
      return;
    }
    try {
      const optimized = await optimizeImageFile(file, {
        maxWidth: 600,
        maxHeight: 400,
        quality: 0.92,
        mimeType: "image/png",
        fit: "contain",
      });
      setCompanyProfile((prev) => ({
        ...prev,
        signature_url: optimized.dataUrl,
      }));
      setFeedback({
        type: "success",
        message: `Tanda tangan berhasil dioptimasi (${formatBytes(optimized.originalSizeBytes)} ➔ ${formatBytes(optimized.optimizedSizeBytes)}).`,
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Gagal memproses file tanda tangan.",
      });
    } finally {
      event.target.value = "";
    }
  };

  const useCurrentLocation = async () => {
    setGeofenceBusy(true);
    const coordinates = await getCurrentCoordinates();
    setGeofenceBusy(false);
    if (!coordinates) {
      const isDesktop =
        typeof window !== "undefined" &&
        (window.navigator.userAgent.includes("Tauri") ||
          !window.navigator.onLine ||
          window.location.protocol === "tauri:");
      setFeedback({
        type: "error",
        message: isDesktop
          ? "Lokasi tidak dapat dideteksi. Di Desktop/Windows, pastikan izin 'Lokasi' untuk aplikasi ini sudah diaktifkan di Pengaturan Windows → Privasi & keamanan → Lokasi, lalu coba lagi."
          : "Lokasi tidak dapat dideteksi. Pastikan Anda mengizinkan akses lokasi di browser (klik ikon kunci / info di bilah alamat), lalu coba lagi. Jika menggunakan VPN atau firewall, nonaktifkan sementara.",
      });
      return;
    }
    setCurrentDeviceCoords({
      lat: coordinates.lat,
      lng: coordinates.lng,
    });
    setGeofence((current) => ({
      ...current,
      latitude: Number(coordinates.lat.toFixed(7)),
      longitude: Number(coordinates.lng.toFixed(7)),
    }));
    setFeedback({
      type: "success",
      message: "Koordinat perangkat berhasil dimasukkan ke form.",
    });
  };

  const handleScanSecuritySubmit = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    if (isSubmittingRef.current) return;
    event.preventDefault();
    const entries = ipAllowlistDraft
      .split(/[\n,;]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const validationMessage = Object.values(
      validateIpAllowlistEntries(entries),
    )[0];
    if (validationMessage) {
      setFeedback({ type: "error", message: validationMessage });
      return;
    }
    setIpAllowlistBusy(true);
    isSubmittingRef.current = true;
    try {
      const saved = await saveScanSecurity({
        photoEnabled: scanPhotoEnabled,
        ipRestrictionEnabled: scanIpEnabled,
        entries,
      });
      setScanPhotoEnabled(saved.photoEnabled);
      setScanIpEnabled(saved.ipRestrictionEnabled);
      setIpAllowlist(saved.entries);
      setIpAllowlistDraft(saved.entries.join("\n"));
      setIpDeviceAddresses(saved.deviceAddresses);
      setFeedback({
        type: "success",
        message:
          !saved.photoEnabled && !saved.ipRestrictionEnabled
            ? "Kedua fitur keamanan absensi dimatikan. Absensi berjalan seperti biasa."
            : saved.ipRestrictionEnabled && saved.entries.length === 0
              ? "Tersimpan. Pembatasan IP aktif tetapi daftarnya masih kosong, jadi belum ada yang dibatasi."
              : "Pengaturan keamanan absensi tersimpan.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Pengaturan keamanan absensi gagal disimpan.",
      });
    } finally {
      isSubmittingRef.current = false;
      setIpAllowlistBusy(false);
    }
  };

  const handleGeofenceSubmit = async (event: FormEvent<HTMLFormElement>) => {
    if (isSubmittingRef.current) return;
    event.preventDefault();
    const validationMessage = Object.values(
      validateGeofenceSettings(geofence),
    )[0];
    if (validationMessage) {
      setFeedback({ type: "error", message: validationMessage });
      return;
    }
    setGeofenceBusy(true);
    isSubmittingRef.current = true;
    try {
      setGeofence(await saveGeofenceSettings(geofence));
      setFeedback({
        type: "success",
        message: geofence.enabled
          ? "Geofencing aktif. Scan kini wajib berada di dalam radius kantor."
          : "Geofencing dinonaktifkan.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Pengaturan geofencing gagal disimpan.",
      });
    } finally {
      isSubmittingRef.current = false;
      setGeofenceBusy(false);
    }
  };

  const handleScannerSafetySubmit = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    if (isSubmittingRef.current) return;
    event.preventDefault();
    const validationMessage = Object.values(
      validateScannerSafetySettings(scannerSafety),
    )[0];
    if (validationMessage) {
      setFeedback({ type: "error", message: validationMessage });
      return;
    }
    setScannerSafetyBusy(true);
    isSubmittingRef.current = true;
    try {
      setScannerSafety(await saveScannerSafetySettings(scannerSafety));
      setFeedback({
        type: "success",
        message:
          "Pengaturan keamanan scanner dan multi-scan berhasil disimpan.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Pengaturan keamanan scanner gagal disimpan.",
      });
    } finally {
      isSubmittingRef.current = false;
      setScannerSafetyBusy(false);
    }
  };

  if (!isHydrated || authLoading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-950 p-6 text-slate-100">
        <output className="flex flex-col items-center gap-3">
          <div className="size-10 animate-spin rounded-full border-4 border-sky-400 border-t-transparent" />
          <p className="text-xs font-medium text-slate-400">
            Memuat pengaturan aplikasi...
          </p>
        </output>
      </div>
    );
  }

  if (!isAuthenticated) redirect("/login");
  if (!canAccessArea(user, "settings")) redirect("/forbidden");

  return (
    <AppShell contentClassName="mx-auto w-full max-w-6xl gap-7 px-4 py-6 sm:px-6 lg:px-8 lg:py-9">
      <PageHeader
        eyebrow="Identitas & preferensi aplikasi"
        title="Pengaturan aplikasi"
        description="Kelola identitas visual dan lihat status runtime. Pengaturan operasional lain akan ditambahkan bertahap tanpa mengubah fondasi data yang ada."
        actions={
          <StatusBadge tone={isOnline ? "info" : "warning"}>
            <Icon name={isOnline ? "wifi" : "wifi-off"} className="size-3.5" />
            {isOnline ? "Jaringan tersedia" : "Bekerja offline"}
          </StatusBadge>
        }
      />

      {feedback ? (
        <div
          role={feedback.type === "error" ? "alert" : "status"}
          className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${
            feedback.type === "success"
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
              : "border-rose-400/25 bg-rose-400/10 text-rose-100"
          }`}
        >
          <Icon
            name={feedback.type === "success" ? "check" : "tools"}
            className="mt-0.5 size-4 shrink-0"
          />
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="ml-auto rounded-lg px-2 py-1 text-xs font-bold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Tutup
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <LogoAplikasiCard
          logoUrl={logoUrl}
          logoBusy={logoBusy}
          handleLogoUpload={handleLogoUpload}
          handleResetLogo={handleResetLogo}
        />

        <TemaVisualCard isOnline={isOnline} />
      </div>

      {/* Keamanan akun sendiri: tidak dijaga izin apa pun, karena setiap
          operator berhak mengamankan akunnya — termasuk role paling terbatas. */}
      <TwoFactorCard />
      <PasswordRecoveryCard />

      {hasPermission(user, "settings.manage") ? <MailSettingsCard /> : null}

      {hasPermission(user, "settings.manage") ? (
        <ProfilInstansiCard
          appDisplayName={appDisplayName}
          setAppDisplayName={setAppDisplayName}
          companyProfile={companyProfile}
          setCompanyProfile={setCompanyProfile}
          companyProfileBusy={companyProfileBusy}
          handleCompanyProfileSubmit={handleCompanyProfileSubmit}
          handleCompanyLogoUpload={handleCompanyLogoUpload}
          handleSignatureUpload={handleSignatureUpload}
        />
      ) : null}

      {user?.isSuperadmin ? (
        <KonfigurasiDatabaseCard
          tursoUrl={tursoUrl}
          setTursoUrl={setTursoUrl}
          tursoProvider={tursoProvider}
          setTursoProvider={setTursoProvider}
          tursoAllowInsecure={tursoAllowInsecure}
          setTursoAllowInsecure={setTursoAllowInsecure}
          tursoToken={tursoToken}
          setTursoToken={setTursoToken}
          showTursoToken={showTursoToken}
          setShowTursoToken={setShowTursoToken}
          tursoTestStatus={tursoTestStatus}
          setTursoTestStatus={setTursoTestStatus}
          tursoBusy={tursoBusy}
          tursoTesting={tursoTesting}
          tursoEndpoint={tursoEndpoint}
          tursoProviderInfo={tursoProviderInfo}
          handleTursoSave={handleTursoSave}
          handleTursoTest={handleTursoTest}
          handleTursoClear={handleTursoClear}
        />
      ) : null}

      {/* Cadangan berkas hanya ada artinya bila databasenya memang berada di
          perangkat ini. Pada Web datanya di database remote, dan seluruh
          perintah portabilitas adalah command Tauri yang tidak terdaftar di
          sana — menampilkan kartunya hanya menjanjikan tombol yang pasti
          gagal. isHydrated menjaga agar render server dan render pertama di
          peramban tetap sama. */}
      {isHydrated && user?.isSuperadmin && isDesktopRuntime() ? (
        <DatabaseBackupCard provider={tursoProvider} />
      ) : null}

      {user?.isSuperadmin ? (
        <KeamananAbsensiCard
          scanPhotoEnabled={scanPhotoEnabled}
          setScanPhotoEnabled={setScanPhotoEnabled}
          scanIpEnabled={scanIpEnabled}
          setScanIpEnabled={setScanIpEnabled}
          ipAllowlist={ipAllowlist}
          ipAllowlistDraft={ipAllowlistDraft}
          setIpAllowlistDraft={setIpAllowlistDraft}
          ipDeviceAddresses={ipDeviceAddresses}
          ipAllowlistBusy={ipAllowlistBusy}
          handleScanSecuritySubmit={handleScanSecuritySubmit}
        />
      ) : null}

      {user?.isSuperadmin ? (
        <GeofencingCard
          geofence={geofence}
          setGeofence={setGeofence}
          geofenceBusy={geofenceBusy}
          currentDeviceCoords={currentDeviceCoords}
          isOnline={isOnline}
          useCurrentLocation={useCurrentLocation}
          handleGeofenceSubmit={handleGeofenceSubmit}
        />
      ) : null}

      {user?.isSuperadmin ? (
        <KeamananPemindaiCard
          scannerSafety={scannerSafety}
          setScannerSafety={setScannerSafety}
          scannerSafetyBusy={scannerSafetyBusy}
          handleScannerSafetySubmit={handleScannerSafetySubmit}
        />
      ) : null}

      {hasPermission(user, "settings.manage") ||
      hasPermission(user, "alfa.trigger") ? (
        <OtomasiAlfaCard
          user={user}
          autoAlfaEnabled={autoAlfaEnabled}
          autoAlfaBusy={autoAlfaBusy}
          alfaTriggerBusy={alfaTriggerBusy}
          handleAutoAlfaToggle={handleAutoAlfaToggle}
          handleTriggerAlfaNow={handleTriggerAlfaNow}
        />
      ) : null}

      {isDesktopSyncAvailable() && hasPermission(user, "sync.view") ? (
        <SinkronisasiDesktopCard
          user={user}
          syncStatus={syncStatus}
          conflicts={conflicts}
          syncBusy={syncBusy}
          autoSyncError={autoSyncError}
          isOnline={isOnline}
          refreshSync={refreshSync}
          retryFailed={retryFailed}
          clearFailed={clearFailed}
          resolveConflicts={resolveConflicts}
          resolveConflictsLocal={resolveConflictsLocal}
          resyncSettings={resyncSettings}
        />
      ) : null}

      {alfaModalResult ? (
        <Modal
          titleId="alfa-modal-summary"
          onClose={() => setAlfaModalResult(null)}
          title="Ringkasan Eksekusi Generate Alfa"
        >
          <div className="space-y-4">
            <div
              className={`rounded-2xl border p-4 ${
                alfaModalResult.status === "SELESAI"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                  : alfaModalResult.status === "LIBUR"
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                    : "border-sky-500/20 bg-sky-500/10 text-sky-300"
              }`}
            >
              <div className="flex items-center gap-2 font-bold">
                <Icon
                  name={
                    alfaModalResult.status === "SELESAI" ? "check" : "calendar"
                  }
                  className="size-5"
                />
                <span>Status: {alfaModalResult.status}</span>
              </div>
              <p className="mt-1 text-xs">{alfaModalResult.pesan}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <div className="text-[11px] text-slate-400">
                  Alfa Baru Dibuat
                </div>
                <div className="text-xl font-black text-amber-400">
                  {alfaModalResult.jumlahAlfaDibuat}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <div className="text-[11px] text-slate-400">
                  Sudah Ada / Hadir
                </div>
                <div className="text-xl font-black text-emerald-400">
                  {alfaModalResult.jumlahSudahAda}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <div className="text-[11px] text-slate-400">
                  Belum Cutoff Shift
                </div>
                <div className="text-xl font-black text-sky-400">
                  {alfaModalResult.jumlahBelumWaktunya}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <div className="text-[11px] text-slate-400">
                  Shift Fleksibel (dinilai)
                </div>
                <div className="text-xl font-black text-purple-400">
                  {alfaModalResult.jumlahFleksibel}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <div className="text-[11px] text-slate-400">Hari Libur</div>
                <div className="text-xl font-black text-slate-300">
                  {alfaModalResult.jumlahLibur}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <div className="text-[11px] text-slate-400">
                  Shift Tidak Valid
                </div>
                <div className="text-xl font-black text-rose-400">
                  {alfaModalResult.jumlahShiftTidakValid}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setAlfaModalResult(null)}
                className="rounded-xl bg-sky-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400"
              >
                Tutup Ringkasan
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </AppShell>
  );
}
