"use client";

import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { canAccessArea } from "@/lib/auth/access";
import { saveFileWithPicker } from "@/lib/client/download";
import {
  drawIdCardToCanvas,
  preloadCardAssets,
  printCardsDirectly,
  renderIdCardSideToCanvas,
} from "@/lib/client/id-card-renderer";
import { formatBytes, optimizeImageFile } from "@/lib/client/image-optimizer";
import {
  DEFAULT_PRINT_LAYOUT_PRESETS,
  getActivePrintLayout,
  loadPrintLayoutPresets,
  setActivePrintLayoutId,
} from "@/lib/client/print-layout-store";
import { useAuth } from "@/lib/context/AuthContext";
import { normalizePersonnelRole } from "@/lib/contracts/scanner";
import {
  type CompanyProfile,
  getCompanyProfile,
} from "@/lib/gateways/company-profile";
import { getDaftarIdCard, updateStatusIdCard } from "@/lib/gateways/id-card";
import {
  getIdCardTemplate,
  saveIdCardTemplate,
} from "@/lib/gateways/id-card-template";
import { backfillKartuPelajar } from "@/lib/gateways/student";
import { useHydrated } from "@/lib/hooks/useHydrated";
import type {
  CardSide,
  ElementType,
  IdCardElement,
  IdCardPrintLayoutConfig,
  IdCardTemplateConfig,
  PrintDuplexMode,
} from "@/types/id-card";

/**
 * Panel perancang template dimuat terpisah.
 *
 * Ia hanya dirender ketika tabnya aktif, sehingga menaruhnya di bundel halaman
 * berarti setiap orang yang cuma ingin melihat daftar kartu ikut mengunduhnya.
 * `ssr: false` wajib: Desktop dan Mobile memakai `output: "export"`.
 */
const LayoutPanel = dynamic(
  () =>
    import("@/components/id-cards/LayoutPanel").then((mod) => ({
      default: mod.LayoutPanel,
    })),
  { ssr: false },
);

const BuilderPanel = dynamic(
  () =>
    import("@/components/id-cards/BuilderPanel").then((mod) => ({
      default: mod.BuilderPanel,
    })),
  { ssr: false },
);

const DEFAULT_ID_CARD_ELEMENTS: IdCardElement[] = [
  {
    id: "el-company-logo",
    type: "company_logo",
    side: "front",
    sourceKey: "company.logo",
    label: "Logo Instansi",
    x: 6,
    y: 8,
    width: 14,
    height: 20,
    fontSize: 14,
    color: "#ffffff",
    visible: true,
  },
  {
    id: "el-header-company",
    type: "text",
    side: "front",
    sourceKey: "company.name",
    label: "Nama Instansi",
    x: 22,
    y: 11,
    fontSize: 16,
    fontWeight: "bold",
    color: "#ffffff",
    textAlign: "left",
    isUppercase: true,
    visible: true,
  },
  {
    id: "el-header-title",
    type: "static_text",
    side: "front",
    sourceKey: "static_text",
    staticValue: "KARTU IDENTITAS KARYAWAN",
    label: "Judul Kartu",
    x: 22,
    y: 22,
    fontSize: 9,
    fontWeight: "600",
    color: "#38bdf8",
    textAlign: "left",
    isUppercase: true,
    visible: true,
  },
  {
    id: "el-emp-name",
    type: "text",
    side: "front",
    sourceKey: "employee.name",
    label: "Nama Karyawan",
    x: 6,
    y: 44,
    fontSize: 18,
    fontWeight: "bold",
    color: "#ffffff",
    textAlign: "left",
    isUppercase: true,
    visible: true,
  },
  {
    id: "el-emp-pos",
    type: "text",
    side: "front",
    sourceKey: "employee.position",
    label: "Jabatan / Posisi",
    x: 6,
    y: 56,
    fontSize: 12,
    fontWeight: "600",
    color: "#7dd3fc",
    textAlign: "left",
    visible: true,
  },
  {
    id: "el-emp-dept",
    type: "text",
    side: "front",
    sourceKey: "employee.department",
    label: "Divisi / Unit",
    x: 6,
    y: 66,
    fontSize: 11,
    color: "#94a3b8",
    textAlign: "left",
    visible: true,
  },
  {
    id: "el-emp-nik",
    type: "text",
    side: "front",
    sourceKey: "employee.nik",
    label: "NIK / ID Karyawan",
    x: 6,
    y: 77,
    fontSize: 11,
    color: "#cbd5e1",
    textAlign: "left",
    visible: true,
  },
  {
    id: "el-qr-code",
    type: "qr_code",
    side: "front",
    sourceKey: "employee.qr_token",
    label: "QR Code Token",
    x: 74,
    y: 42,
    width: 20,
    height: 38,
    fontSize: 12,
    color: "#000000",
    visible: true,
  },
  {
    id: "el-back-terms",
    type: "text",
    side: "back",
    sourceKey: "company.terms",
    label: "Ketentuan Penggunaan",
    x: 8,
    y: 12,
    width: 84,
    height: 48,
    fontSize: 10,
    color: "#e2e8f0",
    textAlign: "left",
    visible: true,
  },
  {
    id: "el-back-signature",
    type: "photo",
    side: "back",
    sourceKey: "company.signature",
    label: "Tanda Tangan Pimpinan",
    x: 66,
    y: 64,
    width: 26,
    height: 24,
    fontSize: 10,
    color: "#ffffff",
    visible: true,
  },
];

type ActiveTab = "cards" | "builder" | "layout";

