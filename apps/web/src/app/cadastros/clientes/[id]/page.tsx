"use client";

import { ClienteCadastroForm } from "@/components/ClienteCadastroForm";
import { getStoredUser } from "@/lib/api";
import { userCanEditCadastro } from "@/lib/access";
import { useParams } from "next/navigation";

export default function EditarClientePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const u = getStoredUser();
  const readOnly = !u || !userCanEditCadastro(u, "clientes");
  if (!id) return null;
  return <ClienteCadastroForm clienteId={id} readOnly={readOnly} />;
}
