"use client";

import { api } from "@/lib/api";
import { FormEvent, ReactNode, useEffect, useState } from "react";

type Tipo = {
  id: string;
  nome: string;
  operacao: "ENTRADA" | "SAIDA" | "TRANSFERENCIA";
  sistema: boolean;
  ativo: boolean;
  requerCliente: boolean;
  requerAprovacao: boolean;
  permitidoOperador: boolean;
  permitidoGerente: boolean;
  geraAlertaRetorno?: boolean;
  diasAlerta?: number[] | null;
  ehRetornoDeId?: string | null;
  requerTermoComodato?: boolean;
  descricao?: string | null;
};

const emptyForm = {
  nome: "",
  operacao: "" as "" | Tipo["operacao"],
  requerCliente: false,
  requerAprovacao: false,
  permitidoOperador: false,
  permitidoGerente: true,
  geraAlertaRetorno: false,
  diasAlerta: "15,30,45,60",
  ehRetornoDeId: "" as string,
  requerTermoComodato: false,
  descricao: "",
};

const OPERACOES: Array<{
  value: Tipo["operacao"];
  label: string;
  hint: string;
  tone: string;
  active: string;
}> = [
  {
    value: "ENTRADA",
    label: "Entrada",
    hint: "Entra em 1 estoque",
    tone: "border-emerald-200 bg-emerald-50/50 text-emerald-900",
    active: "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200",
  },
  {
    value: "SAIDA",
    label: "Saída",
    hint: "Sai de 1 estoque",
    tone: "border-rose-200 bg-rose-50/50 text-rose-900",
    active: "border-rose-500 bg-rose-50 ring-2 ring-rose-200",
  },
  {
    value: "TRANSFERENCIA",
    label: "Transferência",
    hint: "Sai de A → entra em B",
    tone: "border-amber-200 bg-amber-50/50 text-amber-950",
    active: "border-amber-500 bg-amber-50 ring-2 ring-amber-200",
  },
];

