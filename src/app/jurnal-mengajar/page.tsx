"use client";

import { redirect } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import { getDaftarMapel, getDaftarRombel } from "@/lib/gateways/academic";
import {
  type ClassAttendanceSession,
  getDaftarSesiPresensi,
} from "@/lib/gateways/class-attendance";
import { syncNow } from "@/lib/gateways/sync-status";
import { getDaftarGuru } from "@/lib/gateways/teacher";
import {
  deleteTeachingJournal,
  listTeachingJournals,
  saveTeachingJournal,
  type TeachingJournal,
} from "@/lib/gateways/teaching-journal";

export default function JurnalMengajarPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canManage = hasPermission(user, "teaching_journal.manage");
  const canDelete = hasPermission(user, "teaching_journal.delete");

  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  // Filter options
  const [rombelList, setRombelList] = useState<Record<string, unknown>[]>([]);
  const [mapelList, setMapelList] = useState<Record<string, unknown>[]>([]);
  const [guruList, setGuruList] = useState<Record<string, unknown>[]>([]);

  const [selectedRombel, setSelectedRombel] = useState<string>("");
  const [selectedMapel, setSelectedMapel] = useState<string>("");
  const [selectedGuru, setSelectedGuru] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Data
  const [sessions, setSessions] = useState<ClassAttendanceSession[]>([]);
  const [journals, setJournals] = useState<TeachingJournal[]>([]);

  // Modal State
  const [activeModal, setActiveModal] = useState<
    "create_or_edit" | "delete" | null
  >(null);
  const [targetSession, setTargetSession] =
    useState<ClassAttendanceSession | null>(null);
  const [targetJournal, setTargetJournal] = useState<TeachingJournal | null>(
    null,
  );

  // Form inputs
  const [materiDisampaikan, setMateriDisampaikan] = useState("");
  const [kendala, setKendala] = useState("");
  const [tindakLanjut, setTindakLanjut] = useState("");
  const [parafNama, setParafNama] = useState("");
  const isSubmittingRef = useRef(false);

  // Guard area level
  if (
    !authLoading &&
    isAuthenticated &&
    !canAccessArea(user, "jurnal_mengajar")
  ) {
    redirect("/forbidden");
  }

  // Load master filter options
  const loadMasterData = useCallback(async () => {
    try {
      const [rData, mData, gData] = await Promise.all([
        getDaftarRombel(),
        getDaftarMapel(),
        getDaftarGuru(),
      ]);
      setRombelList(rData || []);
      setMapelList(mData || []);
      setGuruList(gData || []);
    } catch {
      // Abaikan galat master
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void loadMasterData();
    }
  }, [isAuthenticated, loadMasterData]);

  // Load Sessions and Journals
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionData, journalData] = await Promise.all([
        getDaftarSesiPresensi({
          id_rombel: selectedRombel || undefined,
          id_mapel: selectedMapel || undefined,
          id_guru: selectedGuru || undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
        }),
        listTeachingJournals({
          id_rombel: selectedRombel || undefined,
          id_mapel: selectedMapel || undefined,
          id_guru: selectedGuru || undefined,
          tanggal_mulai: startDate || undefined,
          tanggal_selesai: endDate || undefined,
        }),
      ]);
      setSessions(sessionData || []);
      setJournals(journalData || []);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal memuat data jurnal.";
      setFeedback({ tone: "error", message: msg });
    } finally {
      setLoading(false);
    }
  }, [selectedRombel, selectedMapel, selectedGuru, startDate, endDate]);

  useEffect(() => {
    if (isAuthenticated) {
      void loadData();
    }
  }, [isAuthenticated, loadData]);

  // Background sync listener
  useEffect(() => {
    const onSyncCompleted = () => {
      void loadData();
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [loadData]);

  const handleRefresh = async () => {
    try {
      await syncNow();
    } catch {
      // Abaikan galat sinkronisasi sementara
    }
    await loadData();
    setFeedback({
      tone: "success",
      message: "Data jurnal berhasil dimuat ulang.",
    });
  };

  // Map journals by id_presensi_mapel
  const journalMap = useMemo(() => {
    const map = new Map<string, TeachingJournal>();
    for (const j of journals) {
      map.set(j.id_presensi_mapel, j);
    }
    return map;
  }, [journals]);

  const handleOpenForm = (
    session: ClassAttendanceSession,
    existing?: TeachingJournal,
  ) => {
    setTargetSession(session);
    setTargetJournal(existing || null);
    setMateriDisampaikan(existing?.materi_disampaikan || "");
    setKendala(existing?.kendala || "");
    setTindakLanjut(existing?.tindak_lanjut || "");
    setParafNama(
      existing?.paraf_nama || session.nama_guru || user?.nama_operator || "",
    );
    setActiveModal("create_or_edit");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || !targetSession) return;

    if (!materiDisampaikan.trim()) {
      setFeedback({
        tone: "warning",
        message: "Materi yang disampaikan wajib diisi.",
      });
      return;
    }

    isSubmittingRef.current = true;
    try {
      await saveTeachingJournal({
        id_jurnal: targetJournal?.id_jurnal,
        id_presensi_mapel: targetSession.id_presensi_mapel,
        materi_disampaikan: materiDisampaikan.trim(),
        kendala: kendala.trim() || null,
        tindak_lanjut: tindakLanjut.trim() || null,
        paraf_nama: parafNama.trim() || null,
      });
      setActiveModal(null);
      setFeedback({
        tone: "success",
        message: "Jurnal mengajar dan paraf digital berhasil disimpan.",
      });
      await loadData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menyimpan jurnal mengajar.";
      setFeedback({ tone: "error", message: msg });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleDelete = async () => {
    if (isSubmittingRef.current || !targetJournal) return;
    isSubmittingRef.current = true;
    try {
      await deleteTeachingJournal(targetJournal.id_jurnal);
      setActiveModal(null);
      setFeedback({
        tone: "success",
        message: "Catatan jurnal mengajar berhasil dihapus.",
      });
      await loadData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menghapus jurnal.";
      setFeedback({ tone: "error", message: msg });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          eyebrow="AKADEMIK & KBM"
          title="Jurnal Mengajar"
          description="Catatan materi yang tersampaikan di kelas, kendala pembelajaran, tindak lanjut, dan paraf digital guru pengampu."
          actions={
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
            >
              <Icon name="refresh" className="w-4 h-4" />
              Muat Ulang
            </button>
          }
        />

        {feedback && (
          <FeedbackBanner
            tone={feedback.tone}
            onDismiss={() => setFeedback(null)}
          >
            {feedback.message}
          </FeedbackBanner>
        )}

        {/* Filter Bar */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <span className="block text-xs font-medium text-slate-400 mb-1">
                Rombongan Belajar
              </span>
              <select
                aria-label="Rombongan belajar"
                value={selectedRombel}
                onChange={(e) => setSelectedRombel(e.target.value)}
                className="w-full text-sm rounded-lg px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="">Semua Rombel</option>
                {rombelList.map((r) => (
                  <option key={String(r.id_rombel)} value={String(r.id_rombel)}>
                    {String(r.nama_rombel)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-400 mb-1">
                Mata Pelajaran
              </span>
              <select
                aria-label="Mata pelajaran"
                value={selectedMapel}
                onChange={(e) => setSelectedMapel(e.target.value)}
                className="w-full text-sm rounded-lg px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="">Semua Mapel</option>
                {mapelList.map((m) => (
                  <option key={String(m.id_mapel)} value={String(m.id_mapel)}>
                    {String(m.nama_mapel)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-400 mb-1">
                Guru Pengampu
              </span>
              <select
                aria-label="Guru pengampu"
                value={selectedGuru}
                onChange={(e) => setSelectedGuru(e.target.value)}
                className="w-full text-sm rounded-lg px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="">Semua Guru</option>
                {guruList.map((g) => (
                  <option key={String(g.id_guru)} value={String(g.id_guru)}>
                    {String(g.nama || g.nama_guru)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-400 mb-1">
                Tanggal Mulai
              </span>
              <input
                aria-label="Tanggal mulai"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-sm rounded-lg px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-400 mb-1">
                Tanggal Selesai
              </span>
              <input
                aria-label="Tanggal selesai"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-sm rounded-lg px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
          </div>
        </div>

        {/* Sessions & Journal List */}
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <Icon
              name="refresh"
              className="w-8 h-8 mx-auto animate-spin mb-2"
            />
            Memuat daftar sesi KBM dan jurnal mengajar...
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-12 text-center rounded-xl border border-dashed border-slate-800 bg-slate-900/30 text-slate-400">
            <Icon
              name="document"
              className="w-10 h-10 mx-auto mb-2 opacity-50"
            />
            <p className="font-medium">
              Tidak ada sesi presensi KBM ditemukan.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Jurnal mengajar dapat diisi setelah sesi presensi pelajaran dibuat
              di menu Presensi KBM.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {sessions.map((session) => {
              const journal = journalMap.get(session.id_presensi_mapel);
              const isFilled = Boolean(journal);

              return (
                <div
                  key={session.id_presensi_mapel}
                  className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm transition-colors hover:border-slate-700 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-xs font-semibold rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
                          {session.nama_rombel}
                        </span>
                        <h3 className="font-semibold text-base text-slate-100">
                          {session.nama_mapel}
                        </h3>
                        <span className="text-xs text-slate-400">
                          (Jam Ke: {session.jam_ke})
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Pengampu:{" "}
                        <strong className="text-slate-300">
                          {session.nama_guru}
                        </strong>{" "}
                        · Tanggal: {session.tanggal}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {isFilled ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          <Icon name="check" className="w-3.5 h-3.5" />
                          Sudah Diparaf
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          <Icon name="clock" className="w-3.5 h-3.5" />
                          Belum Diisi
                        </span>
                      )}

                      {canManage && (
                        <button
                          type="button"
                          onClick={() => handleOpenForm(session, journal)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
                        >
                          {isFilled ? "Sunting Jurnal" : "Tulis Jurnal"}
                        </button>
                      )}

                      {isFilled && canDelete && (
                        <button
                          type="button"
                          onClick={() => {
                            setTargetJournal(journal || null);
                            setActiveModal("delete");
                          }}
                          className="p-1.5 rounded-lg border border-rose-800/60 text-rose-400 hover:bg-rose-500/20 transition-colors"
                          title="Hapus Jurnal"
                        >
                          <Icon name="trash" className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {session.materi_pokok && (
                    <div className="text-xs text-slate-400">
                      <span className="font-medium text-slate-300">
                        Rencana Materi Pokok:
                      </span>{" "}
                      {session.materi_pokok}
                    </div>
                  )}

                  {isFilled && journal ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-sm bg-slate-950/40 p-3.5 rounded-lg border border-slate-800/70">
                      <div>
                        <span className="block text-xs font-medium text-slate-400 mb-1">
                          Materi Yang Disampaikan:
                        </span>
                        <p className="text-slate-200 whitespace-pre-line">
                          {journal.materi_disampaikan || "-"}
                        </p>
                      </div>

                      <div>
                        <span className="block text-xs font-medium text-slate-400 mb-1">
                          Kendala Pembelajaran:
                        </span>
                        <p className="text-slate-300 whitespace-pre-line">
                          {journal.kendala || "-"}
                        </p>
                      </div>

                      <div>
                        <span className="block text-xs font-medium text-slate-400 mb-1">
                          Tindak Lanjut:
                        </span>
                        <p className="text-slate-300 whitespace-pre-line">
                          {journal.tindak_lanjut || "-"}
                        </p>
                      </div>

                      <div className="md:col-span-3 pt-2 mt-1 border-t border-slate-800/60 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
                        <div>
                          Paraf Guru:{" "}
                          <strong className="text-slate-200">
                            {journal.paraf_nama || "-"}
                          </strong>
                        </div>
                        <div>
                          Operator Sesi:{" "}
                          <strong className="text-slate-200">
                            {journal.paraf_operator}
                          </strong>
                        </div>
                        <div>
                          Waktu Paraf:{" "}
                          <span className="text-slate-300">
                            {journal.paraf_at}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {/* Modal Tulis / Sunting Jurnal */}
        {activeModal === "create_or_edit" && targetSession && (
          <Modal
            isOpen={true}
            onClose={() => setActiveModal(null)}
            title={
              targetJournal
                ? "Sunting Jurnal Mengajar"
                : "Tulis Jurnal Mengajar"
            }
          >
            <form onSubmit={handleSave} className="space-y-4">
              <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/60 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Kelas:</span>
                  <span className="font-semibold text-slate-200">
                    {targetSession.nama_rombel}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Mata Pelajaran:</span>
                  <span className="font-semibold text-slate-200">
                    {targetSession.nama_mapel}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Guru / Tanggal:</span>
                  <span className="font-semibold text-slate-200">
                    {targetSession.nama_guru} · {targetSession.tanggal} (Jam{" "}
                    {targetSession.jam_ke})
                  </span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="materi-disampaikan"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Materi yang Benar-Benar Tersampaikan{" "}
                  <span className="text-rose-400">*</span>
                </label>
                <textarea
                  id="materi-disampaikan"
                  rows={3}
                  required
                  value={materiDisampaikan}
                  onChange={(e) => setMateriDisampaikan(e.target.value)}
                  placeholder="Tuliskan cakupan materi yang selesai diajarkan pada sesi ini..."
                  className="w-full text-sm rounded-lg px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label
                  htmlFor="kendala-kelas"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Kendala Kelas (Opsional)
                </label>
                <textarea
                  id="kendala-kelas"
                  rows={2}
                  value={kendala}
                  onChange={(e) => setKendala(e.target.value)}
                  placeholder="Contoh: Lampu padam 20 menit, siswa kurang fokus, modul belum selesai difotokopi..."
                  className="w-full text-sm rounded-lg px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label
                  htmlFor="tindak-lanjut"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Tindak Lanjut (Opsional)
                </label>
                <textarea
                  id="tindak-lanjut"
                  rows={2}
                  value={tindakLanjut}
                  onChange={(e) => setTindakLanjut(e.target.value)}
                  placeholder="Contoh: Latihan mandiri bab 4 di rumah, remidi kuis pertemuan berikutnya..."
                  className="w-full text-sm rounded-lg px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label
                  htmlFor="paraf-nama"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Nama Guru Saat Memaraf Digital
                </label>
                <input
                  id="paraf-nama"
                  type="text"
                  value={parafNama}
                  onChange={(e) => setParafNama(e.target.value)}
                  className="w-full text-sm rounded-lg px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Identitas akun login Anda (<strong>{user?.username}</strong>)
                  akan otomatis dikunci ke jejak audit database sebagai penjamin
                  non-repudiasi.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
                >
                  Simpan Jurnal & Paraf
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* Modal Hapus Jurnal */}
        {activeModal === "delete" && targetJournal && (
          <Modal
            isOpen={true}
            onClose={() => setActiveModal(null)}
            title="Konfirmasi Hapus Jurnal Mengajar"
          >
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Apakah Anda yakin ingin menghapus catatan jurnal mengajar ini?
                Catatan materi, kendala, dan paraf digital akan dihapus dari
                sistem.
              </p>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors"
                >
                  Hapus Jurnal
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </AppShell>
  );
}
