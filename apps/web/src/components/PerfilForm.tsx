"use client";

import { FormEvent, useRef, useState } from "react";
import { api, apiUpload, displayName, patchStoredUser, User } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";

export type PerfilFormValues = {
  nome: string;
  apelido: string;
  telefone: string;
  dataNascimento: string;
  fotoPerfil: string | null;
};

type Props = {
  initial: PerfilFormValues;
  /** Wizard de 1º acesso: exige apelido + nascimento e marca perfilCompleto */
  completar?: boolean;
  submitLabel?: string;
  onSaved?: (user: User) => void;
};

export function PerfilForm({
  initial,
  completar = false,
  submitLabel,
  onSaved,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState(initial.nome);
  const [apelido, setApelido] = useState(initial.apelido);
  const [telefone, setTelefone] = useState(initial.telefone);
  const [dataNascimento, setDataNascimento] = useState(initial.dataNascimento);
  const [fotoPerfil, setFotoPerfil] = useState(initial.fotoPerfil);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const avatarSrc = preview || resolveAssetUrl(fotoPerfil);

  async function onAvatarChange(file: File | null) {
    if (!file) return;
    setError("");
    setUploading(true);
    const local = URL.createObjectURL(file);
    setPreview(local);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("context", "perfil");
      const r = await apiUpload<{ url: string }>("/upload", fd);
      const updated = await api<User>("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ fotoPerfil: r.url }),
      });
      setFotoPerfil(updated.fotoPerfil ?? r.url);
      patchStoredUser({
        fotoPerfil: updated.fotoPerfil ?? r.url,
        apelido: updated.apelido,
        nome: updated.nome,
      });
      onSaved?.(updated);
      setMsg("Foto atualizada");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no upload");
      setPreview(null);
    } finally {
      setUploading(false);
      URL.revokeObjectURL(local);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    if (completar) {
      if (apelido.trim().length < 2) {
        setError("Informe o nome de exibição (apelido)");
        return;
      }
      if (!dataNascimento) {
        setError("Informe a data de nascimento");
        return;
      }
    }
    setLoading(true);
    try {
      const updated = await api<User>("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          nome: nome.trim(),
          apelido: apelido.trim(),
          telefone: telefone.trim() || null,
          dataNascimento: dataNascimento || null,
          ...(completar ? { perfilCompleto: true } : {}),
        }),
      });
      patchStoredUser({
        nome: updated.nome,
        apelido: updated.apelido,
        telefone: updated.telefone,
        dataNascimento: updated.dataNascimento,
        perfilCompleto: updated.perfilCompleto,
        aniversarioHoje: updated.aniversarioHoje,
        fotoPerfil: updated.fotoPerfil,
      });
      setMsg(completar ? "Perfil concluído" : "Perfil salvo");
      onSaved?.(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="relative shrink-0 overflow-hidden rounded-full ring-2 ring-brand/30 focus:outline-none focus:ring-2 focus:ring-brand"
          title="Alterar foto"
        >
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarSrc}
              alt=""
              className="h-20 w-20 object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center bg-brand/15 text-2xl font-semibold text-brand">
              {displayName({ nome, apelido }).slice(0, 1).toUpperCase()}
            </div>
          )}
        </button>
        <div>
          <p className="text-sm font-medium text-slate-800">Foto de perfil</p>
          <p className="mt-0.5 text-xs text-slate-500">
            JPEG, PNG, GIF ou WebP. Opcional.
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="mt-2 text-sm font-medium text-brand hover:underline disabled:opacity-60"
          >
            {uploading ? "Enviando…" : "Escolher imagem"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={(e) => void onAvatarChange(e.target.files?.[0] || null)}
          />
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Nome completo</span>
        <input
          type="text"
          required
          minLength={2}
          maxLength={100}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">
          Nome de exibição (apelido)
          {completar ? " *" : ""}
        </span>
        <input
          type="text"
          required={completar}
          minLength={2}
          maxLength={80}
          value={apelido}
          onChange={(e) => setApelido(e.target.value)}
          placeholder="Como você quer aparecer na plataforma"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">
          Telefone de contato
        </span>
        <input
          type="tel"
          maxLength={20}
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          placeholder="Opcional"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">
          Data de nascimento{completar ? " *" : ""}
        </span>
        <input
          type="date"
          required={completar}
          value={dataNascimento}
          onChange={(e) => setDataNascimento(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <span className="mt-1 block text-xs text-slate-400">
          Saber dessa data tão especial é importante para nós.
        </span>
      </label>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {msg && !error && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand py-3 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {loading
          ? "Salvando…"
          : submitLabel || (completar ? "Concluir cadastro" : "Salvar perfil")}
      </button>
    </form>
  );
}
