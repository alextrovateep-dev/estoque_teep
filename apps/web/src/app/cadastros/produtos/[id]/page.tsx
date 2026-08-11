"use client";

import { ProdutoCadastroForm } from "@/components/ProdutoCadastroForm";
import { getStoredUser } from "@/lib/api";
import { userCanEditCadastro } from "@/lib/access";
import { useParams } from "next/navigation";

export default function EditarProdutoPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const u = getStoredUser();
  const readOnly = !u || !userCanEditCadastro(u, "produtos");
  if (!id) return null;
  return <ProdutoCadastroForm produtoId={id} readOnly={readOnly} />;
}
