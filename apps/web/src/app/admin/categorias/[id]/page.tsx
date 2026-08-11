"use client";

import { CategoriaCadastroForm } from "@/components/CategoriaCadastroForm";
import { useParams } from "next/navigation";

export default function EditarCategoriaPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  if (!id) return null;
  return <CategoriaCadastroForm categoriaId={id} />;
}
