"use client";

import { FormEvent, ReactNode } from "react";

type Props = {
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  motivoLabel?: string;
  motivoRequired?: boolean;
  motivoPlaceholder?: string;
  motivo: string;
  onMotivoChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  danger?: boolean;
  children?: ReactNode;
};

export function ConfirmMotivoPanel({
  title,
  confirmLabel,
  cancelLabel = "Cancelar",
  motivoLabel = "Motivo / observação",
  motivoRequired = false,
  motivoPlaceholder = "Opcional",
  motivo,
  onMotivoChange,
  onConfirm,
  onCancel,
  loading,
  danger,
  children,
}: Props) {
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (motivoRequired && !motivo.trim()) return;
    onConfirm();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <div className="text-sm font-medium text-slate-800">{title}</div>
      {children}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          {motivoLabel}
          {motivoRequired ? " *" : ""}
        </span>
        <textarea
          value={motivo}
          onChange={(e) => onMotivoChange(e.target.value)}
          required={motivoRequired}
          rows={2}
          placeholder={motivoPlaceholder}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={loading}
          className={
            danger
              ? "rounded-lg bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              : "rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
          }
        >
          {loading ? "Aguarde…" : confirmLabel}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={onCancel}
          className="rounded-lg border px-3 py-2 text-sm text-slate-600"
        >
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}
