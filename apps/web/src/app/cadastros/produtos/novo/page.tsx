"use client";

import { ProdutoCadastroForm } from "@/components/ProdutoCadastroForm";
import { getStoredUser } from "@/lib/api";
import { userCanEditCadastro } from "@/lib/access";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function NovoProdutoPage() {
  const router = useRouter();
  useEffect(() => {
    const u = getStoredUser();
    if (!u || !userCanEditCadastro(u, "produtos")) {
      router.replace("/cadastros/produtos");
    }
  }, [router]);
  return <ProdutoCadastroForm />;
}
