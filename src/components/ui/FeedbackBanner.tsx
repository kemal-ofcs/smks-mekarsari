"use client";

import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

interface FeedbackBannerProps {
  children: ReactNode;
  onDismiss?: () => void;
  tone: "error" | "success" | "warning";
}

const toneClasses = {
  error: "border-rose-400/25 bg-rose-400/10 text-rose-100",
  success: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
  warning: "border-amber-300/25 bg-amber-300/10 text-amber-100",
};

const SUCCESS_DISMISS_MS = 5000;

/**
 * Wadah bersama toast di level halaman. Di atas bottom nav (z-70), di BAWAH
 * backdrop Modal (z-100): saat dialog terbuka, pesan halaman yang sama dengan
 * pesan di dalam dialog tertutup backdrop sehingga tidak terbaca dua kali.
 */
function toastHost() {
  const existing = document.getElementById("feedback-toasts");
  if (existing) return existing;
  const host = document.createElement("div");
  host.id = "feedback-toasts";
  host.className =
    "pointer-events-none fixed inset-x-4 bottom-24 z-[90] flex flex-col gap-2 sm:left-auto sm:w-[26rem] lg:bottom-6 lg:right-6";
  document.body.appendChild(host);
  return host;
}

/**
 * Pesan di level halaman melayang sebagai toast supaya terlihat tanpa
 * menggulir ke atas; pesan di dalam dialog tetap di tempatnya, dekat form yang
 * memicunya. Sukses hilang sendiri, error dan peringatan menunggu ditutup.
 */
export function FeedbackBanner({
  children,
  onDismiss,
  tone,
}: FeedbackBannerProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<HTMLElement | "inline" | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useLayoutEffect(() => {
    setHost(
      anchorRef.current?.closest('[role="dialog"], dialog')
        ? "inline"
        : toastHost(),
    );
  }, []);

  // Hanya teks polos yang hilang sendiri; isi berupa elemen bisa memuat tautan
  // atau tombol yang butuh waktu untuk dipakai.
  const pesan = typeof children === "string" ? children : null;
  useEffect(() => {
    if (tone !== "success" || pesan === null) return;
    const timer = window.setTimeout(
      () => onDismissRef.current?.(),
      SUCCESS_DISMISS_MS,
    );
    return () => window.clearTimeout(timer);
  }, [tone, pesan]);

  if (host === null) return <span ref={anchorRef} hidden />;

  const banner = (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${toneClasses[tone]}`}
    >
      <Icon
        name={tone === "success" ? "check" : "tools"}
        className="mt-0.5 size-4 shrink-0"
      />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg px-2 py-1 text-xs font-bold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Tutup
        </button>
      ) : null}
    </div>
  );

  if (host === "inline") return banner;
  // Latar pekat di bawah warna nada: toast melayang di atas isi halaman, dan
  // nada 10% transparan saja tidak terbaca di atas tabel.
  return createPortal(
    <div className="pointer-events-auto rounded-2xl bg-slate-900 shadow-xl shadow-slate-950/40">
      {banner}
    </div>,
    host,
  );
}
