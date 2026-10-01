"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PageLoader } from "@/components/PageLoader";
import { loadingCount, subscribeLoading } from "@/lib/loadingBus";

const OVERLAY_DELAY_MS = 220;

/**
 * Barra no topo + overlay quando há request visível ou troca de página.
 * Polling em background usa api(..., { silent: true }) e não dispara isto.
 */
export function GlobalLoading() {
  const pathname = usePathname();
  const [apiBusy, setApiBusy] = useState(false);
  const [routeBusy, setRouteBusy] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    return subscribeLoading(() => setApiBusy(loadingCount() > 0));
  }, []);

  useEffect(() => {
    setRouteBusy(false);
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.getAttribute("target") === "_blank" || a.hasAttribute("download")) {
        return;
      }
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }
      setRouteBusy(true);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const busy = apiBusy || routeBusy;

  useEffect(() => {
    if (!busy) {
      setShowOverlay(false);
      return;
    }
    const t = window.setTimeout(() => setShowOverlay(true), OVERLAY_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [busy]);

  useEffect(() => {
    if (!routeBusy) return;
    const t = window.setTimeout(() => setRouteBusy(false), 12_000);
    return () => window.clearTimeout(t);
  }, [routeBusy]);

  if (!busy) return null;

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-1 overflow-hidden bg-brand/20"
        role="progressbar"
        aria-busy="true"
        aria-label="Carregando"
      >
        <div className="h-full w-1/3 animate-teep-indet rounded-full bg-brand" />
      </div>
      {showOverlay ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-white/65 backdrop-blur-[2px]"
          role="status"
          aria-live="polite"
        >
          <PageLoader label="Carregando dados…" />
        </div>
      ) : null}
    </>
  );
}
