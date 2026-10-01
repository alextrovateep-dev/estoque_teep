"use client";

export function PageLoader({
  label = "Carregando…",
}: {
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <span
        className="h-10 w-10 animate-spin rounded-full border-2 border-brand/25 border-t-brand"
        aria-hidden
      />
      <p className="text-sm font-medium text-slate-600">{label}</p>
    </div>
  );
}
