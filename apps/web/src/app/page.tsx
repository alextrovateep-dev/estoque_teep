"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser } from "@/lib/api";
import { homeForUser } from "@/lib/access";

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    const user = getStoredUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.deveTrocarSenha) {
      router.replace("/trocar-senha");
      return;
    }
    if (user.perfilCompleto === false) {
      router.replace("/perfil?completar=1");
      return;
    }
    router.replace(homeForUser(user));
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500">
      Carregando…
    </div>
  );
}
