"use client";

import { api } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  baixaPorArvore?: boolean;
  rmaEntradaEstoque?: boolean;
  rmaSaidaCliente?: boolean;
  descricao?: string | null;
};

const MAX_CICLOS_ALERTA = 12;
const DIAS_ALERTA_OPCOES = [
  7, 10, 15, 20, 25, 30, 45, 60, 75, 90, 120, 150, 180, 270, 365,
] as const;
const DIAS_ALERTA_PADRAO = [15, 30, 45, 60] as const;

function createEmptyForm() {
  return {
    nome: "",
    operacao: "" as "" | Tipo["operacao"],
    requerCliente: false,
    requerAprovacao: false,
    permitidoOperador: false,
    permitidoGerente: true,
    geraAlertaRetorno: false,
    diasAlerta: [...DIAS_ALERTA_PADRAO] as number[],
    ehRetornoDeId: "" as string,
    requerTermoComodato: false,
    baixaPorArvore: false,
    rmaEntradaEstoque: false,
    rmaSaidaCliente: false,
    descricao: "",
  };
}

const OPERACOES: Array<{
  value: Tipo["operacao"];
  label: string;
  hint: string;
  active: string;
}> = [
  {
    value: "ENTRADA",
    label: "Entrada",
    hint: "Entra em 1 estoque",
    active: "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200",
  },
  {
    value: "SAIDA",
    label: "Saída",
    hint: "Sai de 1 estoque",
    active: "border-rose-500 bg-rose-50 ring-2 ring-rose-200",
  },
  {
    value: "TRANSFERENCIA",
    label: "Transferência",
    hint: "Sai de A → entra em B",
    active: "border-amber-500 bg-amber-50 ring-2 ring-amber-200",
  },
];

function normalizeDiasAlerta(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DIAS_ALERTA_PADRAO];
  const dias = raw
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 365)
    .slice(0, MAX_CICLOS_ALERTA);
  return dias.length > 0 ? dias : [...DIAS_ALERTA_PADRAO];
}

/** Remove duplicatas e ordena crescente (agenda mais previsível). */
function sanitizeDiasAlerta(dias: number[]): number[] {
  const uniq = [
    ...new Set(
      dias.filter((n) => Number.isInteger(n) && n >= 1 && n <= 365)
    ),
  ].sort((a, b) => a - b);
  return uniq.length > 0
    ? uniq.slice(0, MAX_CICLOS_ALERTA)
    : [...DIAS_ALERTA_PADRAO];
}

function opcoesDiasPara(valor: number): number[] {
  if (DIAS_ALERTA_OPCOES.includes(valor as (typeof DIAS_ALERTA_OPCOES)[number])) {
    return [...DIAS_ALERTA_OPCOES];
  }
  return [...DIAS_ALERTA_OPCOES, valor].sort((a, b) => a - b);
}

