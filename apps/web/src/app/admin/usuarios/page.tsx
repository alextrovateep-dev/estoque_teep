"use client";

import { api, getStoredUser } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";
import { ALERTA_EVENTOS, AlertaEvento, PermissoesUsuario } from "@teep/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

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

function perfilLabel(perfil: string): string {
  if (perfil === "ADMIN") return "Admin";
  if (perfil === "GERENTE") return "Gerente";
  if (perfil === "OPERADOR") return "Operador";
  return perfil;
}

export default function UsuariosPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-slate-500">Carregando…</p>}
    >
      <UsuariosPageInner />
    </Suspense>
  );
}

function UsuariosPageInner() {
  const searchParams = useSearchParams();
  const [lista, setLista] = useState<Usuario[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const feedbackRef = useRef<HTMLDivElement | null>(null);
  const [lastProvisional, setLastProvisional] = useState<{
    email: string;
    senha: string;
  } | null>(null);

  function showFeedback(message: string) {
    setMsg(message);
    requestAnimationFrame(() => {
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function load() {
    setLista(await api<Usuario[]>("/usuarios"));
  }

  useEffect(() => {
    load().catch((e) =>
      setError(e instanceof Error ? e.message : "Erro ao carregar")
    );
  }, []);

  useEffect(() => {
    const ok = searchParams.get("ok");
    if (ok === "criado") setMsg("Usuário cadastrado");
    else if (ok === "atualizado") setMsg("Usuário atualizado");
  }, [searchParams]);

  async function toggleAtivo(u: Usuario) {
    setError("");
    setMsg("");
    setLastProvisional(null);
    try {
      await api(`/usuarios/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativo: !u.ativo }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  async function toggleAdminAccess(u: Usuario, grant: boolean) {
    const self = getStoredUser();
    if (!grant && u.id === self?.id) {
      setError("Você não pode revogar seu próprio acesso administrador.");
      return;
    }
    const ok = grant
      ? confirm(
          `Conceder acesso administrador a ${u.nome}? Terá acesso total ao sistema.`
        )
      : confirm(
          `Revogar acesso administrador de ${u.nome}? Voltará ao perfil anterior (Gerente ou Operador).`
        );
    if (!ok) return;
    setError("");
    setMsg("");
    try {
      await api(`/usuarios/${u.id}/admin-access`, {
        method: "POST",
        body: JSON.stringify(grant ? { admin: true } : { admin: false }),
      });
      showFeedback(
        grant
          ? `${u.nome} agora é administrador.`
          : `Acesso administrador revogado de ${u.nome}.`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  async function resetSenhaProvisoria(u: Usuario) {
    const self = getStoredUser();
    if (u.perfil === "ADMIN" && u.id === self?.id) {
      setError(
        "Para sua senha de admin, use Perfil → trocar senha (ou outro administrador pode resetar)."
      );
      return;
    }
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
      showFeedback(
        `Nova senha provisória gerada para ${r.email} e enviada por e-mail.`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao resetar senha");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Usuários e Perfis</h1>
          <p className="mt-1 text-sm text-slate-500">
            Cadastre Gerente ou Operador. Administrador = mesma conta, com
            acesso total (botão &quot;Tornar admin&quot;). Senha provisória no
            primeiro acesso.
          </p>
        </div>
        <Link
          href="/admin/usuarios/novo"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          Cadastrar
        </Link>
      </div>

      <div ref={feedbackRef} className="mt-4 space-y-3">
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

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Perfil</th>
              <th className="px-3 py-2">Estoque</th>
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
                  <td className="px-3 py-2">{perfilLabel(u.perfil)}</td>
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
                    <Link
                      href={`/admin/usuarios/${u.id}`}
                      className="text-brand hover:underline"
                    >
                      Editar
                    </Link>
                    {u.perfil !== "ADMIN" ? (
                      <>
                        {u.ativo && (
                          <button
                            type="button"
                            onClick={() => void toggleAdminAccess(u, true)}
                            className="text-violet-700 hover:underline"
                          >
                            Tornar admin
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void resetSenhaProvisoria(u)}
                          className="text-brand hover:underline"
                        >
                          Reset senha
                        </button>
                      </>
                    ) : (
                      u.id !== getStoredUser()?.id && (
                        <>
                          <button
                            type="button"
                            onClick={() => void toggleAdminAccess(u, false)}
                            className="text-violet-700 hover:underline"
                            title="Volta ao perfil Gerente"
                          >
                            Revogar admin
                          </button>
                          <button
                            type="button"
                            onClick={() => void resetSenhaProvisoria(u)}
                            className="text-brand hover:underline"
                          >
                            Reset senha
                          </button>
                        </>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => void toggleAtivo(u)}
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
