"use client";

import { FilialCadastroForm } from "@/components/FilialCadastroForm";
import { useParams } from "next/navigation";

export default function EditarFilialPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  if (!id) return null;
  return <FilialCadastroForm filialId={id} />;
}
