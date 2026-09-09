"use client";

import { api, apiUpload, getStoredUser, patchStoredUser } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";
import {
  ALERTA_EVENTOS,
  ALERTA_EVENTO_LABELS,
  AlertaEvento,
  CADASTROS_PAGINAS,
  CadastrosPaginaId,
  DASHBOARD_KPI_KEYS,
  PERMISSAO_KEYS,
  PERMISSAO_LABELS,
  PermissaoKey,
  PermissoesUsuario,
  defaultPermissoes,
  Perfil,
} from "@teep/shared";
import { permissoesEditaveisParaPerfil } from "@/lib/access";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

const CADASTRO_KEYS = new Set<string>(
  CADASTROS_PAGINAS.flatMap((p) => [p.ver, p.editar])
);

const KPI_KEYS = new Set<string>(DASHBOARD_KPI_KEYS);

/** Keys simples (páginas de cadastro e KPIs do dashboard têm UI própria). */
const PERMISSAO_KEYS_LISTA = PERMISSAO_KEYS.filter(
  (k) => !CADASTRO_KEYS.has(k) && !KPI_KEYS.has(k)
);

function SectionCard({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm ${className}`}
    >
      <header className="mb-2.5 border-b border-slate-100 pb-1.5">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            {subtitle}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

function ToggleRow({
  checked,
  disabled,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
        disabled
          ? "cursor-not-allowed border-slate-100 bg-slate-50/60 opacity-55"
          : checked
            ? "border-brand/30 bg-brand/5"
            : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{title}</span>
        {hint && (
          <span className="mt-0.5 block text-xs leading-snug text-slate-500">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

type Filial = {
  id: string;
  nome: string;
  sigla: string;
  ativo?: boolean;
};

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

const emptyForm = {
  nome: "",
  email: "",
  perfil: "OPERADOR" as Perfil,
  filialIds: [] as string[],
  receberAlertasEmail: false,
  alertasEmail: emptyAlertas(),
  fotoPerfil: null as string | null,
  permissoes: defaultPermissoes("OPERADOR"),
};

export function UsuarioCadastroForm({ usuarioId }: { usuarioId?: string }) {
  const router = useRouter();
  const editId = usuarioId || null;
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [lastProvisional, setLastProvisional] = useState<{
    email: string;
    senha: string;
  } | null>(null);
  const [createdDone, setCreatedDone] = useState(false);
  const [revokePerfil, setRevokePerfil] = useState<"GERENTE" | "OPERADOR">(
    "GERENTE"
  );
  const [adminBusy, setAdminBusy] = useState(false);
  const [usuarioAtivo, setUsuarioAtivo] = useState(true);
  const [cadastrosExpandidos, setCadastrosExpandidos] = useState<
    Partial<Record<CadastrosPaginaId, boolean>>
  >({});
  const paginaRefs = useRef<
    Partial<Record<CadastrosPaginaId, HTMLInputElement | null>>
  >({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setError("");

    async function load() {
      const f = await api<Filial[]>("/filiais?ativas=0");
      if (cancelled) return;
      setFiliais(f);

      if (!editId) {
        setForm(emptyForm);
        return;
      }

      const u = await api<Usuario>(`/usuarios/${editId}`);
      if (cancelled) return;
      const perfil = (u.perfil as Perfil) || "OPERADOR";
      setUsuarioAtivo(u.ativo);
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
    }

    load()
      .catch((e) => {
        if (cancelled) return;
        if (editId) {
          setLoadFailed(true);
          setError(e instanceof Error ? e.message : "Usuário não encontrado");
        } else {
          setError(e instanceof Error ? e.message : "Erro ao carregar");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editId]);

  function clearPendingAvatar() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingAvatar(null);
    setPendingPreview(null);
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
      if (key === "dashboard" && !next.dashboard) {
        next.assistente = false;
        for (const k of DASHBOARD_KPI_KEYS) next[k] = false;
      }
      if (key === "dashboard" && next.dashboard) {
        for (const k of DASHBOARD_KPI_KEYS) next[k] = true;
      }
      if (key === "assistente" && next.assistente) next.dashboard = true;
      if (
        (DASHBOARD_KPI_KEYS as readonly string[]).includes(key) &&
        next[key]
      ) {
        next.dashboard = true;
      }
      for (const p of CADASTROS_PAGINAS) {
        if (key === p.ver && !next[p.ver]) next[p.editar] = false;
        if (key === p.editar && next[p.editar]) next[p.ver] = true;
      }
      return { ...prev, permissoes: next };
    });
  }

  function togglePaginaFull(paginaId: CadastrosPaginaId) {
    const pagina = CADASTROS_PAGINAS.find((p) => p.id === paginaId);
    if (!pagina) return;
    setForm((prev) => {
      const full = prev.permissoes[pagina.ver] && prev.permissoes[pagina.editar];
      const on = !full;
      return {
        ...prev,
        permissoes: {
          ...prev.permissoes,
          [pagina.ver]: on,
          [pagina.editar]: on,
        },
      };
    });
  }

  useEffect(() => {
    for (const p of CADASTROS_PAGINAS) {
      const ver = form.permissoes[p.ver];
      const editar = form.permissoes[p.editar];
      const parcial = ver && !editar;
      const el = paginaRefs.current[p.id];
      if (el) el.indeterminate = parcial;
      if (parcial) {
        setCadastrosExpandidos((prev) =>
          prev[p.id] ? prev : { ...prev, [p.id]: true }
        );
      }
    }
  }, [form.permissoes]);

  function toggleAlerta(evento: AlertaEvento) {
    setForm((prev) => ({
      ...prev,
      alertasEmail: {
        ...prev.alertasEmail,
        [evento]: !prev.alertasEmail[evento],
      },
    }));
  }

  async function uploadAvatarFor(usuarioIdUpload: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("context", "perfil");
    fd.append("usuarioId", usuarioIdUpload);
    const r = await apiUpload<{ url: string }>("/upload", fd);
    await api(`/usuarios/${usuarioIdUpload}`, {
      method: "PATCH",
      body: JSON.stringify({ fotoPerfil: r.url }),
    });
    const me = getStoredUser();
    if (me?.id === usuarioIdUpload) patchStoredUser({ fotoPerfil: r.url });
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
      setMsg("Foto de perfil atualizada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  }

  async function reloadUsuario() {
    if (!editId) return;
    const u = await api<Usuario>(`/usuarios/${editId}`);
    const perfil = (u.perfil as Perfil) || "OPERADOR";
    setUsuarioAtivo(u.ativo);
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
  }

  async function concederAdmin() {
    if (!editId || form.perfil === "ADMIN") return;
    if (
      !confirm(
        `Conceder acesso administrador a ${form.nome.trim() || form.email}? O usuário terá acesso total ao sistema.`
      )
    ) {
      return;
    }
    setError("");
    setMsg("");
    setAdminBusy(true);
    try {
      await api(`/usuarios/${editId}/admin-access`, {
        method: "POST",
        body: JSON.stringify({ admin: true }),
      });
      await reloadUsuario();
      setMsg("Acesso administrador concedido.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao conceder admin");
    } finally {
      setAdminBusy(false);
    }
  }

  async function revogarAdmin() {
    if (!editId || form.perfil !== "ADMIN") return;
    const self = getStoredUser();
    if (self?.id === editId) {
      setError("Você não pode revogar seu próprio acesso administrador.");
      return;
    }
    if (
      revokePerfil === "OPERADOR" &&
      form.filialIds.length === 0
    ) {
      setError("Para revogar como Operador, vincule ao menos um estoque antes.");
      return;
    }
    if (
      !confirm(
        `Revogar acesso administrador de ${form.nome.trim() || form.email}? O perfil voltará a ${revokePerfil === "GERENTE" ? "Gerente" : "Operador"}.`
      )
    ) {
      return;
    }
    setError("");
    setMsg("");
    setAdminBusy(true);
    try {
      await api(`/usuarios/${editId}/admin-access`, {
        method: "POST",
        body: JSON.stringify({ admin: false, perfil: revokePerfil }),
      });
      await reloadUsuario();
      setMsg("Acesso administrador revogado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao revogar admin");
    } finally {
      setAdminBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    setLastProvisional(null);
    if (form.perfil === "OPERADOR" && form.filialIds.length === 0) {
      setError("Operador exige ao menos um estoque");
      return;
    }
    const nomeCadastro = form.nome.trim();
    setSaving(true);
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
      if (editId) {
        await api(`/usuarios/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        router.push("/admin/usuarios?ok=atualizado");
      } else {
        const created = await api<{
          id: string;
          email: string;
          nome?: string;
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
            clearPendingAvatar();
            setLastProvisional({
              email: created.email,
              senha: created.senhaProvisoria,
            });
            setError(
              uploadErr instanceof Error ? uploadErr.message : "Erro no upload"
            );
            setMsg(
              `Usuário cadastrado no banco: ${created.nome || nomeCadastro} (${created.email}). A foto falhou — edite o usuário para tentar de novo.`
            );
            setCreatedDone(true);
            return;
          } finally {
            setUploading(false);
          }
        }
        clearPendingAvatar();
        setLastProvisional({
          email: created.email,
          senha: created.senhaProvisoria,
        });
        setMsg(
          `Usuário cadastrado com sucesso: ${created.nome || nomeCadastro} (${created.email}). Senha provisória enviada por e-mail e exibida abaixo uma vez.`
        );
        setCreatedDone(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar usuário");
    } finally {
      setSaving(false);
    }
  }

  const avatarSrc =
    pendingPreview || resolveAssetUrl(form.fotoPerfil) || null;
  const isAdminForm = form.perfil === "ADMIN";
  const selfId = getStoredUser()?.id;
  const isSelf = Boolean(editId && selfId && editId === selfId);
  /** Ativas + já vinculadas (mesmo se inativas), para não sumir no editar. */
  const filiaisForm = filiais.filter(
    (f) => f.ativo !== false || form.filialIds.includes(f.id)
  );

  if (loading) {
    return <p className="mt-4 text-sm text-slate-500">Carregando…</p>;
  }

  if (loadFailed) {
    return (
      <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold">Editar usuário</h1>
          <Link
            href="/admin/usuarios"
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
          >
            Voltar à lista
          </Link>
        </div>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error || "Usuário não encontrado"}
        </p>
      </>
    );
  }

  if (createdDone) {
    return (
      <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Usuário cadastrado</h1>
            <p className="mt-1 text-sm text-slate-500">
              Anote a senha provisória — ela só é exibida agora.
            </p>
          </div>
          <Link
            href="/admin/usuarios?ok=criado"
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
          >
            Voltar à lista
          </Link>
        </div>

        <div className="mt-4 space-y-3">
          {msg && (
            <div
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
              role="status"
              aria-live="polite"
            >
              <p className="font-medium">{msg}</p>
            </div>
          )}
          {lastProvisional && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
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
          {error && (
            <div
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              role="alert"
            >
              {error}
            </div>
          )}
        </div>

        <div className="mt-6">
          <Link
            href="/admin/usuarios?ok=criado"
            className="inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
          >
            Ir para a lista
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {editId ? "Editar usuário" : "Cadastrar usuário"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Cadastre Gerente ou Operador. Acesso administrador é concedido
            depois, na edição do usuário.
          </p>
        </div>
        <Link
          href="/admin/usuarios"
          className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
        >
          Voltar à lista
        </Link>
      </div>

      <div className="mt-4 space-y-3">
        {msg && (
          <div
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
            role="status"
            aria-live="polite"
          >
            <p className="font-medium">{msg}</p>
          </div>
        )}
        {error && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        <SectionCard
          title="Identidade"
          subtitle={
            !editId
              ? "Ao cadastrar, o sistema gera senha provisória, envia e-mail e exige troca no primeiro login."
              : undefined
          }
        >
          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Nome</span>
              <input
                required
                placeholder="Nome completo"
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                E-mail
              </span>
              <input
                type="email"
                required
                placeholder="usuario@empresa.com"
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label className="block text-sm sm:max-w-xs">
              <span className="mb-1 block font-medium text-slate-700">
                Perfil
              </span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.perfil}
                onChange={(e) => onPerfilChange(e.target.value as Perfil)}
                disabled={editId !== null && form.perfil === "ADMIN"}
              >
                <option value="GERENTE">Gerente</option>
                <option value="OPERADOR">Operador</option>
                {form.perfil === "ADMIN" && (
                  <option value="ADMIN">Admin</option>
                )}
              </select>
            </label>
          </div>
        </SectionCard>

        {editId && (
          <section className="rounded-xl border border-violet-200 bg-violet-50 p-3.5 shadow-sm">
            <header className="mb-2.5 border-b border-violet-200/80 pb-1.5">
              <h2 className="text-sm font-semibold text-violet-950">
                Acesso administrador
              </h2>
              <p className="mt-0.5 text-xs leading-relaxed text-violet-900/80">
                {isAdminForm
                  ? `Acesso total (Administração, usuários, e-mails, estoques).${
                      isSelf
                        ? " Você não pode revogar o próprio acesso por aqui."
                        : ""
                    }`
                  : `Concede menu Administração e acesso total. E-mail e senha não mudam.${
                      !usuarioAtivo
                        ? " Ative o usuário antes de conceder administrador."
                        : ""
                    }`}
              </p>
            </header>
            {isAdminForm ? (
              !isSelf && (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-violet-950">
                      Perfil após revogar
                    </span>
                    <select
                      className="rounded-lg border border-violet-200 bg-white px-3 py-2"
                      value={revokePerfil}
                      onChange={(e) =>
                        setRevokePerfil(
                          e.target.value as "GERENTE" | "OPERADOR"
                        )
                      }
                      disabled={adminBusy}
                    >
                      <option value="GERENTE">Gerente</option>
                      <option value="OPERADOR">Operador</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void revogarAdmin()}
                    disabled={adminBusy}
                    className="rounded-lg border border-violet-300 bg-white px-4 py-2 text-sm font-medium text-violet-950 hover:bg-violet-100 disabled:opacity-50"
                  >
                    {adminBusy ? "Aguarde…" : "Revogar acesso administrador"}
                  </button>
                </div>
              )
            ) : (
              <button
                type="button"
                onClick={() => void concederAdmin()}
                disabled={adminBusy || !usuarioAtivo}
                className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
              >
                {adminBusy ? "Aguarde…" : "Conceder acesso administrador"}
              </button>
            )}
          </section>
        )}

        <SectionCard
          title={
            form.perfil === "OPERADOR" ? "Estoques *" : "Estoques"
          }
          subtitle={
            form.perfil === "OPERADOR"
              ? "Obrigatório. O primeiro marcado é o estoque principal; o Operador só opera nos marcados."
              : "Opcional para Gerente (vê todos os estoques ativos). O primeiro marcado é o principal."
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {filiaisForm.map((f) => {
              const checked = form.filialIds.includes(f.id);
              return (
                <ToggleRow
                  key={f.id}
                  checked={checked}
                  title={`${f.sigla} — ${f.nome}`}
                  hint={f.ativo === false ? "Estoque inativo" : undefined}
                  onChange={(on) => {
                    setForm((prev) => {
                      const has = prev.filialIds.includes(f.id);
                      if (on === has) return prev;
                      return {
                        ...prev,
                        filialIds: on
                          ? [...prev.filialIds, f.id]
                          : prev.filialIds.filter((id) => id !== f.id),
                      };
                    });
                  }}
                />
              );
            })}
          </div>
          {filiaisForm.length === 0 && (
            <p className="text-xs text-slate-400">Nenhum estoque cadastrado</p>
          )}
        </SectionCard>

        <SectionCard title="Foto de perfil">
          <div className="flex flex-wrap items-center gap-4">
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
        </SectionCard>

        <SectionCard
          title="Acesso a telas e ações"
          subtitle={
            isAdminForm
              ? "Admin tem acesso total (área Admin inclusa). Não é editável."
              : form.perfil === "OPERADOR"
                ? "Telas operacionais. Aprovações, cadastros e inventário exigem perfil Gerente."
                : "Marque a página para liberar tudo; use Detalhar para só consultar ou só cadastrar."
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMISSAO_KEYS_LISTA.map((key) => {
              const editaveis = permissoesEditaveisParaPerfil(form.perfil);
              const locked = isAdminForm || !editaveis.includes(key);
              return (
                <div
                  key={key}
                  className={`space-y-1.5 ${
                    key === "dashboard" ? "sm:col-span-2" : ""
                  }`}
                >
                  <ToggleRow
                    checked={Boolean(form.permissoes[key])}
                    disabled={locked}
                    title={PERMISSAO_LABELS[key].label}
                    hint={`${PERMISSAO_LABELS[key].descricao}${
                      locked && !isAdminForm ? " (exige Gerente)" : ""
                    }`}
                    onChange={() => togglePermissao(key)}
                  />
                  {key === "dashboard" && (
                    <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Cards do Dashboard
                      </p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {DASHBOARD_KPI_KEYS.map((kpi) => {
                          const kpiLocked =
                            locked ||
                            isAdminForm ||
                            !editaveis.includes(kpi) ||
                            !form.permissoes.dashboard;
                          return (
                            <ToggleRow
                              key={kpi}
                              checked={Boolean(form.permissoes[kpi])}
                              disabled={kpiLocked}
                              title={PERMISSAO_LABELS[kpi].label}
                              hint={PERMISSAO_LABELS[kpi].descricao}
                              onChange={() => togglePermissao(kpi)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Páginas de cadastro
            </p>
            {CADASTROS_PAGINAS.map((pagina) => {
              const editaveis = permissoesEditaveisParaPerfil(form.perfil);
              const locked =
                isAdminForm || !editaveis.includes(pagina.ver);
              const ver = Boolean(form.permissoes[pagina.ver]);
              const editar = Boolean(form.permissoes[pagina.editar]);
              const full = ver && editar;
              const aberto = Boolean(cadastrosExpandidos[pagina.id]);
              const resumo = !ver
                ? "Sem acesso a esta página"
                : full
                  ? "Consulta e cadastro liberados"
                  : "Só consulta — não cadastra";
              return (
                <div
                  key={pagina.id}
                  className={`rounded-lg border ${
                    locked
                      ? "border-slate-100 bg-slate-50/60 opacity-55"
                      : full || ver
                        ? "border-brand/30 bg-brand/5"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <input
                      ref={(el) => {
                        paginaRefs.current[pagina.id] = el;
                      }}
                      type="checkbox"
                      className="mt-0.5"
                      checked={full}
                      disabled={locked}
                      onChange={() => togglePaginaFull(pagina.id)}
                      aria-label={`${pagina.label} — liberar página`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">
                          {pagina.label}
                        </span>
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            setCadastrosExpandidos((prev) => ({
                              ...prev,
                              [pagina.id]: !prev[pagina.id],
                            }))
                          }
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/10 disabled:opacity-50"
                          aria-expanded={aberto}
                        >
                          {aberto ? "Recolher" : "Detalhar"}
                        </button>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {resumo}
                        {locked && !isAdminForm ? " (exige Gerente)" : ""}
                      </p>
                    </div>
                  </div>
                  {aberto && (
                    <div className="grid gap-2 border-t border-slate-100 px-3 py-2.5 sm:grid-cols-2">
                      <ToggleRow
                        checked={ver}
                        disabled={locked}
                        title="Consultar"
                        hint={`Abrir a página ${pagina.label.toLowerCase()}`}
                        onChange={() => togglePermissao(pagina.ver)}
                      />
                      <ToggleRow
                        checked={editar}
                        disabled={
                          isAdminForm || !editaveis.includes(pagina.editar)
                        }
                        title="Cadastrar / editar"
                        hint="Botões de criar e alterar nesta página"
                        onChange={() => togglePermissao(pagina.editar)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="Notificações"
          subtitle="Eventos no sino e em toast. Senha provisória sempre vai por e-mail (fora desta lista)."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {ALERTA_EVENTOS.map((ev) => (
              <ToggleRow
                key={ev}
                checked={Boolean(form.alertasEmail[ev])}
                title={ALERTA_EVENTO_LABELS[ev]}
                onChange={() => toggleAlerta(ev)}
              />
            ))}
          </div>
          <div className="mt-3">
            <ToggleRow
              checked={form.receberAlertasEmail}
              title="Também enviar esses eventos por e-mail"
              hint="Envia e-mail dos eventos marcados (estoque, preço, transferência, RMA). Alerta de retorno usa a lista do lançamento."
              onChange={(on) =>
                setForm({ ...form, receberAlertasEmail: on })
              }
            />
          </div>
        </SectionCard>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={saving || uploading}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving
              ? editId
                ? "Salvando…"
                : "Cadastrando…"
              : editId
                ? "Salvar alterações"
                : "Cadastrar usuário"}
          </button>
          <Link
            href="/admin/usuarios"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </>
  );
}
