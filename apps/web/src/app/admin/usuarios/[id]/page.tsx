"use client";

import { UsuarioCadastroForm } from "@/components/UsuarioCadastroForm";
import { useParams } from "next/navigation";

export default function EditarUsuarioPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  if (!id) return null;
  return <UsuarioCadastroForm usuarioId={id} />;
}
