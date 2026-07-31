import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { AppShellGate } from "@/components/AppShellGate";

export const metadata: Metadata = {
  title: "TEEP Estoque",
  description: "Sistema de Controle de Estoque TEEP",
  icons: {
    icon: [
      { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/logo-teep-icon.png", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <Suspense fallback={<div className="p-6 text-sm text-slate-500">Carregando…</div>}>
          <AppShellGate>{children}</AppShellGate>
        </Suspense>
      </body>
    </html>
  );
}
