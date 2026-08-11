"use client";

import { getStoredUser } from "@/lib/api";
import { userHas } from "@/lib/access";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

/** Página removida: filtro de série vive no Dashboard; histórico em Movimentações. */
function SeriesRedirectInner() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    const q = (sp.get("q") || sp.get("serie") || "").trim();
    const user = getStoredUser();
    const params = new URLSearchParams();
    if (q) params.set("serie", q);
    const qs = params.toString();

    if (user && userHas(user, "dashboard")) {
      router.replace(`/dashboard${qs ? `?${qs}` : ""}`);
      return;
    }
    if (user && userHas(user, "movimentacoes")) {
      router.replace(`/movimentacoes${qs ? `?${qs}` : ""}`);
      return;
    }
    router.replace("/");
  }, [router, sp]);

  return (
    <p className="text-sm text-slate-500">
      Redirecionando para o filtro de série…
    </p>
  );
}

export default function SeriesRedirectPage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-slate-500">Redirecionando…</p>
      }
    >
      <SeriesRedirectInner />
    </Suspense>
  );
}
