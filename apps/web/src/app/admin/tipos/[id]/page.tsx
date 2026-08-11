"use client";

import { TipoMovimentacaoCadastroForm } from "@/components/TipoMovimentacaoCadastroForm";
import { useParams } from "next/navigation";

export default function EditarTipoPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  if (!id) return null;
  return <TipoMovimentacaoCadastroForm tipoId={id} />;
}
