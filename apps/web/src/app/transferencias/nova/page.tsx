"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** F15: criação unificada em Novo Lançamento */
export default function NovaTransferenciaRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/lancamentos/novo");
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500">
      Redirecionando para Novo Lançamento…
    </div>
  );
}