function proximoDiaPadrao(atual: number[]): number {
  const ultimo = atual[atual.length - 1] ?? 15;
  const candidato = Math.min(365, ultimo + 15);
  return DIAS_ALERTA_OPCOES.includes(
    candidato as (typeof DIAS_ALERTA_OPCOES)[number]
  )
    ? candidato
    : DIAS_ALERTA_OPCOES.find((d) => d > ultimo) ?? 365;
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

export function TipoMovimentacaoCadastroForm({
  tipoId,
}: {
  tipoId?: string;
}) {
  const router = useRouter();
  const editId = tipoId || null;
  const [form, setForm] = useState(createEmptyForm);
  const [lista, setLista] = useState<Tipo[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(editId));
  const [loadFailed, setLoadFailed] = useState(false);
  const [sistemaLocked, setSistemaLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadLista() {
      try {
        const tipos = await api<Tipo[]>("/tipos-movimentacao");
        if (!cancelled) setLista(tipos);
      } catch {
        /* lista auxiliar — falha no GET por id trata o erro principal */
      }
    }

    void loadLista();

    if (!editId) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setLoadFailed(false);
    setError("");
    api<Tipo>(`/tipos-movimentacao/${editId}`)
      .then((t) => {
        if (cancelled) return;
        setSistemaLocked(Boolean(t.sistema));
        setForm({
          nome: t.nome,
          operacao: t.operacao,
          requerCliente: t.requerCliente,
          requerAprovacao: t.requerAprovacao,
          permitidoOperador: t.permitidoOperador,
          permitidoGerente: t.permitidoGerente,
          geraAlertaRetorno: Boolean(t.geraAlertaRetorno),
          diasAlerta: normalizeDiasAlerta(t.diasAlerta),
          ehRetornoDeId: t.ehRetornoDeId || "",
          requerTermoComodato: Boolean(t.requerTermoComodato),
          baixaPorArvore: Boolean(t.baixaPorArvore),
          rmaEntradaEstoque: Boolean(t.rmaEntradaEstoque),
          rmaSaidaCliente: Boolean(t.rmaSaidaCliente),
          descricao: t.descricao || "",
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadFailed(true);
        setError(e instanceof Error ? e.message : "Tipo não encontrado");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.operacao) {
      setError("Selecione a natureza (Entrada, Saída ou Transferência)");
      return;
    }
    try {
      const precisaCliente =
        form.requerCliente ||
        form.geraAlertaRetorno ||
        Boolean(form.ehRetornoDeId) ||
        form.requerTermoComodato ||
        form.rmaEntradaEstoque ||
        form.rmaSaidaCliente;
      const body: Record<string, unknown> = sistemaLocked
        ? {
            rmaEntradaEstoque:
              form.operacao === "ENTRADA" && form.rmaEntradaEstoque,
            rmaSaidaCliente: form.operacao === "SAIDA" && form.rmaSaidaCliente,
            requerCliente: precisaCliente,
            descricao: form.descricao.trim() || null,
          }
        : {
            nome: form.nome.trim(),
            requerCliente: precisaCliente,
            requerAprovacao: form.requerAprovacao,
            permitidoOperador: form.permitidoOperador,
            permitidoGerente: form.permitidoGerente,
            geraAlertaRetorno: form.geraAlertaRetorno,
            ehRetornoDeId: form.ehRetornoDeId || null,
            requerTermoComodato: form.requerTermoComodato,
            baixaPorArvore:
              form.operacao === "SAIDA" || form.operacao === "TRANSFERENCIA"
                ? form.baixaPorArvore
                : false,
            rmaEntradaEstoque:
              form.operacao === "ENTRADA" && form.rmaEntradaEstoque,
            rmaSaidaCliente: form.operacao === "SAIDA" && form.rmaSaidaCliente,
            descricao: form.descricao.trim() || null,
          };
      if (!editId) {
        body.operacao = form.operacao;
      }
      if (!sistemaLocked && form.geraAlertaRetorno) {
        body.diasAlerta = sanitizeDiasAlerta(form.diasAlerta);
      }
      if (editId) {
        await api(`/tipos-movimentacao/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        router.push("/admin/tipos?ok=atualizado");
      } else {
        await api("/tipos-movimentacao", {
          method: "POST",
          body: JSON.stringify(body),
        });
        router.push("/admin/tipos?ok=criado");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  function setOperacao(operacao: Tipo["operacao"]) {
    if (editId) return;
    setForm((prev) => ({
      ...prev,
      operacao,
      geraAlertaRetorno:
        operacao === "SAIDA" ? prev.geraAlertaRetorno : false,
      ehRetornoDeId: operacao === "ENTRADA" ? prev.ehRetornoDeId : "",
      requerTermoComodato:
        operacao === "SAIDA" ? prev.requerTermoComodato : false,
      baixaPorArvore:
        operacao === "SAIDA" || operacao === "TRANSFERENCIA"
          ? prev.baixaPorArvore
          : false,
      rmaEntradaEstoque:
        operacao === "ENTRADA" ? prev.rmaEntradaEstoque : false,
      rmaSaidaCliente: operacao === "SAIDA" ? prev.rmaSaidaCliente : false,
    }));
  }

  /** Saídas elegíveis + a já vinculada (mesmo se inativa / sem alerta). */
  const saidasParaRetorno = lista.filter((t) => {
    if (t.id === editId) return false;
    if (t.operacao !== "SAIDA") return false;
    if (form.ehRetornoDeId === t.id) return true;
    return t.ativo && !t.sistema && Boolean(t.geraAlertaRetorno);
  });

  const isSaida = form.operacao === "SAIDA";
  const isEntrada = form.operacao === "ENTRADA";
  const emEdicao = Boolean(editId);
  const soRmaFlags = sistemaLocked;

  if (loading) {
    return <p className="mt-4 text-sm text-slate-500">Carregando…</p>;
  }

  if (loadFailed) {
    return (
      <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Editar tipo de movimentação
          </h1>
          <Link
            href="/admin/tipos"
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
          >
            Voltar à lista
          </Link>
        </div>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error || "Tipo não encontrado"}
        </p>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {emEdicao
              ? "Editar tipo de movimentação"
              : "Novo tipo de movimentação"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {soRmaFlags
              ? "Tipo de sistema: só a associação ao RMA pode ser alterada."
              : emEdicao
                ? `Alterando: ${form.nome || "tipo selecionado"}`
                : "Preencha os dados para criar um novo tipo de movimentação."}
          </p>
        </div>
        <Link
          href="/admin/tipos"
          className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
        >
          Voltar à lista
        </Link>
      </div>

      <form
        onSubmit={onSubmit}
        className={`mt-5 space-y-3 rounded-2xl border p-4 transition-colors sm:p-5 ${
          emEdicao
            ? "border-amber-300 bg-amber-50 shadow-sm"
            : "border-slate-200 bg-slate-50/40"
        }`}
      >
        <SectionCard
          title="Identidade"
          subtitle="Informe o nome e escolha a natureza do movimento."
          className={emEdicao ? "border-amber-200/80 bg-white/90" : ""}
        >
          <div className="space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="block min-w-0">
                <span className="mb-1 block text-sm font-medium">Nome</span>
                <input
                  required
                  disabled={soRmaFlags}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-slate-50"
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
          className={emEdicao ? "border-amber-200/80 bg-white/90" : ""}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              checked={form.requerCliente}
              disabled={soRmaFlags}
              onChange={(v) => setForm({ ...form, requerCliente: v })}
              title="Requer cliente / fornecedor"
              hint="Mostra seletor de cliente e campos de NF."
            />
            <ToggleRow
              checked={form.requerAprovacao}
              disabled={soRmaFlags || form.baixaPorArvore}
              onChange={(v) => setForm({ ...form, requerAprovacao: v })}
              title="Requer aprovação"
              hint={
                form.baixaPorArvore
                  ? "Indisponível com baixa pela árvore (a operação conclui na hora)."
                  : form.operacao === "TRANSFERENCIA"
                    ? "Operador cria carga PENDENTE; Gerente/Admin aprovam antes de sair o estoque."
                    : "Operador gera PENDENTE; Gerente/Admin aprovam."
              }
            />
          </div>
        </SectionCard>

        <SectionCard
          title="RMA"
          subtitle="Associa este tipo aos botões da tela de RMA (abrir / devolver)."
          className={emEdicao ? "border-amber-200/80 bg-white/90" : ""}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              checked={form.rmaEntradaEstoque}
              disabled={!isEntrada}
              onChange={(v) =>
                setForm({
                  ...form,
                  rmaEntradaEstoque: v,
                  rmaSaidaCliente: false,
                  requerCliente: v ? true : form.requerCliente,
                })
              }
              title="RMA: entrada automática no estoque"
              hint={
                isEntrada
                  ? "Usada ao abrir RMA / incluir item (gera estoque no depósito RMA). Só um tipo pode ter esta opção."
                  : "Disponível apenas para natureza Entrada."
              }
            />
            <ToggleRow
              checked={form.rmaSaidaCliente}
              disabled={!isSaida}
              onChange={(v) =>
                setForm({
                  ...form,
                  rmaSaidaCliente: v,
                  rmaEntradaEstoque: false,
                  requerCliente: v ? true : form.requerCliente,
                })
              }
              title="RMA: saída ao devolver / trocar"
              hint={
                isSaida
                  ? "Usada nos botões de devolver e trocar na tela do RMA. Só um tipo pode ter esta opção."
                  : "Disponível apenas para natureza Saída."
              }
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Quem pode lançar"
          subtitle="Visibilidade no seletor de tipo por perfil."
          className={emEdicao ? "border-amber-200/80 bg-white/90" : ""}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              checked={form.permitidoOperador}
              disabled={soRmaFlags}
              onChange={(v) => setForm({ ...form, permitidoOperador: v })}
              title="Operador"
              hint="Aparece para perfil Operador."
            />
            <ToggleRow
              checked={form.permitidoGerente}
              disabled={soRmaFlags}
              onChange={(v) => setForm({ ...form, permitidoGerente: v })}
              title="Gerente / Admin"
              hint="Aparece para Gerente e Admin."
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Demo / Comodato"
          subtitle="Alertas de retorno, termo e vínculo saída ↔ retorno."
          className={emEdicao ? "border-amber-200/80 bg-white/90" : ""}
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
                  diasAlerta:
                    v && form.diasAlerta.length === 0
                      ? [...DIAS_ALERTA_PADRAO]
                      : form.diasAlerta,
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
            <ToggleRow
              checked={form.baixaPorArvore}
              disabled={!isSaida && form.operacao !== "TRANSFERENCIA"}
              onChange={(v) =>
                setForm({
                  ...form,
                  baixaPorArvore: v,
                  requerAprovacao: v ? false : form.requerAprovacao,
                })
              }
              title="Baixa pela árvore de produto"
              hint={
                isSaida
                  ? "Ao lançar a saída, o sistema baixa no mesmo estoque os componentes da árvore deste produto."
                  : form.operacao === "TRANSFERENCIA"
                    ? "Na origem saem os componentes da árvore; no destino entra apenas este produto."
                    : "Disponível apenas para Saída ou Transferência."
              }
            />

            <div
              className={`rounded-lg border px-3 py-2.5 sm:col-span-2 ${
                form.geraAlertaRetorno && isSaida
                  ? "border-slate-200 bg-white"
                  : "border-slate-100 bg-slate-50/60 opacity-55"
              }`}
            >
              <div className="flex flex-wrap items-end gap-3">
                <label className="block min-w-[10rem]">
                  <span className="mb-1 block text-sm font-medium">
                    Quantos ciclos de alerta
                  </span>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-slate-50"
                    disabled={!form.geraAlertaRetorno || !isSaida}
                    value={Math.max(1, form.diasAlerta.length)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setForm((prev) => {
                        let next = [...prev.diasAlerta];
                        if (n < next.length) next = next.slice(0, n);
                        while (next.length < n) {
                          next.push(proximoDiaPadrao(next));
                        }
                        return { ...prev, diasAlerta: next };
                      });
                    }}
                  >
                    {Array.from({ length: MAX_CICLOS_ALERTA }, (_, i) => i + 1).map(
                      (n) => (
                        <option key={n} value={n}>
                          {n} ciclo{n === 1 ? "" : "s"}
                        </option>
                      )
                    )}
                  </select>
                </label>
                <p className="pb-2 text-xs text-slate-500">
                  Contados a partir da data do lançamento (calendário São Paulo).
                </p>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {form.diasAlerta.map((dia, idx) => (
                  <label key={idx} className="block min-w-0">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      {idx + 1}º alerta
                    </span>
                    <select
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-slate-50"
                      disabled={!form.geraAlertaRetorno || !isSaida}
                      value={dia}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setForm((prev) => {
                          const next = [...prev.diasAlerta];
                          next[idx] = v;
                          return { ...prev, diasAlerta: next };
                        });
                      }}
                    >
                      {opcoesDiasPara(dia).map((d) => (
                        <option key={d} value={d}>
                          {d} dias
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <label
              className={`block rounded-lg border px-3 py-2.5 sm:col-span-2 ${
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
                    {!t.ativo
                      ? " (inativa)"
                      : !t.geraAlertaRetorno
                        ? " (sem alerta)"
                        : ""}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-slate-500">
                {isEntrada
                  ? saidasParaRetorno.length
                    ? "Saídas com alerta de retorno; a já vinculada permanece mesmo se inativa."
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

        <div
          className={`flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 shadow-sm ${
            emEdicao
              ? "border-amber-300 bg-white/90"
              : "border-slate-200 bg-white"
          }`}
        >
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-95"
          >
            {emEdicao ? "Salvar alterações" : "Cadastrar tipo"}
          </button>
          <Link
            href="/admin/tipos"
            className={`rounded-lg border px-4 py-2 text-sm hover:bg-slate-50 ${
              emEdicao
                ? "border-amber-300 text-amber-950 hover:bg-amber-50"
                : "border-slate-200 text-slate-700"
            }`}
          >
            Cancelar
          </Link>
          <span
            className={`ml-auto text-xs ${
              emEdicao ? "text-amber-900/70" : "text-slate-400"
            }`}
          >
            {emEdicao
              ? "Você está alterando um tipo já cadastrado."
              : "Alertas / termo / vínculo forçam “requer cliente”."}
          </span>
        </div>
      </form>
    </>
  );
}