function parseDias(s: string): number[] {
  return s
    .split(/[,;\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 365);
}

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

function FlagChip({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "emerald" | "rose" | "amber" | "brand";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-800",
    rose: "bg-rose-100 text-rose-800",
    amber: "bg-amber-100 text-amber-900",
    brand: "bg-brand/10 text-brand",
  };
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export default function TiposPage() {
  const [lista, setLista] = useState<Tipo[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);

  async function load() {
    setLista(await api<Tipo[]>("/tipos-movimentacao"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.operacao) {
      setError("Selecione a natureza (Entrada, Saída ou Transferência)");
      return;
    }
    try {
      const dias = parseDias(form.diasAlerta);
      const precisaCliente =
        form.requerCliente ||
        form.geraAlertaRetorno ||
        Boolean(form.ehRetornoDeId) ||
        form.requerTermoComodato;
      const body = {
        nome: form.nome,
        operacao: form.operacao,
        requerCliente: precisaCliente,
        requerAprovacao: form.requerAprovacao,
        permitidoOperador: form.permitidoOperador,
        permitidoGerente: form.permitidoGerente,
        geraAlertaRetorno: form.geraAlertaRetorno,
        diasAlerta: form.geraAlertaRetorno
          ? dias.length
            ? dias
            : [15, 30, 45, 60]
          : [15, 30, 45, 60],
        ehRetornoDeId: form.ehRetornoDeId || null,
        requerTermoComodato: form.requerTermoComodato,
        descricao: form.descricao || null,
      };
      if (editId) {
        await api(`/tipos-movimentacao/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api("/tipos-movimentacao", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      setForm(emptyForm);
      setEditId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  function startEdit(t: Tipo) {
    if (t.sistema) return;
    setEditId(t.id);
    const dias = Array.isArray(t.diasAlerta)
      ? t.diasAlerta.join(",")
      : "15,30,45,60";
    setForm({
      nome: t.nome,
      operacao: t.operacao,
      requerCliente: t.requerCliente,
      requerAprovacao: t.requerAprovacao,
      permitidoOperador: t.permitidoOperador,
      permitidoGerente: t.permitidoGerente,
      geraAlertaRetorno: Boolean(t.geraAlertaRetorno),
      diasAlerta: dias,
      ehRetornoDeId: t.ehRetornoDeId || "",
      requerTermoComodato: Boolean(t.requerTermoComodato),
      descricao: t.descricao || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggle(t: Tipo) {
    await api(`/tipos-movimentacao/${t.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ativo: !t.ativo }),
    });
    await load();
  }

  function setOperacao(operacao: Tipo["operacao"]) {
    if (editId) return;
    setForm({
      ...form,
      operacao,
      requerAprovacao: form.requerAprovacao,
      geraAlertaRetorno:
        operacao === "SAIDA" ? form.geraAlertaRetorno : false,
      ehRetornoDeId: operacao === "ENTRADA" ? form.ehRetornoDeId : "",
      requerTermoComodato:
        operacao === "SAIDA" ? form.requerTermoComodato : false,
    });
  }

  const saidasParaRetorno = lista.filter(
    (t) =>
      t.operacao === "SAIDA" &&
      t.ativo &&
      !t.sistema &&
      t.geraAlertaRetorno &&
      t.id !== editId
  );

  const isSaida = form.operacao === "SAIDA";
  const isEntrada = form.operacao === "ENTRADA";

  return (
    <>
    <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Tipos de Movimentação
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Cada tipo define se o produto entra, sai ou transfere entre
            estoques. Use os blocos de Demo/Comodato para alertas e vínculo de
            retorno.
          </p>
        </div>
        {editId && (
          <span className="rounded-lg border border-brand/20 bg-brand/5 px-3 py-1.5 text-xs font-medium text-brand">
            Editando tipo existente
          </span>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        <SectionCard
          title="Identidade"
          subtitle="Informe o nome e escolha a natureza do movimento."
        >
          <div className="space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="block min-w-0">
                <span className="mb-1 block text-sm font-medium">Nome</span>
                <input
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex: Saída Demonstração"
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-sm font-medium">
                  Descrição{" "}
                  <span className="font-normal text-slate-400">(opcional)</span>
                </span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  value={form.descricao}
                  onChange={(e) =>
                    setForm({ ...form, descricao: e.target.value })
                  }
                  placeholder="Como este tipo aparece para a equipe"
                />
              </label>
            </div>

            <div>
              <span className="mb-1.5 block text-sm font-medium">
                Natureza <span className="font-normal text-rose-600">*</span>
              </span>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                {OPERACOES.map((op) => {
                  const selected = form.operacao === op.value;
                  return (
                    <button
                      key={op.value}
                      type="button"
                      disabled={!!editId}
                      onClick={() => setOperacao(op.value)}
                      className={`rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${
                        selected
                          ? op.active
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span className="block text-xs font-semibold">
                        {op.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-tight opacity-80">
                        {op.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!editId && !form.operacao && (
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Selecione uma opção.
                </p>
              )}
              {editId && (
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Natureza travada após criar.
                </p>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Regras do lançamento"
          subtitle="Exigências no formulário de Novo Lançamento."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              checked={form.requerCliente}
              onChange={(v) => setForm({ ...form, requerCliente: v })}
              title="Requer cliente / fornecedor"
              hint="Mostra seletor de cliente e campos de NF."
            />
            <ToggleRow
              checked={form.requerAprovacao}
              onChange={(v) => setForm({ ...form, requerAprovacao: v })}
              title="Requer aprovação"
              hint={
                form.operacao === "TRANSFERENCIA"
                  ? "Operador cria carga PENDENTE; Gerente/Admin aprovam antes de sair o estoque."
                  : "Operador gera PENDENTE; Gerente/Admin aprovam."
              }
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Quem pode lançar"
          subtitle="Visibilidade no seletor de tipo por perfil."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              checked={form.permitidoOperador}
              onChange={(v) => setForm({ ...form, permitidoOperador: v })}
              title="Operador"
              hint="Aparece para perfil OPERADOR."
            />
            <ToggleRow
              checked={form.permitidoGerente}
              onChange={(v) => setForm({ ...form, permitidoGerente: v })}
              title="Gerente / Admin"
              hint="Aparece para GERENTE e ADMIN."
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Demo / Comodato"
          subtitle="Alertas de retorno, termo e vínculo saída ↔ retorno."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              checked={form.geraAlertaRetorno}
              disabled={!isSaida}
              onChange={(v) =>
                setForm({
                  ...form,
                  geraAlertaRetorno: v,
                  requerCliente: v ? true : form.requerCliente,
                })
              }
              title="Gera alertas de retorno"
              hint={
                isSaida
                  ? "Agenda e-mails/inbox nos dias abaixo (calendário SP)."
                  : "Disponível apenas para natureza Saída."
              }
            />
            <ToggleRow
              checked={form.requerTermoComodato}
              disabled={!isSaida}
              onChange={(v) =>
                setForm({
                  ...form,
                  requerTermoComodato: v,
                  requerCliente: v ? true : form.requerCliente,
                })
              }
              title="Exige termo de comodato"
              hint={
                isSaida
                  ? "Marca a saída para receber o termo assinado depois (Movimentações)."
                  : "Disponível apenas para natureza Saída."
              }
            />
            <label
              className={`block rounded-lg border px-3 py-2.5 ${
                form.geraAlertaRetorno
                  ? "border-slate-200 bg-white"
                  : "border-slate-100 bg-slate-50/60 opacity-55"
              }`}
            >
              <span className="mb-1 block text-sm font-medium">
                Dias de alerta
              </span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-slate-50"
                value={form.diasAlerta}
                disabled={!form.geraAlertaRetorno}
                onChange={(e) =>
                  setForm({ ...form, diasAlerta: e.target.value })
                }
                placeholder="15,30,45,60"
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                Separe por vírgula (ex.: 15,30,45,60).
              </span>
            </label>
            <label
              className={`block rounded-lg border px-3 py-2.5 ${
                isEntrada
                  ? "border-slate-200 bg-white"
                  : "border-slate-100 bg-slate-50/60 opacity-55"
              }`}
            >
              <span className="mb-1 block text-sm font-medium">
                É retorno de (tipo de saída)
              </span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-slate-50"
                value={form.ehRetornoDeId}
                disabled={!isEntrada}
                onChange={(e) =>
                  setForm({
                    ...form,
                    ehRetornoDeId: e.target.value,
                    requerCliente: e.target.value ? true : form.requerCliente,
                  })
                }
              >
                <option value="">— Não é retorno vinculado —</option>
                {saidasParaRetorno.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-slate-500">
                {isEntrada
                  ? saidasParaRetorno.length
                    ? "Lista só saídas com alerta de retorno (Demo/Comodato)."
                    : "Nenhuma saída com alerta cadastrada ainda."
                  : "Disponível apenas para natureza Entrada."}
              </span>
            </label>
          </div>
        </SectionCard>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-95"
          >
            {editId ? "Salvar alterações" : "Cadastrar tipo"}
          </button>
          {editId && (
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setEditId(null);
                setForm(emptyForm);
              }}
            >
              Cancelar edição
            </button>
          )}
          <span className="ml-auto text-xs text-slate-400">
            Alertas / termo / vínculo forçam “requer cliente”.
          </span>
        </div>
      </form>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              Tipos cadastrados
            </h2>
            <p className="text-xs text-slate-500">
              {lista.length} tipo{lista.length === 1 ? "" : "s"} · clique em
              Editar para carregar no formulário acima
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Nome</th>
                <th className="px-3 py-2.5 font-medium">Natureza</th>
                <th className="px-3 py-2.5 font-medium">Flags</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {lista.map((t) => {
                const origemNome = t.ehRetornoDeId
                  ? lista.find((x) => x.id === t.ehRetornoDeId)?.nome
                  : null;
                const opTone =
                  t.operacao === "ENTRADA"
                    ? "emerald"
                    : t.operacao === "SAIDA"
                      ? "rose"
                      : "amber";
                return (
                  <tr
                    key={t.id}
                    className={`border-t border-slate-100 ${
                      editId === t.id ? "bg-brand/[0.03]" : ""
                    } ${!t.ativo ? "opacity-60" : ""}`}
                  >
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium text-slate-800">{t.nome}</div>
                      {t.sistema && (
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          Sistema
                        </div>
                      )}
                      {t.descricao && (
                        <div className="mt-0.5 max-w-xs text-xs text-slate-500">
                          {t.descricao}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <FlagChip tone={opTone}>
                        {t.operacao === "TRANSFERENCIA"
                          ? "TRANSF. A→B"
                          : t.operacao}
                      </FlagChip>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        {t.geraAlertaRetorno && (
                          <FlagChip tone="amber">Alertas retorno</FlagChip>
                        )}
                        {t.requerTermoComodato && (
                          <FlagChip tone="brand">Termo comodato</FlagChip>
                        )}
                        {origemNome && (
                          <FlagChip tone="emerald">
                            Retorno de: {origemNome}
                          </FlagChip>
                        )}
                        {t.requerCliente && (
                          <FlagChip>Cliente</FlagChip>
                        )}
                        {!t.geraAlertaRetorno &&
                          !t.requerTermoComodato &&
                          !origemNome &&
                          !t.requerCliente && (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <FlagChip tone={t.ativo ? "emerald" : "slate"}>
                        {t.ativo ? "Ativo" : "Inativo"}
                      </FlagChip>
                    </td>
                    <td className="px-3 py-3 align-top whitespace-nowrap">
                      <div className="flex gap-3">
                        {!t.sistema && (
                          <button
                            type="button"
                            onClick={() => startEdit(t)}
                            className="text-sm font-medium text-brand hover:underline"
                          >
                            Editar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => toggle(t)}
                          className="text-sm text-slate-600 hover:underline"
                        >
                          {t.ativo ? "Desativar" : "Ativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
