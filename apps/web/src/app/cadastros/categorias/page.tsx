"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Rota antiga — Categorias ficam em Cadastros (somente ADMIN). */
export default function CategoriasRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/categorias");
  }, [router]);
  return (
    <p className="text-sm text-slate-500">
      Redirecionando para Cadastros → Categorias…
    </p>
  );
}
