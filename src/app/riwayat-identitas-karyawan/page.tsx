"use client";

import { redirect } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { canAccessArea } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";
import { getRiwayatIdentitasKaryawan } from "@/lib/gateways/employee-identity-history";
import { useHydrated } from "@/lib/hooks/useHydrated";
import {
  EMPLOYEE_IDENTITY_FIELDS,
  LABEL_IDENTITAS_KARYAWAN,
  type RiwayatIdentitasKaryawan,
} from "@/lib/validations/employee-identity";

/**
 * Riwayat penggantian identitas karyawan.
 *
 * Satu baris lahir setiap kali operator memilih "Gunakan Versi Lokal" pada
 * konflik ID Unik: dua perangkat offline memberi ID yang sama kepada dua orang
 * berbeda, lalu data server ditimpa data perangkat. Halaman ini hanya membaca;
 * jejak penggantian tidak bisa dihapus dari aplikasi.
 */
export default function RiwayatIdentitasKaryawanPage() {
  const isHydrated = useHydrated();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [entries, setEntries] = useState<RiwayatIdentitasKaryawan[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await getRiwayatIdentitasKaryawan(search));
    } catch (caught) {
      // Di Desktop/Mobile tabel ini dibaca langsung dari cloud. Kegagalannya
      // WAJIB terlihat: daftar kosong tidak bisa dibedakan dari "belum ada
      // penggantian".
      setEntries([]);
      setError(
        caught instanceof Error
          ? caught.message
          : "Riwayat tidak dapat dimuat. Periksa koneksi ke database cloud.",
      );
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void load();
  }, [isAuthenticated, load]);

  if (!isHydrated || authLoading)
    return <div className="min-h-dvh bg-slate-950" />;
  if (!isAuthenticated) redirect("/login");
  if (!canAccessArea(user, "karyawan")) redirect("/forbidden");

  return (
    <AppShell contentClassName="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-9">
      <PageHeader
        eyebrow="Audit data induk"
        title="Riwayat Identitas Karyawan"
        description="Setiap kali data karyawan di server diganti lewat Gunakan Versi Lokal karena ID Unik-nya bentrok, data sebelum dan sesudahnya tercatat di sini beserta operator dan perangkatnya."
      />

      {error ? <FeedbackBanner tone="error">{error}</FeedbackBanner> : null}

      <label className="block">
        <span className="sr-only">Cari riwayat identitas karyawan</span>
        <input
          id="cari-riwayat-identitas"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari ID Unik, nama, kode karyawan, atau kode operator"
          className="app-input w-full"
        />
      </label>

      {loading ? (
        <div className="app-panel grid min-h-60 place-items-center rounded-3xl text-sm text-slate-400">
          Memuat riwayat identitas karyawan...
        </div>
      ) : entries.length === 0 && !error ? (
        <div className="app-panel grid min-h-60 place-items-center rounded-3xl p-6 text-center">
          <div className="space-y-2">
            <p className="text-base font-black text-white">
              Belum ada penggantian
            </p>
            <p className="mx-auto max-w-md text-sm text-slate-400">
              Riwayat terisi saat konflik ID Unik diselesaikan dengan Gunakan
              Versi Lokal di halaman Sinkronisasi.
            </p>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3">
          {entries.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </AppShell>
  );
}

function HistoryEntry({ entry }: { entry: RiwayatIdentitasKaryawan }) {
  return (
    <li className="app-panel rounded-2xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-black text-white">ID Unik {entry.idUnik}</p>
        <p className="text-xs text-slate-400">{entry.waktu} WIB</p>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Diganti oleh operator{" "}
        <span className="font-bold text-slate-200">
          {entry.kodeOperator || "tidak tercatat"}
        </span>{" "}
        dari perangkat{" "}
        <span className="font-mono text-slate-300">
          {entry.clientId.slice(0, 20) || "-"}
        </span>
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th scope="col" className="py-1 pr-3 font-bold">
                Kolom
              </th>
              <th scope="col" className="py-1 pr-3 font-bold">
                Sebelum
              </th>
              <th scope="col" className="py-1 font-bold">
                Sesudah
              </th>
            </tr>
          </thead>
          <tbody>
            {EMPLOYEE_IDENTITY_FIELDS.map((field) => {
              const lama = entry.dataLama[field] ?? "";
              const baru = entry.dataBaru[field] ?? "";
              const berubah = lama !== baru;
              return (
                <tr key={field} className="border-t border-white/5">
                  <th
                    scope="row"
                    className="py-1 pr-3 font-normal text-slate-400"
                  >
                    {LABEL_IDENTITAS_KARYAWAN[field]}
                  </th>
                  <td
                    className={`py-1 pr-3 ${berubah ? "text-rose-200" : "text-slate-300"}`}
                  >
                    {lama || "-"}
                  </td>
                  <td
                    className={`py-1 ${berubah ? "font-bold text-amber-100" : "text-slate-300"}`}
                  >
                    {baru || "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </li>
  );
}
