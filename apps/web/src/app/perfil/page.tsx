"use client";

import { Suspense } from "react";
import PerfilClient from "./PerfilClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-slate-500">
          Carregando…
        </div>
      }
    >
      <PerfilClient />
    </Suspense>
  );
}
