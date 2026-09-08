"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function MovimentacoesRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    sp.set("aba", "movimentacoes");
    router.replace(`/relatorios?${sp.toString()}`);
  }, [router, searchParams]);

  return (
    <p className="text-sm text-slate-500">
      Redirecionando para Relatórios → Movimentações…
    </p>
  );
}

export default function MovimentacoesPage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-slate-500">Carregando…</p>
      }
    >
      <MovimentacoesRedirectInner />
    </Suspense>
  );
}