export default function IdCardsPage() {
  // Penjaga anti klik ganda (Aturan 5). `useState` tidak cukup: pembaruannya
  // dijadwalkan, sehingga dua klik dalam satu tick React sama-sama membaca
  // nilai lama dan keduanya lolos. Dideklarasikan di ATAS, sebelum setiap
  // early return, supaya urutan hook tidak pernah berubah antar-render.
  const isSubmittingRef = useRef(false);

  const hydrated = useHydrated();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  // Tab State
  const [activeTab, setActiveTab] = useState<ActiveTab>("cards");

  // Data States
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(
    null,
  );
  const [template, setTemplate] = useState<IdCardTemplateConfig>({
    id: "default_template",
    name: "Template Standar SPPG",
    orientation: "landscape",
    frontBgUrl: "",
    backBgUrl: "",
    elements: DEFAULT_ID_CARD_ELEMENTS,
    isActive: true,
  });
  const [templatesMap, setTemplatesMap] = useState<
    Record<string, IdCardTemplateConfig>
  >({});
  const templateIdRef = useRef(template.id);
  useEffect(() => {
    templateIdRef.current = template.id;
  });

  // Selection for Batch
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // UI / Feedback
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Preview Modal State
  const [previewEmployee, setPreviewEmployee] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [previewSide, setPreviewSide] = useState<CardSide>("front");
  const [previewFrontUrl, setPreviewFrontUrl] = useState<string | null>(null);
  const [previewBackUrl, setPreviewBackUrl] = useState<string | null>(null);
  const [previewRendering, setPreviewRendering] = useState(false);

  // Builder State
  const [builderSide, setBuilderSide] = useState<CardSide>("front");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null,
  );
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [builderBusy, setBuilderBusy] = useState(false);
  const [addElementModalOpen, setAddElementModalOpen] = useState(false);
  const [newElementType, setNewElementType] =
    useState<ElementType>("static_text");
  const [newElementSourceKey, setNewElementSourceKey] =
    useState<IdCardElement["sourceKey"]>("static_text");
  const [newElementLabel, setNewElementLabel] =
    useState<string>("Teks Kustom Baru");
  const [newElementStaticVal, setNewElementStaticVal] =
    useState<string>("Teks Kustom SPPG");
  const builderCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Unified Print Modal State (Single or Batch)
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printTargetRows, setPrintTargetRows] = useState<
    Record<string, unknown>[]
  >([]);
  const [printBusy, setPrintBusy] = useState(false);

  // Filename customizer for Preview Modal
  const [customFilename, setCustomFilename] = useState("");

  // === TAB 3: SETTING LAYOUT & KERTAS ===
  const [printLayouts, setPrintLayouts] = useState<IdCardPrintLayoutConfig[]>(
    [],
  );
  const [activeLayout, setActiveLayout] = useState<IdCardPrintLayoutConfig>(
    DEFAULT_PRINT_LAYOUT_PRESETS[0],
  );
  // Untuk Position Matrix Editor
  const [matrixEditorPage, setMatrixEditorPage] = useState<"front" | "back">(
    "front",
  );
  const [layoutPreviewPage, setLayoutPreviewPage] = useState<
    "front" | "back" | "both"
  >("both");
  // Nama preset baru yang sedang dibuat
  const [newPresetName, setNewPresetName] = useState("");
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  // Canvas Element Drag & Drop State
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{
    elementId: string;
    startClientX: number;
    startClientY: number;
    initialX: number;
    initialY: number;
  } | null>(null);

  // Load Data
  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [cardsRes, companyRes, defaultTpl, guruTpl, siswaTpl] =
          await Promise.all([
            getDaftarIdCard({
              search: search.trim() || undefined,
              status: statusFilter === "all" ? undefined : statusFilter,
            }),
            getCompanyProfile().catch(() => null),
            getIdCardTemplate("default_template").catch(() => null),
            getIdCardTemplate("template_guru").catch(() => null),
            getIdCardTemplate("template_siswa").catch(() => null),
          ]);
        setRows(cardsRes);
        if (companyRes) setCompanyProfile(companyRes);

        const newMap: Record<string, IdCardTemplateConfig> = {};
        if (defaultTpl) newMap.default_template = defaultTpl;
        if (guruTpl) newMap.template_guru = guruTpl;
        if (siswaTpl) newMap.template_siswa = siswaTpl;
        setTemplatesMap(newMap);

        const currentActive = newMap[templateIdRef.current] || defaultTpl;
        if (currentActive) {
          const safeElements =
            Array.isArray(currentActive.elements) &&
            currentActive.elements.length > 0
              ? currentActive.elements
              : DEFAULT_ID_CARD_ELEMENTS;
          const safeTemplate: IdCardTemplateConfig = {
            ...currentActive,
            elements: safeElements,
          };
          setTemplate(safeTemplate);
          if (safeElements.length > 0) {
            setSelectedElementId((prev) => prev || safeElements[0].id);
          }
        }
      } catch (cause) {
        if (!silent) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Gagal memuat data ID card.",
          );
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [search, statusFilter],
  );

  useEffect(() => {
    if (hydrated && isAuthenticated && canAccessArea(user, "idcards")) {
      void loadData();
    }
  }, [hydrated, isAuthenticated, user, loadData]);

  useEffect(() => {
    const onSyncCompleted = () => {
      void loadData(true);
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [loadData]);

  // Load preset layout cetak dari localStorage saat hydration
  useEffect(() => {
    if (!hydrated) return;
    const presets = loadPrintLayoutPresets();
    const active = getActivePrintLayout();
    setPrintLayouts(presets);
    setActiveLayout(active);
  }, [hydrated]);

  // Jumlah kartu yang dirender sekaligus. Angka ini soal jumlah node DOM,
  // bukan selera tampilan: grid tiga kolom membuat 60 kartu sudah lebih
  // panjang daripada yang dibaca siapa pun dalam sekali gulir.
  const KARTU_PER_HALAMAN = 60;
  const [halaman, setHalaman] = useState(1);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all") {
        const s = String(r.idcard_status || "Belum");
        if (s !== statusFilter) return false;
      }
      return true;
    });
  }, [rows, statusFilter]);

  const totalHalaman = Math.max(
    1,
    Math.ceil(filteredRows.length / KARTU_PER_HALAMAN),
  );

  // Halaman dijepit setelah filter berubah, supaya penyaringan yang
  // mengecilkan hasil tidak meninggalkan pengguna di halaman kosong.
  const halamanAman = Math.min(halaman, totalHalaman);

  const barisTampil = useMemo(
    () =>
      filteredRows.slice(
        (halamanAman - 1) * KARTU_PER_HALAMAN,
        halamanAman * KARTU_PER_HALAMAN,
      ),
    [filteredRows, halamanAman],
  );

  // Selection helpers
  const isAllSelected = useMemo(() => {
    if (filteredRows.length === 0) return false;
    return filteredRows.every((r) => selectedIds.has(String(r.id_unik)));
  }, [filteredRows, selectedIds]);

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      const next = new Set<string>();
      for (const r of filteredRows) {
        next.add(String(r.id_unik));
      }
      setSelectedIds(next);
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resolveTemplateForEmployee = useCallback(
    (emp: Record<string, unknown>): IdCardTemplateConfig => {
      const role = normalizePersonnelRole(
        String(emp.jenis_personil || emp.jenisPersonil || emp.divisi || ""),
      );
      if (role === "Siswa" && templatesMap.template_siswa) {
        return templatesMap.template_siswa;
      }
      if (role === "Guru" && templatesMap.template_guru) {
        return templatesMap.template_guru;
      }
      if (templatesMap.default_template) {
        return templatesMap.default_template;
      }
      return template;
    },
    [templatesMap, template],
  );

  const handleSwitchTemplate = async (newId: string) => {
    setBuilderBusy(true);
    try {
      const tpl = await getIdCardTemplate(newId);
      const safeElements =
        Array.isArray(tpl.elements) && tpl.elements.length > 0
          ? tpl.elements
          : DEFAULT_ID_CARD_ELEMENTS;
      const safeTpl: IdCardTemplateConfig = { ...tpl, elements: safeElements };
      setTemplate(safeTpl);
      setTemplatesMap((prev) => ({ ...prev, [newId]: safeTpl }));
      setMessage(`Beralih ke template: ${safeTpl.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat template.");
    } finally {
      setBuilderBusy(false);
    }
  };

  const handleBackfill = async () => {
    if (isSubmittingRef.current) return;
    setLoading(true);
    setError(null);
    isSubmittingRef.current = true;
    try {
      const res = await backfillKartuPelajar();
      setMessage(
        `Sinkronisasi kartu selesai: ${res.total_inserted} personil baru ditambahkan ke daftar ID Card.`,
      );
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal menyinkronkan kartu personil.",
      );
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  // Render preview when modal opens
  useEffect(() => {
    if (!previewEmployee || !template) return;
    let cancelled = false;
    setPreviewRendering(true);
    const empTpl = resolveTemplateForEmployee(previewEmployee);

    Promise.all([
      renderIdCardSideToCanvas({
        template: empTpl,
        side: "front",
        employee: previewEmployee,
        company: companyProfile,
      }),
      renderIdCardSideToCanvas({
        template: empTpl,
        side: "back",
        employee: previewEmployee,
        company: companyProfile,
      }),
    ])
      .then(([front, back]) => {
        if (!cancelled) {
          setPreviewFrontUrl(front);
          setPreviewBackUrl(back);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Gagal me-render kartu.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [previewEmployee, template, companyProfile, resolveTemplateForEmployee]);

  // Set default filename when preview employee opens
  useEffect(() => {
    if (previewEmployee) {
      const nama = String(
        previewEmployee.nama || previewEmployee.id_unik || "karyawan",
      );
      const safeNama = nama.replace(/[/\\?%*:|"<>]/g, "-").trim();
      setCustomFilename(`id-card-${safeNama}`);
    }
  }, [previewEmployee]);

  // Preload template assets for instant 60fps canvas drawing
  useEffect(() => {
    if (!template) return;
    const sampleEmp = rows[0] || {
      id_unik: "SPPG-2026-001",
      nama: "AHMAD FAUZI, S.Kom.",
      kode_karyawan: "SPPG-001",
      divisi: "Divisi Operasional & IT",
      jabatan_status: "Koordinator Tim",
      token_absensi: "DEMO_TOKEN_SPPG_2026",
    };
    void preloadCardAssets({
      template,
      company: companyProfile,
      employee: sampleEmp,
    });
  }, [template, companyProfile, rows]);

  // Render builder canvas synchronously / instant animation frame without flashing img tag
  useEffect(() => {
    const canvas = builderCanvasRef.current;
    if (!canvas || !template) return;

    const sampleEmp = rows[0] || {
      id_unik: "SPPG-2026-001",
      nama: "AHMAD FAUZI, S.Kom.",
      kode_karyawan: "SPPG-001",
      jenis_kelamin: "Laki-laki",
      divisi: "Divisi Operasional & IT",
      jabatan_status: "Koordinator Tim",
      token_absensi: "DEMO_TOKEN_SPPG_2026",
    };

    let animId: number;
    animId = requestAnimationFrame(() => {
      void drawIdCardToCanvas(canvas, {
        template,
        side: builderSide,
        employee: sampleEmp,
        company: companyProfile,
        selectedElementId,
        showBoundingBoxes,
      });
    });

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [
    template,
    builderSide,
    rows,
    companyProfile,
    selectedElementId,
    showBoundingBoxes,
  ]);

  // Single card action: Save PNG
  const handleSaveSinglePng = async (
    row: Record<string, unknown>,
    side: CardSide = "front",
    overrideFilename?: string,
  ) => {
    if (isSubmittingRef.current) return;
    if (!template) return;
    const id = String(row.id_unik);
    const nama = String(row.nama || id);
    setWorkingId(id);
    isSubmittingRef.current = true;
    try {
      const pngUrl = await renderIdCardSideToCanvas({
        template,
        side,
        employee: row,
        company: companyProfile,
      });

      const safeNama = nama.replace(/[/\\?%*:|"<>]/g, "-").trim();
      const defaultName = overrideFilename || `id-card-${safeNama}-${side}.png`;
      const finalFilename = defaultName.endsWith(".png")
        ? defaultName
        : `${defaultName}.png`;

      const res = await saveFileWithPicker(pngUrl, finalFilename, {
        description: `Gambar ID Card (${side.toUpperCase()})`,
        accept: { "image/png": [".png"] },
      });

      if (!res.cancelled) {
        await updateStatusIdCard({
          id_unik: id,
          idcard_status: "Berhasil",
          idcard_catatan: `PNG (${side}) disimpan`,
        });
        const destNote = res.path ? ` (${res.path})` : "";
        setMessage(
          `ID card ${nama} (${side}) berhasil diunduh & disimpan${destNote}.`,
        );
        await loadData();
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "ID card gagal diunduh.",
      );
    } finally {
      isSubmittingRef.current = false;
      setWorkingId(null);
    }
  };

  // Download both front and back
  const handleSaveBothPng = async (
    row: Record<string, unknown>,
    baseName?: string,
  ) => {
    if (!template) return;
    const nama = String(row.nama || row.id_unik || "karyawan");
    const safeNama = nama.replace(/[/\\?%*:|"<>]/g, "-").trim();
    const prefix = baseName || `id-card-${safeNama}`;

    await handleSaveSinglePng(row, "front", `${prefix}-depan.png`);
    await handleSaveSinglePng(row, "back", `${prefix}-belakang.png`);
  };

  // Open Print Modal for a Single Employee
  const handleOpenPrintSingle = (row: Record<string, unknown>) => {
    setPrintTargetRows([row]);
    setPrintModalOpen(true);
  };

  // Open Print Modal for Multiple Selected Employees
  const handleOpenPrintBatch = () => {
    const targets = rows.filter((r) => selectedIds.has(String(r.id_unik)));
    if (targets.length === 0) return;
    setPrintTargetRows(targets);
    setPrintModalOpen(true);
  };

  // Execute Print using in-DOM high-res print engine
  const handleExecutePrint = async () => {
    if (isSubmittingRef.current) return;
    if (!template || printTargetRows.length === 0) return;
    setPrintBusy(true);
    isSubmittingRef.current = true;
    try {
      setMessage(
        `Sedang menyiapkan pencetakan untuk ${printTargetRows.length} ID card...`,
      );
      const renderedCards: {
        frontPng: string;
        backPng?: string;
        name: string;
      }[] = [];

      const needFront = activeLayout.duplexMode !== "back_only";
      const needBack =
        activeLayout.duplexMode === "duplex" ||
        activeLayout.duplexMode === "back_only" ||
        activeLayout.duplexMode === "side_by_side";

      for (const row of printTargetRows) {
        let frontPng = "";
        if (needFront) {
          frontPng = await renderIdCardSideToCanvas({
            template,
            side: "front",
            employee: row,
            company: companyProfile,
          });
        }

        let backPng: string | undefined;
        if (needBack) {
          backPng = await renderIdCardSideToCanvas({
            template,
            side: "back",
            employee: row,
            company: companyProfile,
          });
        }

        renderedCards.push({
          frontPng: frontPng || backPng || "",
          backPng,
          name: String(row.nama || row.id_unik),
        });

        await updateStatusIdCard({
          id_unik: String(row.id_unik),
          idcard_status: "Berhasil",
          idcard_catatan: `Dicetak (${activeLayout.presetName} - ${activeLayout.duplexMode})`,
        });
      }

      printCardsDirectly(renderedCards, {
        orientation: template.orientation,
        title:
          printTargetRows.length === 1
            ? `ID Card - ${String(printTargetRows[0]?.nama || "Karyawan")}`
            : "Cetak Lembar ID Card SPPG",
        customLayout: activeLayout,
      });

      setPrintModalOpen(false);
      setMessage(
        `Pencetakan ${printTargetRows.length} ID card berhasil disiapkan & dibuka ke printer.`,
      );
      await loadData();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Gagal memproses pencetakan ID card.",
      );
    } finally {
      isSubmittingRef.current = false;
      setPrintBusy(false);
    }
  };

  // Builder actions
  const handleSaveTemplate = async () => {
    if (isSubmittingRef.current) return;
    if (!template) return;
    setBuilderBusy(true);
    isSubmittingRef.current = true;
    try {
      const saved = await saveIdCardTemplate(template);
      setTemplate(saved);
      setMessage(
        "Konfigurasi Template ID Card berhasil disimpan & disinkronkan.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Gagal menyimpan template ID card.",
      );
    } finally {
      isSubmittingRef.current = false;
      setBuilderBusy(false);
    }
  };

  const handleCustomBgUpload = async (
    event: ChangeEvent<HTMLInputElement>,
    side: CardSide,
  ) => {
    const file = event.target.files?.[0];
    if (!file || !template) return;

    try {
      setBuilderBusy(true);
      const isPortrait = template.orientation === "portrait";
      const targetWidth = isPortrait ? 638 : 1011;
      const targetHeight = isPortrait ? 1011 : 638;

      const optimized = await optimizeImageFile(file, {
        maxWidth: targetWidth,
        maxHeight: targetHeight,
        quality: 0.92,
        mimeType: "image/jpeg",
        fit: "exact",
      });

      setTemplate({
        ...template,
        [side === "front" ? "frontBgUrl" : "backBgUrl"]: optimized.dataUrl,
      });

      setMessage(
        `Background sisi ${side === "front" ? "depan" : "belakang"} berhasil dioptimasi dari ${formatBytes(optimized.originalSizeBytes)} menjadi ${formatBytes(optimized.optimizedSizeBytes)} (${optimized.width}×${optimized.height} px HD 300 DPI).`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Gagal mengoptimasi gambar background.",
      );
    } finally {
      setBuilderBusy(false);
      event.target.value = "";
    }
  };

  // Canvas Element Hit Testing & Drag-and-Drop
  const getElementAtCoords = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = builderCanvasRef.current;
      if (!canvas || !template) return null;

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const clickX = (clientX - rect.left) * scaleX;
      const clickY = (clientY - rect.top) * scaleY;

      const currentElements = (template.elements || []).filter(
        (el) => el.side === builderSide && el.visible !== false,
      );
      const fontMultiplier = canvas.width / 360;

      for (let i = currentElements.length - 1; i >= 0; i--) {
        const el = currentElements[i];
        const elX = (el.x / 100) * canvas.width;
        const elY = (el.y / 100) * canvas.height;
        const fontSizePx = Math.max(
          10,
          Math.round(el.fontSize * fontMultiplier),
        );

        let boxW = el.width ? (el.width / 100) * canvas.width : 0;
        let boxH = el.height ? (el.height / 100) * canvas.height : 0;

        if (el.type === "qr_code") {
          boxW = boxW > 0 ? boxW : 180;
          boxH = boxH > 0 ? boxH : 180;
        } else if (el.type === "company_logo" || el.type === "photo") {
          boxW = boxW > 0 ? boxW : 100;
          boxH = boxH > 0 ? boxH : 100;
        } else {
          if (boxW === 0) {
            boxW = Math.min(canvas.width - elX - 10, fontSizePx * 10);
          }
          if (boxH === 0) {
            boxH = fontSizePx * 1.5;
          }
        }

        let drawX = elX;
        if (el.textAlign === "center") {
          drawX = elX - boxW / 2;
        } else if (el.textAlign === "right") {
          drawX = elX - boxW;
        }

        if (
          clickX >= drawX - 10 &&
          clickX <= drawX + boxW + 10 &&
          clickY >= elY - 10 &&
          clickY <= elY + boxH + 10
        ) {
          return el;
        }
      }
      return null;
    },
    [template, builderSide],
  );

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const el = getElementAtCoords(e.clientX, e.clientY);
    if (el) {
      setSelectedElementId(el.id);
      dragStartRef.current = {
        elementId: el.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        initialX: el.x,
        initialY: el.y,
      };
      setIsDragging(true);
    } else {
      setSelectedElementId(null);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = builderCanvasRef.current;
    if (!canvas || !template) return;

    if (isDragging && dragStartRef.current) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const deltaXPercent =
        ((e.clientX - dragStartRef.current.startClientX) / rect.width) * 100;
      const deltaYPercent =
        ((e.clientY - dragStartRef.current.startClientY) / rect.height) * 100;

      const newX = Math.max(
        0,
        Math.min(
          100,
          Math.round((dragStartRef.current.initialX + deltaXPercent) * 10) / 10,
        ),
      );
      const newY = Math.max(
        0,
        Math.min(
          100,
          Math.round((dragStartRef.current.initialY + deltaYPercent) * 10) / 10,
        ),
      );

      setTemplate((prev) => ({
        ...prev,
        elements: prev.elements.map((elem) =>
          elem.id === dragStartRef.current?.elementId
            ? { ...elem, x: newX, y: newY }
            : elem,
        ),
      }));
    } else {
      const el = getElementAtCoords(e.clientX, e.clientY);
      canvas.style.cursor = el ? "grab" : "default";
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
    const canvas = builderCanvasRef.current;
    if (canvas) canvas.style.cursor = "default";
  };

  const handleCanvasTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    const el = getElementAtCoords(touch.clientX, touch.clientY);
    if (el) {
      setSelectedElementId(el.id);
      dragStartRef.current = {
        elementId: el.id,
        startClientX: touch.clientX,
        startClientY: touch.clientY,
        initialX: el.x,
        initialY: el.y,
      };
      setIsDragging(true);
    }
  };

  const handleCanvasTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const touch = e.touches[0];
    const canvas = builderCanvasRef.current;
    if (!touch || !canvas || !template || !isDragging || !dragStartRef.current)
      return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const deltaXPercent =
      ((touch.clientX - dragStartRef.current.startClientX) / rect.width) * 100;
    const deltaYPercent =
      ((touch.clientY - dragStartRef.current.startClientY) / rect.height) * 100;

    const newX = Math.max(
      0,
      Math.min(
        100,
        Math.round((dragStartRef.current.initialX + deltaXPercent) * 10) / 10,
      ),
    );
    const newY = Math.max(
      0,
      Math.min(
        100,
        Math.round((dragStartRef.current.initialY + deltaYPercent) * 10) / 10,
      ),
    );

    setTemplate((prev) => ({
      ...prev,
      elements: prev.elements.map((elem) =>
        elem.id === dragStartRef.current?.elementId
          ? { ...elem, x: newX, y: newY }
          : elem,
      ),
    }));
  };

  const handleUpdateSelectedElement = (updates: Partial<IdCardElement>) => {
    if (!template || !selectedElementId) return;
    setTemplate({
      ...template,
      elements: template.elements.map((el) =>
        el.id === selectedElementId ? { ...el, ...updates } : el,
      ),
    });
  };

  const handleToggleElementVisible = (elementId: string) => {
    if (!template) return;
    setTemplate({
      ...template,
      elements: template.elements.map((el) => {
        if (el.id === elementId) {
          return { ...el, visible: el.visible === false };
        }
        return el;
      }),
    });
  };

  const handleSwitchElementSide = (elementId: string, targetSide: CardSide) => {
    if (!template) return;
    setTemplate({
      ...template,
      elements: template.elements.map((el) => {
        if (el.id === elementId) {
          return { ...el, side: targetSide };
        }
        return el;
      }),
    });
    setBuilderSide(targetSide);
    setSelectedElementId(elementId);
  };

  const handleAddNewElement = (
    type: ElementType,
    sourceKey: IdCardElement["sourceKey"],
    label: string,
    staticValue?: string,
  ) => {
    if (!template) return;
    const newId = `el-custom-${Date.now()}`;
    const newEl: IdCardElement = {
      id: newId,
      type,
      side: builderSide,
      sourceKey,
      staticValue:
        staticValue || (type === "static_text" ? "Teks Baru" : undefined),
      label,
      x: 10,
      y: 50,
      width:
        type === "qr_code" || type === "company_logo" || type === "photo"
          ? 20
          : undefined,
      height:
        type === "qr_code" || type === "company_logo" || type === "photo"
          ? 20
          : undefined,
      fontSize: 12,
      fontWeight: "normal",
      color: type === "qr_code" ? "#000000" : "#ffffff",
      textAlign: "left",
      isUppercase: false,
      visible: true,
    };
    setTemplate({
      ...template,
      elements: [...template.elements, newEl],
    });
    setSelectedElementId(newId);
    setAddElementModalOpen(false);
    setMessage(
      `Elemen "${label}" berhasil ditambahkan ke sisi ${builderSide === "front" ? "Depan" : "Belakang"}.`,
    );
  };

  const handleDeleteElement = (elementId: string) => {
    if (!template) return;
    const remaining = template.elements.filter((el) => el.id !== elementId);
    setTemplate({
      ...template,
      elements: remaining,
    });
    if (selectedElementId === elementId) {
      const nextEl = remaining.find((el) => el.side === builderSide);
      setSelectedElementId(nextEl ? nextEl.id : null);
    }
    setMessage("Elemen kustom berhasil dihapus.");
  };

  const handleResetToDefault = () => {
    if (!template) return;
    setTemplate({
      ...template,
      elements: DEFAULT_ID_CARD_ELEMENTS,
    });
    setSelectedElementId("el-emp-name");
    setMessage("Tata letak elemen ID Card berhasil di-reset ke standar SPPG.");
  };

  const selectedElement = useMemo(() => {
    return template?.elements.find((el) => el.id === selectedElementId) || null;
  }, [template, selectedElementId]);

  if (!hydrated || authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 p-10 text-slate-300">
        Memuat data ID Card...
      </div>
    );
  }
  if (!isAuthenticated) redirect("/login");
  if (!canAccessArea(user, "idcards")) redirect("/forbidden");

  return (
    <AppShell contentClassName="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <PageHeader
        eyebrow="Identitas & Kartu Personil"
        title="Dynamic ID Card Builder & Batch Print"
        description="Sistem generator ID Card beresolusi tinggi (CR80 300 DPI) dengan visual template builder, barcode QR otomatis, dan cetak lembar A4 dengan tanda potong."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("cards")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "cards"
                  ? "bg-sky-400 text-slate-950 shadow-md shadow-sky-950/20"
                  : "border border-white/10 bg-slate-900 text-slate-300 hover:bg-slate-800"
              }`}
            >
              <span className="flex items-center gap-2">
                <Icon name="users" className="size-3.5" />
                Daftar & Cetak Kartu
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("builder")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "builder"
                  ? "bg-sky-400 text-slate-950 shadow-md shadow-sky-950/20"
                  : "border border-white/10 bg-slate-900 text-slate-300 hover:bg-slate-800"
              }`}
            >
              <span className="flex items-center gap-2">
                <Icon name="palette" className="size-3.5" />
                Desain Template
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("layout")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "layout"
                  ? "bg-violet-400 text-slate-950 shadow-md shadow-violet-950/20"
                  : "border border-white/10 bg-slate-900 text-slate-300 hover:bg-slate-800"
              }`}
            >
              <span className="flex items-center gap-2">
                <Icon name="settings" className="size-3.5" />
                Setting Layout
              </span>
            </button>
          </div>
        }
      />

      {/* Notifications */}
      {message ? (
        <FeedbackBanner tone="success" onDismiss={() => setMessage(null)}>
          {message}
        </FeedbackBanner>
      ) : null}
      {error ? (
        <FeedbackBanner tone="error" onDismiss={() => setError(null)}>
          {error}
        </FeedbackBanner>
      ) : null}

      {/* TAB 1: DAFTAR & CETAK KARTU */}
      {activeTab === "cards" ? (
        <div className="space-y-5">
          {/* Filter & Batch Actions Bar */}
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/80 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <input
                aria-label="Cari personil"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama karyawan, NIK, atau divisi..."
                className="min-h-10 flex-1 min-w-[200px] rounded-xl border border-white/10 bg-slate-950 px-3 text-xs text-white outline-none focus:border-sky-400"
              />
              <select
                aria-label="Filter status kartu"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="min-h-10 rounded-xl border border-white/10 bg-slate-950 px-3 text-xs text-white outline-none focus:border-sky-400"
              >
                <option value="all">Semua Status</option>
                <option value="Belum">Belum Dicetak</option>
                <option value="Berhasil">Sudah Dicetak</option>
              </select>
              <button
                type="button"
                onClick={() => void handleBackfill()}
                disabled={loading}
                className="min-h-10 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
                title="Sinkronkan personil baru (siswa dan guru) agar terdaftar di modul ID Card"
              >
                <Icon name="refresh" className="size-3.5" />
                Sinkronkan Siswa & Guru
              </button>
            </div>

            {selectedIds.size > 0 ? (
              <div className="flex items-center gap-2 animate-in fade-in">
                <span className="text-xs font-bold text-sky-300">
                  {selectedIds.size} dipilih
                </span>
                <button
                  type="button"
                  onClick={handleOpenPrintBatch}
                  disabled={printBusy}
                  className="rounded-xl bg-sky-400 px-4 py-2 text-xs font-black text-slate-950 shadow-md hover:bg-sky-300 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <Icon name="scanner" className="size-3.5" />
                  <span>Cetak Pilihan ({selectedIds.size})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700"
                >
                  Batal
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={toggleSelectAll}
                className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 inline-flex items-center gap-2"
              >
                <Icon name="check" className="size-3.5" />
                <span>Pilih Semua ({filteredRows.length})</span>
              </button>
            )}
          </div>

          {/* Cards Grid */}
          {loading ? (
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-12 text-center text-slate-400">
              Memuat data karyawan...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-12 text-center text-slate-400">
              Tidak ada data ID Card yang cocok dengan pencarian.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {barisTampil.map((row) => {
                const id = String(row.id_unik);
                const isSelected = selectedIds.has(id);
                const isWorking = workingId === id;
                const status = String(row.idcard_status || "Belum");

                return (
                  <div
                    key={id}
                    className={`group relative flex flex-col justify-between rounded-2xl border transition-all p-5 ${
                      isSelected
                        ? "border-sky-400/80 bg-sky-950/20 shadow-lg shadow-sky-950/30"
                        : "border-white/10 bg-slate-900/80 hover:border-white/20"
                    }`}
                  >
                    {/* Checkbox Header */}
                    <div className="flex items-start justify-between gap-2">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(id)}
                          className="size-4 rounded border-slate-700 bg-slate-900 text-sky-400 focus:ring-sky-400"
                        />
                        <span className="font-mono text-xs font-bold text-sky-400">
                          {String(row.kode_karyawan || id)}
                        </span>
                      </label>
                      <StatusBadge
                        tone={status === "Berhasil" ? "info" : "neutral"}
                      >
                        {status === "Berhasil" ? "Tercetak" : "Belum Cetak"}
                      </StatusBadge>
                    </div>

                    {/* Employee Info */}
                    <div className="mt-3 space-y-1">
                      <h3 className="text-base font-black text-white group-hover:text-sky-200 transition">
                        {String(row.nama)}
                      </h3>
                      <p className="text-xs font-semibold text-sky-300">
                        {String(row.jabatan_status || "-")}
                      </p>
                      <p className="text-xs text-slate-400">
                        {String(row.divisi || "-")}
                      </p>
                    </div>

                    {/* QR Code Status */}
                    <div className="mt-4 flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2 text-[11px]">
                      <span className="text-slate-400">Token QR Absensi</span>
                      <span
                        className={`font-mono font-bold ${
                          row.token_absensi
                            ? "text-emerald-400"
                            : "text-amber-400"
                        }`}
                      >
                        {row.token_absensi ? "Siap" : "Belum Terbit"}
                      </span>
                    </div>

                    {/* Action Buttons */}
                    <div className="mt-5 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewEmployee(row);
                          setPreviewSide("front");
                        }}
                        className="flex-1 rounded-xl border border-white/10 bg-slate-800 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 transition"
                      >
                        Pratinjau
                      </button>
                      <button
                        type="button"
                        disabled={isWorking}
                        onClick={() => handleOpenPrintSingle(row)}
                        className="rounded-xl bg-sky-400 px-3.5 py-2 text-xs font-black text-slate-950 hover:bg-sky-300 disabled:opacity-50 transition"
                      >
                        {isWorking ? "..." : "Cetak"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalHalaman > 1 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-3 text-xs">
              <span className="font-mono text-slate-400">
                Menampilkan {(halamanAman - 1) * KARTU_PER_HALAMAN + 1}–
                {Math.min(halamanAman * KARTU_PER_HALAMAN, filteredRows.length)}{" "}
                dari {filteredRows.length} personil
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHalaman(halamanAman - 1)}
                  disabled={halamanAman <= 1}
                  className="min-h-9 rounded-xl border border-white/15 bg-slate-800 px-3 font-bold text-slate-300 transition hover:bg-slate-700 disabled:opacity-40"
                >
                  Sebelumnya
                </button>
                <span className="font-mono text-slate-400">
                  {halamanAman} / {totalHalaman}
                </span>
                <button
                  type="button"
                  onClick={() => setHalaman(halamanAman + 1)}
                  disabled={halamanAman >= totalHalaman}
                  className="min-h-9 rounded-xl border border-white/15 bg-slate-800 px-3 font-bold text-slate-300 transition hover:bg-slate-700 disabled:opacity-40"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* TAB 2: VISUAL TEMPLATE BUILDER */}
      {activeTab === "builder" && template ? (
        <BuilderPanel
          template={template}
          setTemplate={setTemplate}
          builderSide={builderSide}
          setBuilderSide={setBuilderSide}
          selectedElementId={selectedElementId}
          setSelectedElementId={setSelectedElementId}
          selectedElement={selectedElement}
          showBoundingBoxes={showBoundingBoxes}
          setShowBoundingBoxes={setShowBoundingBoxes}
          builderBusy={builderBusy}
          builderCanvasRef={builderCanvasRef}
          setAddElementModalOpen={setAddElementModalOpen}
          handleSwitchTemplate={handleSwitchTemplate}
          handleSaveTemplate={handleSaveTemplate}
          handleCustomBgUpload={handleCustomBgUpload}
          handleCanvasMouseDown={handleCanvasMouseDown}
          handleCanvasMouseMove={handleCanvasMouseMove}
          handleCanvasMouseUp={handleCanvasMouseUp}
          handleCanvasTouchStart={handleCanvasTouchStart}
          handleCanvasTouchMove={handleCanvasTouchMove}
          handleUpdateSelectedElement={handleUpdateSelectedElement}
          handleToggleElementVisible={handleToggleElementVisible}
          handleSwitchElementSide={handleSwitchElementSide}
          handleDeleteElement={handleDeleteElement}
          handleResetToDefault={handleResetToDefault}
        />
      ) : null}

      {/* SINGLE CARD PREVIEW MODAL */}
      {previewEmployee ? (
        <Modal
          titleId="preview-card-dialog"
          onClose={() => setPreviewEmployee(null)}
          title={`Kartu Identitas - ${String(previewEmployee.nama)}`}
        >
          <div className="space-y-5">
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewSide("front")}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                  previewSide === "front"
                    ? "bg-sky-400 text-slate-950"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Sisi Depan
              </button>
              <button
                type="button"
                onClick={() => setPreviewSide("back")}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                  previewSide === "back"
                    ? "bg-sky-400 text-slate-950"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Sisi Belakang
              </button>
            </div>

            <div className="grid min-h-[300px] place-items-center rounded-2xl border border-white/10 bg-slate-950 p-4">
              {previewRendering ? (
                <div className="text-xs text-sky-300 animate-pulse">
                  Me-render kartu resolusi tinggi...
                </div>
              ) : (
                  previewSide === "front"
                    ? previewFrontUrl
                    : previewBackUrl
                ) ? (
                /* biome-ignore lint/performance/noImgElement: Data URL preview */
                <img
                  src={
                    (previewSide === "front"
                      ? previewFrontUrl
                      : previewBackUrl) as string
                  }
                  alt="Kartu Identitas"
                  className="max-h-[320px] max-w-full rounded-xl shadow-2xl border border-white/20"
                />
              ) : (
                <div className="text-xs text-slate-500 font-medium">
                  Pratinjau kartu sedang diproses...
                </div>
              )}
            </div>

            {/* Custom Filename Input */}
            <div className="space-y-1.5 rounded-2xl border border-white/10 bg-slate-950/80 p-3.5">
              <label
                htmlFor="id-card-filename"
                className="text-xs font-bold text-slate-300"
              >
                Nama File Unduhan:
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="id-card-filename"
                  type="text"
                  value={customFilename}
                  onChange={(e) => setCustomFilename(e.target.value)}
                  placeholder="Contoh: id-card-ahmad-fitrianto"
                  className="min-h-9 flex-1 rounded-xl border border-white/10 bg-slate-900 px-3 text-xs text-white outline-none focus:border-sky-400"
                />
                <span className="font-mono text-xs text-slate-400">
                  -{previewSide}.png
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
              <button
                type="button"
                onClick={() =>
                  handleSaveSinglePng(
                    previewEmployee,
                    "front",
                    customFilename ? `${customFilename}-depan.png` : undefined,
                  )
                }
                className="rounded-xl border border-sky-400/40 bg-sky-500/10 px-3 py-2.5 text-xs font-bold text-sky-300 hover:bg-sky-500/20 transition flex items-center justify-center gap-1.5"
              >
                <Icon name="download" className="size-3.5" />
                <span>Unduh PNG (Depan)</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSaveSinglePng(
                    previewEmployee,
                    "back",
                    customFilename
                      ? `${customFilename}-belakang.png`
                      : undefined,
                  )
                }
                className="rounded-xl border border-sky-400/40 bg-sky-500/10 px-3 py-2.5 text-xs font-bold text-sky-300 hover:bg-sky-500/20 transition flex items-center justify-center gap-1.5"
              >
                <Icon name="download" className="size-3.5" />
                <span>Unduh PNG (Belakang)</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSaveBothPng(
                    previewEmployee,
                    customFilename || undefined,
                  )
                }
                className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition flex items-center justify-center gap-1.5"
              >
                <Icon name="download" className="size-3.5" />
                <span>Unduh Keduanya (PNG)</span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenPrintSingle(previewEmployee)}
                className="rounded-xl bg-sky-400 px-3 py-2.5 text-xs font-black text-slate-950 hover:bg-sky-300 transition flex items-center justify-center gap-1.5 shadow"
              >
                <Icon name="scanner" className="size-4" />
                <span>Cetak Kartu</span>
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* UNIFIED PRINT MODAL (SINGLE & BATCH) */}
      {printModalOpen ? (
        <Modal
          titleId="print-card-dialog"
          onClose={() => setPrintModalOpen(false)}
          title={
            printTargetRows.length === 1
              ? `Cetak ID Card - ${String(printTargetRows[0].nama || "Karyawan")}`
              : `Cetak Massal (${printTargetRows.length} Kartu Karyawan)`
          }
        >
          <div className="space-y-5">
            {/* Pilihan Preset Layout Cetak */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-300">
                  1. Preset Layout Kertas (dari Setting Layout)
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPrintModalOpen(false);
                    setActiveTab("layout");
                  }}
                  className="text-[11px] font-bold text-violet-400 hover:text-violet-200 underline"
                >
                  Buka Setting Layout →
                </button>
              </div>

              <select
                aria-label="Preset layout kartu"
                id="modal-layout-preset-select"
                value={activeLayout.presetId}
                onChange={(e) => {
                  const found = printLayouts.find(
                    (p) => p.presetId === e.target.value,
                  );
                  if (found) {
                    setActiveLayout(found);
                    setActivePrintLayoutId(found.presetId);
                  }
                }}
                className="min-h-11 w-full rounded-xl border border-violet-400/30 bg-slate-950 px-3 text-xs text-white shadow-sm font-medium"
              >
                {printLayouts.map((p) => (
                  <option key={p.presetId} value={p.presetId}>
                    {p.presetName} {p.isBuiltIn ? "(bawaan)" : "(kustom)"}
                  </option>
                ))}
              </select>

              {/* Detail Info Preset Aktif */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl border border-white/10 bg-slate-950/80 p-3 text-[11px]">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">
                    Kertas
                  </span>
                  <div className="text-slate-200 font-bold">
                    {activeLayout.paperWidthMm}×{activeLayout.paperHeightMm} mm
                  </div>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">
                    Grid Kartu
                  </span>
                  <div className="text-slate-200 font-bold">
                    {activeLayout.gridCols}×{activeLayout.gridRows} (
                    {activeLayout.gridCols * activeLayout.gridRows} slot)
                  </div>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">
                    Tanda Potong
                  </span>
                  <div className="text-slate-200 font-bold">
                    {activeLayout.showCropMarks ? "Aktif" : "Nonaktif"}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">
                    Kalibrasi
                  </span>
                  <div className="text-slate-200 font-bold font-mono">
                    X:{activeLayout.printerOffsetXMm} Y:
                    {activeLayout.printerOffsetYMm}
                  </div>
                </div>
              </div>
            </div>

            {/* Sisi Kartu yang Dicetak */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-300">
                2. Sisi Kartu yang Dicetak (Mode Duplex)
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    ["front_only", "Depan Saja"],
                    ["back_only", "Belakang Saja"],
                    ["duplex", "Bolak-Balik (Duplex)"],
                    ["side_by_side", "Berdampingan (Lipat)"],
                  ] as [PrintDuplexMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      setActiveLayout((prev) => ({
                        ...prev,
                        duplexMode: mode,
                      }))
                    }
                    className={`rounded-xl border p-2.5 text-center text-xs font-bold transition ${
                      activeLayout.duplexMode === mode
                        ? "border-violet-400 bg-violet-500/20 text-white shadow-sm"
                        : "border-white/10 bg-slate-950 text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {activeLayout.duplexMode === "duplex" ? (
                <div className="text-[10px] text-orange-300/90 flex items-center gap-1.5 pt-0.5">
                  <span>
                    Arah balik printer:{" "}
                    <strong>
                      {activeLayout.flipAxis === "long_edge"
                        ? "Balik Sisi Panjang (Long Edge / Kiri-Kanan)"
                        : "Balik Sisi Pendek (Short Edge / Atas-Bawah)"}
                    </strong>
                  </span>
                </div>
              ) : null}
            </div>

            {/* Info Summary */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3.5 text-xs text-slate-400 space-y-1.5">
              <div className="flex items-center justify-between">
                <span>Jumlah ID card:</span>
                <strong className="text-white font-mono">
                  {printTargetRows.length} orang
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span>Orientasi Desain:</span>
                <strong className="text-sky-300 font-medium capitalize">
                  {template?.orientation === "portrait"
                    ? "Portrait (54 × 85.6 mm)"
                    : "Landscape (85.6 × 54 mm)"}
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span>Estimasi Lembar Kertas:</span>
                <strong className="text-violet-300 font-bold font-mono">
                  {Math.ceil(
                    printTargetRows.length /
                      Math.max(
                        1,
                        activeLayout.gridCols * activeLayout.gridRows,
                      ),
                  )}{" "}
                  lembar
                  {activeLayout.duplexMode === "duplex"
                    ? " (2 halaman per lembar)"
                    : " (1 halaman per lembar)"}
                </strong>
              </div>
              <div className="text-[11px] text-slate-500 pt-1 border-t border-white/5">
                • Status ID card akan otomatis diperbarui menjadi &quot;Sudah
                Dicetak&quot; saat proses cetak dijalankan.
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPrintModalOpen(false)}
                className="flex-1 rounded-xl border border-white/10 bg-slate-800 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={printBusy}
                onClick={handleExecutePrint}
                className="flex-1 rounded-xl bg-sky-400 py-2.5 text-xs font-black text-slate-950 hover:bg-sky-300 disabled:opacity-50 transition flex items-center justify-center gap-1.5 shadow"
              >
                <Icon name="scanner" className="size-4" />
                <span>
                  {printBusy
                    ? "Menyiapkan..."
                    : `Cetak Sekarang (${printTargetRows.length})`}
                </span>
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* ADD ELEMENT MODAL */}
      {addElementModalOpen ? (
        <Modal
          titleId="add-element-dialog"
          onClose={() => setAddElementModalOpen(false)}
          title={`Tambah Elemen Baru (Sisi ${builderSide === "front" ? "Depan" : "Belakang"})`}
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="el-type-select"
                className="text-xs font-bold text-slate-300"
              >
                Pilih Jenis Elemen:
              </label>
              <select
                id="el-type-select"
                value={`${newElementType}|${newElementSourceKey}`}
                onChange={(e) => {
                  const [t, s] = e.target.value.split("|") as [
                    ElementType,
                    IdCardElement["sourceKey"],
                  ];
                  setNewElementType(t);
                  setNewElementSourceKey(s);
                  if (s === "static_text") {
                    setNewElementLabel("Teks Kustom Baru");
                  } else if (s === "employee.qr_token") {
                    setNewElementLabel("QR Code Token");
                  } else if (s === "employee.avatar") {
                    setNewElementLabel("Foto Karyawan");
                  } else if (s === "company.logo") {
                    setNewElementLabel("Logo Instansi");
                  } else if (s === "company.signature") {
                    setNewElementLabel("Tanda Tangan Pimpinan");
                  } else if (s === "employee.name") {
                    setNewElementLabel("Nama Karyawan");
                  } else if (s === "employee.nik") {
                    setNewElementLabel("NIK / ID Karyawan");
                  } else if (s === "employee.gender") {
                    setNewElementLabel("Jenis Kelamin");
                  } else if (s === "employee.position") {
                    setNewElementLabel("Jabatan / Posisi");
                  } else if (s === "employee.department") {
                    setNewElementLabel("Divisi / Unit");
                  } else if (s === "company.name") {
                    setNewElementLabel("Nama Instansi");
                  } else if (s === "company.terms") {
                    setNewElementLabel("Syarat & Ketentuan");
                  }
                }}
                className="min-h-10 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-xs text-white"
              >
                <option value="static_text|static_text">
                  Teks Kustom / Judul Tambahan Bebas
                </option>
                <option value="qr_code|employee.qr_token">
                  QR Code Token Absensi Karyawan
                </option>
                <option value="photo|employee.avatar">
                  Foto / Avatar Karyawan
                </option>
                <option value="company_logo|company.logo">
                  Logo Instansi SPPG
                </option>
                <option value="photo|company.signature">
                  Tanda Tangan & Stempel Pimpinan
                </option>
                <option value="text|employee.name">
                  Nama Lengkap Karyawan
                </option>
                <option value="text|employee.nik">
                  NIK / Kode Identitas Karyawan
                </option>
                <option value="text|employee.gender">
                  Jenis Kelamin (Laki-laki / Perempuan)
                </option>
                <option value="text|employee.position">
                  Jabatan / Posisi Kerja
                </option>
                <option value="text|employee.department">
                  Divisi / Unit Departemen
                </option>
                <option value="text|company.name">Nama Instansi SPPG</option>
                <option value="text|company.terms">
                  Syarat & Ketentuan Penggunaan
                </option>
              </select>
            </div>

            <label className="block space-y-1.5 text-xs font-bold text-slate-300">
              Label Nama Elemen:
              <input
                type="text"
                value={newElementLabel}
                onChange={(e) => setNewElementLabel(e.target.value)}
                placeholder="Contoh: Nomor Kontak Darurat"
                className="min-h-10 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-xs text-white"
              />
            </label>

            {newElementType === "static_text" ? (
              <label className="block space-y-1.5 text-xs font-bold text-slate-300">
                Isi Teks Statis:
                <textarea
                  rows={2}
                  value={newElementStaticVal}
                  onChange={(e) => setNewElementStaticVal(e.target.value)}
                  placeholder="Masukkan teks yang akan ditampilkan di kartu..."
                  className="w-full rounded-xl border border-white/10 bg-slate-900 p-3 text-xs text-white"
                />
              </label>
            ) : null}

            <div className="flex gap-2 pt-3">
              <button
                type="button"
                onClick={() => setAddElementModalOpen(false)}
                className="flex-1 rounded-xl border border-white/10 bg-slate-800 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() =>
                  handleAddNewElement(
                    newElementType,
                    newElementSourceKey,
                    newElementLabel.trim() || "Elemen Baru",
                    newElementStaticVal,
                  )
                }
                className="flex-1 rounded-xl bg-sky-400 py-2.5 text-xs font-black text-slate-950 hover:bg-sky-300"
              >
                Tambahkan ke Sisi{" "}
                {builderSide === "front" ? "Depan" : "Belakang"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* TAB 3: SETTING LAYOUT & KERTAS */}
      {activeTab === "layout" ? (
        <LayoutPanel
          template={template}
          activeLayout={activeLayout}
          setActiveLayout={setActiveLayout}
          printLayouts={printLayouts}
          setPrintLayouts={setPrintLayouts}
          layoutPreviewPage={layoutPreviewPage}
          setLayoutPreviewPage={setLayoutPreviewPage}
          matrixEditorPage={matrixEditorPage}
          setMatrixEditorPage={setMatrixEditorPage}
          newPresetName={newPresetName}
          setNewPresetName={setNewPresetName}
          isSavingLayout={isSavingLayout}
          setIsSavingLayout={setIsSavingLayout}
          setMessage={setMessage}
        />
      ) : null}
    </AppShell>
  );
}
