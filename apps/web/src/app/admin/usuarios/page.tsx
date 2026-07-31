"use client";

import { api, apiUpload, getStoredUser, patchStoredUser } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";
import {
  ALERTA_EVENTOS,
  ALERTA_EVENTO_LABELS,
  AlertaEvento,
  PERMISSAO_KEYS,
  PERMISSAO_LABELS,
  PermissaoKey,
  PermissoesUsuario,
  defaultPermissoes,
  Perfil,
} from "@teep/shared";
import { permissoesEditaveisParaPerfil } from "@/lib/access";
import { FormEvent, useEffect, useState } from "react";

type Filial = { id: string; nome: string; sigla: string };
type Usuario = {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  filialId: string | null;
  filialIds?: string[];
  ativo: boolean;
  fotoPerfil?: string | null;
  deveTrocarSenha?: boolean;
  receberAlertasEmail?: boolean;
  alertasEmail?: Partial<Record<AlertaEvento, boolean>>;
  permissoes?: PermissoesUsuario;
  filial?: Filial | null;
  filiais?: Filial[];
};

const emptyAlertas = () =>
  Object.fromEntries(ALERTA_EVENTOS.map((e) => [e, false])) as Record<
    AlertaEvento,
    boolean
  >;

export default function UsuariosPage() {
  const [lista, setLista] = useState<Usuario[]>([]);
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    nome: "",
    email: "",
    perfil: "OPERADOR" as Perfil,
    filialIds: [] as string[],
    receberAlertasEmail: false,
    alertasEmail: emptyAlertas(),
    fotoPerfil: null as string | null,
    permissoes: defaultPermissoes("OPERADOR"),
  });
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lastProvisional, setLastProvisional] = useState<{
    email: string;
    senha: string;
  } | null>(null);

  async function load() {
    const [u, f] = await Promise.all([
      api<Usuario[]>("/usuarios"),
      api<Filial[]>("/filiais?ativas=0"),
    ]);
    setLista(u);
    setFiliais(f);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function clearPendingAvatar() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingAvatar(null);
    setPendingPreview(null);
  }

  function resetForm() {
    setEditId(null);
    clearPendingAvatar();
    setForm({
      nome: "",
      email: "",
      perfil: "OPERADOR",
      filialIds: [],
      receberAlertasEmail: false,
      alertasEmail: emptyAlertas(),
      fotoPerfil: null,
      permissoes: defaultPermissoes("OPERADOR"),
    });
  }

  function startEdit(u: Usuario) {
    setEditId(u.id);
    setLastProvisional(null);
    clearPendingAvatar();
    const perfil = (u.perfil as Perfil) || "OPERADOR";
    setForm({
      nome: u.nome,
      email: u.email,
      perfil,
      filialIds:
        u.filialIds && u.filialIds.length > 0
          ? u.filialIds
          : u.filialId
            ? [u.filialId]
            : [],
      receberAlertasEmail: Boolean(u.receberAlertasEmail),
      alertasEmail: {
        ...emptyAlertas(),
        ...(u.alertasEmail || {}),
      },
      fotoPerfil: u.fotoPerfil || null,
      permissoes: u.permissoes || defaultPermissoes(perfil),
    });
    setError("");
    setMsg("");
  }

  function onPerfilChange(perfil: Perfil) {
    setForm((prev) => ({
      ...prev,
      perfil,
      permissoes: defaultPermissoes(perfil),
    }));
  }

  function togglePermissao(key: PermissaoKey) {
    setForm((prev) => {
      const next = { ...prev.permissoes, [key]: !prev.permissoes[key] };
      if (key === "dashboard" && !next.dashboard) next.assistente = false;
      if (key === "assistente" && next.assistente) next.dashboard = true;
      return { ...prev, permissoes: next };
    });
  }

  async function uploadAvatarFor(usuarioId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("context", "perfil");
    fd.append("usuarioId", usuarioId);
    const r = await apiUpload<{ url: string }>("/upload", fd);
    await api(`/usuarios/${usuarioId}`, {
      method: "PATCH",
      body: JSON.stringify({ fotoPerfil: r.url }),
    });
    const me = getStoredUser();
    if (me?.id === usuarioId) patchStoredUser({ fotoPerfil: r.url });
    return r.url;
  }

  async function onAvatarChange(file: File | null) {
    if (!file) return;
    setError("");
    if (!editId) {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingAvatar(file);
      setPendingPreview(URL.createObjectURL(file));
      return;
    }
    setUploading(true);
    try {
      const url = await uploadAvatarFor(editId, file);
      setForm((prev) => ({ ...prev, fotoPerfil: url }));
      setMsg("Foto de perfil atualizada");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    setLastProvisional(null);
    try {
      const payload: Record<string, unknown> = {
        nome: form.nome,
        email: form.email,
        perfil: form.perfil,
        filialIds: form.filialIds,
        filialId: form.filialIds[0] || null,
        receberAlertasEmail: form.receberAlertasEmail,
        alertasEmail: form.alertasEmail,
        permissoes: form.permissoes,
      };
      if (form.perfil === "OPERADOR" && form.filialIds.length === 0) {
        setError("Operador exige ao menos uma filial");
        return;
      }
      if (editId) {
        await api(`/usuarios/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setMsg("Usuário atualizado");
      } else {
        const created = await api<{
          id: string;
          email: string;
          senhaProvisoria: string;
        }>("/usuarios", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (pendingAvatar) {
          setUploading(true);
          try {
            await uploadAvatarFor(created.id, pendingAvatar);
          } catch (uploadErr) {
            setLastProvisional({
              email: created.email,
              senha: created.senhaProvisoria,
            });
            setMsg(
              "Usuário cadastrado, mas a foto falhou. Edite o usuário para tentar de novo."
            );
            setError(
              uploadErr instanceof Error ? uploadErr.message : "Erro no upload"
            );
            resetForm();
            await load();
            return;
          } finally {
            setUploading(false);
          }
        }
        setLastProvisional({
          email: created.email,
          senha: created.senhaProvisoria,
        });
        setMsg(
          "Usuário cadastrado. Senha provisória enviada por e-mail (e exibida abaixo uma vez)."
        );
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  async function toggleAtivo(u: Usuario) {
    await api(`/usuarios/${u.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ativo: !u.ativo }),
    });
    await load();
  }

  async function resetSenhaProvisoria(u: Usuario) {
    if (u.perfil === "ADMIN") return;
    if (
      !confirm(
        `Gerar nova senha provisória para ${u.email} e enviar por e-mail?`
      )
    ) {
      return;
    }
    setError("");
    setMsg("");
    try {
      const r = await api<{ email: string; senhaProvisoria: string }>(
        `/usuarios/${u.id}/senha-provisoria`,
        { method: "POST" }
      );
      setLastProvisional({ email: r.email, senha: r.senhaProvisoria });
      setMsg("Nova senha provisória gerada e enviada por e-mail.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao resetar senha");
    }
  }

  function toggleAlerta(evento: AlertaEvento) {
    setForm((prev) => ({
      ...prev,
      alertasEmail: {
        ...prev.alertasEmail,
        [evento]: !prev.alertasEmail[evento],
      },
    }));
  }

  const avatarSrc =
    pendingPreview || resolveAssetUrl(form.fotoPerfil) || null;
  const isAdminForm = form.perfil === "ADMIN";

  return (
    <>
    <h1 className="text-2xl font-semibold">Usuários e Perfis</h1>
      <p className="mt-1 text-sm text-slate-500">
        Área Admin — criar Gerente e Operador. A senha é provisória: o usuário
        recebe e-mail e troca no primeiro acesso. Defina também foto e o que cada
        pessoa pode ver e fazer.
      </p>

      {lastProvisional && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">Senha provisória (exibida só agora)</p>
          <p className="mt-1">
            {lastProvisional.email} →{" "}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono">
              {lastProvisional.senha}
            </code>
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Também enviada por e-mail (sem SMTP, aparece no log da API).
          </p>
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="mt-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2"
      >
        <input
          placeholder="Nome"
          required
          className="rounded-lg border px-3 py-2"
          value={form.nome}
          onChange={(e) => setForm({ ...form, nome: e.target.value })}
        />
        <input
          placeholder="E-mail"
          type="email"
          required
          className="rounded-lg border px-3 py-2"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <select
          className="rounded-lg border px-3 py-2"
          value={form.perfil}
          onChange={(e) => onPerfilChange(e.target.value as Perfil)}
          disabled={editId !== null && form.perfil === "ADMIN"}
        >
          <option value="GERENTE">GERENTE</option>
          <option value="OPERADOR">OPERADOR</option>
          {form.perfil === "ADMIN" && <option value="ADMIN">ADMIN</option>}
        </select>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
          <p className="text-sm font-medium text-slate-800">
            Filiais{form.perfil === "OPERADOR" ? " *" : ""}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Selecione uma ou mais. A primeira marcada vira a filial principal.
            {form.perfil === "OPERADOR"
              ? " Obrigatório para Operador."
              : " Opcional para Gerente."}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {filiais.map((f) => {
              const checked = form.filialIds.includes(f.id);
              return (
                <label
                  key={f.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setForm((prev) => {
                        const next = checked
                          ? prev.filialIds.filter((id) => id !== f.id)
                          : [...prev.filialIds, f.id];
                        return { ...prev, filialIds: next };
                      });
                    }}
                  />
                  <span>
                    {f.sigla} — {f.nome}
                  </span>
                </label>
              );
            })}
            {filiais.length === 0 && (
              <span className="text-xs text-slate-400">
                Nenhuma filial cadastrada
              </span>
            )}
          </div>
        </div>

        {!editId && (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:col-span-2">
            Ao cadastrar, o sistema gera uma senha provisória, envia e-mail de
            acesso e exige troca no primeiro login. Foto e permissões já podem
            ser definidas aqui.
          </p>
        )}

        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 sm:col-span-2">
          <p className="text-sm font-medium text-slate-800">Foto de perfil</p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarSrc}
                alt=""
                className="h-16 w-16 rounded-full object-cover ring-2 ring-brand/30"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand/15 text-lg font-semibold text-brand">
                {form.nome.slice(0, 1).toUpperCase() || "?"}
              </div>
            )}
            <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50">
              {uploading
                ? "Enviando…"
                : editId
                  ? "Trocar foto"
                  : pendingAvatar
                    ? "Trocar foto selecionada"
                    : "Selecionar foto"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={(e) =>
                  void onAvatarChange(e.target.files?.[0] || null)
                }
              />
            </label>
            {!editId && pendingAvatar && (
              <button
                type="button"
                className="text-sm text-slate-500 hover:underline"
                onClick={clearPendingAvatar}
              >
                Remover
              </button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 sm:col-span-2">
          <p className="text-sm font-medium text-slate-800">
            Acesso a telas e ações
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {isAdminForm
              ? "Admin tem acesso total (área Admin inclusa). Não é editável."
              : form.perfil === "OPERADOR"
                ? "Operador: telas operacionais. Aprovações, cadastros e inventário exigem perfil Gerente."
                : "Marque o que este Gerente pode abrir e executar. Trocar o perfil recarrega os padrões."}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {PERMISSAO_KEYS.map((key) => {
              const editaveis = permissoesEditaveisParaPerfil(form.perfil);
              const locked =
                isAdminForm || !editaveis.includes(key);
              return (
              <label
                key={key}
                className={`flex items-start gap-2 text-sm ${
                  locked ? "opacity-60" : ""
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={Boolean(form.permissoes[key])}
                  disabled={locked}
                  onChange={() => togglePermissao(key)}
                />
                <span>
                  <span className="font-medium">
                    {PERMISSAO_LABELS[key].label}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {PERMISSAO_LABELS[key].descricao}
                    {locked && !isAdminForm
                      ? " (exige Gerente)"
                      : ""}
                  </span>
                </span>
              </label>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 sm:col-span-2">
          <p className="text-sm font-medium text-slate-800">
            Eventos de notificação (inbox / toast)
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Marque os eventos que este usuário vê no sino. O e-mail de alerta é
            opcional abaixo (acesso/senha provisória sempre é enviado).
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {ALERTA_EVENTOS.map((ev) => (
              <label key={ev} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={Boolean(form.alertasEmail[ev])}
                  onChange={() => toggleAlerta(ev)}
                />
                <span>{ALERTA_EVENTO_LABELS[ev]}</span>
              </label>
            ))}
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={form.receberAlertasEmail}
              onChange={(e) =>
                setForm({ ...form, receberAlertasEmail: e.target.checked })
              }
            />
            Também enviar esses eventos por e-mail
          </label>
        </div>

        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        {msg && (
          <p className="text-sm text-emerald-700 sm:col-span-2">{msg}</p>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-white hover:bg-brand-dark"
          >
            {editId ? "Salvar alterações" : "Cadastrar usuário"}
          </button>
          {editId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border px-4 py-2"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Perfil</th>
              <th className="px-3 py-2">Filial</th>
              <th className="px-3 py-2">Senha</th>
              <th className="px-3 py-2">Notificações</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lista.map((u) => {
              const tipos = ALERTA_EVENTOS.filter(
                (ev) => u.alertasEmail?.[ev]
              ).length;
              return (
                <tr key={u.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {resolveAssetUrl(u.fotoPerfil) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resolveAssetUrl(u.fotoPerfil)!}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                          {u.nome.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-medium">{u.nome}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">{u.perfil}</td>
                  <td className="px-3 py-2">
                    {u.filiais && u.filiais.length > 0
                      ? u.filiais.map((f) => f.sigla).join(", ")
                      : u.filial?.sigla || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {u.deveTrocarSenha ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                        Provisória
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">Definida</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {tipos === 0
                      ? "—"
                      : `${tipos} evento(s)${
                          u.receberAlertasEmail ? " + e-mail" : ""
                        }`}
                  </td>
                  <td className="px-3 py-2">{u.ativo ? "Ativo" : "Inativo"}</td>
                  <td className="space-x-3 whitespace-nowrap px-3 py-2">
                    <button
                      type="button"
                      onClick={() => startEdit(u)}
                      className="text-brand hover:underline"
                    >
                      Editar
                    </button>
                    {u.perfil !== "ADMIN" && (
                      <button
                        type="button"
                        onClick={() => void resetSenhaProvisoria(u)}
                        className="text-brand hover:underline"
                      >
                        Reset senha
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleAtivo(u)}
                      className="text-brand hover:underline"
                    >
                      {u.ativo ? "Desativar" : "Ativar"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
