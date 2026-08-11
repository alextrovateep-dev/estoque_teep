"use client";

import { ClienteCadastroForm } from "@/components/ClienteCadastroForm";
import { getStoredUser } from "@/lib/api";
import { userCanEditCadastro } from "@/lib/access";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function NovoClientePage() {
  const router = useRouter();
  useEffect(() => {
    const u = getStoredUser();
    if (!u || !userCanEditCadastro(u, "clientes")) {
      router.replace("/cadastros/clientes");
    }
  }, [router]);
  return <ClienteCadastroForm />;
}
