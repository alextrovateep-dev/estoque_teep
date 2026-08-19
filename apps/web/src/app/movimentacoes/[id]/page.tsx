"use client";

import { api } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type Anexo = {
  id: string;
  tipo: string;
  arquivo: string;
  label?: string | null;
};

type Movimentacao = {
  id: string;
  operacao: string;
  quantidade: string | number;
  status: string;
  dataMovimento: string;
  observacao?: string | null;
  notaFiscalNumero?: string | null;
  notaFiscalArquivo?: string | null;
  produto: { codigo: string; descricao: string; unidade?: string | null };
  tipo: { nome: string };
  filial: { sigla: string; nome: string };
  filialDestino?: { sigla: string; nome: string } | null;
  cliente?: { nome: string; tipo: string; documento?: string | null } | null;
  usuario: { nome: string; email?: string | null };
  series?: Array<{ unidadeSerie: { numeroSerie: string } }>;
  anexos?: Anexo[];
};

const STATUS_LABEL: Record<string, string> = {
  CONCLUIDO: "Concluído",
  PENDENTE: "Pendente",
  REJEITADO: "Rejeitado",
  ESTORNADO: "Estornado",
};

const ANEXO_TIPO_LABEL: Record<string, string> = {
  NOTA_FISCAL: "Nota fiscal",
  LAUDO: "Laudo",
  OUTRO: "Documento",
  TERMO_COMODATO: "Termo",
};

function formatQty(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

export default function MovimentacaoDetalhePage() {
  const params = useParams();
  const id = String(params.id);
  const [data, setData] = useState<Movimentacao | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api<Movimentacao>(`/movimentacoes/${id}`)
      .then((row) => {
        if (!cancelled) setData(row);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Falha ao carregar movimentação"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const opLabel =
    data?.operacao === "ENTRADA"
      ? "Entrada"
      : data?.operacao === "SAIDA"
        ? "Saída"
        : data?.operacao === "TRANSFERENCIA"
          ? "Transferência"
          : data?.operacao;

  const anexos: Anexo[] = [];
  if (data?.notaFiscalArquivo) {
    anexos.push({
      id: `nf-${data.id}`,
      tipo: "NOTA_FISCAL",
      arquivo: data.notaFiscalArquivo,
      label: data.notaFiscalNumero
        ? `NF ${data.notaFiscalNumero}`
        : "Nota fiscal",
    });
  }
  for (const a of data?.anexos || []) {
    if (!anexos.some((x) => x.arquivo === a.arquivo)) anexos.push(a);
  }

  return (
    <div>
      <div className="mb-2">
        <Link href="/movimentacoes" className="text-sm text-brand underline">
          ← Voltar
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Movimentação</h1>
        {data ? (
          <>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">
              {opLabel}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">
              {STATUS_LABEL[data.status] || data.status}
            </span>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : null}

      {data && !loading ? (
        <div className="space-y-4">
          <div className="rounded-xl border bg-white p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">
              Dados da operação
            </h2>
            <div className="grid gap-1 sm:grid-cols-2">
              <p>
                <span className="text-slate-500">Tipo:</span> {data.tipo.nome}
              </p>
              <p>
                <span className="text-slate-500">Data:</span>{" "}
                {new Date(data.dataMovimento).toLocaleString("pt-BR")}
              </p>
              <p>
                <span className="text-slate-500">Produto:</span>{" "}
                <span className="font-mono">{data.produto.codigo}</span>{" "}
                {data.produto.descricao}
              </p>
              <p>
                <span className="text-slate-500">Quantidade:</span>{" "}
                {formatQty(Number(data.quantidade))}
                {data.produto.unidade ? ` ${data.produto.unidade}` : ""}
              </p>
              <p>
                <span className="text-slate-500">Estoque:</span>{" "}
                {data.filialDestino
                  ? `${data.filial.sigla} → ${data.filialDestino.sigla}`
                  : `${data.filial.sigla} — ${data.filial.nome}`}
              </p>
              <p>
                <span className="text-slate-500">Usuário:</span>{" "}
                {data.usuario.nome}
                {data.usuario.email ? ` · ${data.usuario.email}` : ""}
              </p>
              <p>
                <span className="text-slate-500">Parceiro:</span>{" "}
                {data.cliente
                  ? `${data.cliente.tipo === "FORNECEDOR" ? "Forn." : "Cli."} ${data.cliente.nome}`
                  : "—"}
              </p>
              <p>
                <span className="text-slate-500">NF / documento nº:</span>{" "}
                {data.notaFiscalNumero || "—"}
              </p>
              {data.series && data.series.length > 0 ? (
                <p className="sm:col-span-2">
                  <span className="text-slate-500">Série:</span>{" "}
                  <span className="font-mono">
                    {data.series
                      .map((s) => s.unidadeSerie.numeroSerie)
                      .join(", ")}
                  </span>
                </p>
              ) : null}
            </div>
            <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800">
              <span className="mb-0.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Observação
              </span>
              {data.observacao?.trim() || "—"}
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">
              Anexos ({anexos.length})
            </h2>
            {!anexos.length ? (
              <p className="text-sm text-slate-500">
                Nenhum arquivo anexado a esta movimentação.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {anexos.map((a) => {
                  const href = resolveAssetUrl(a.arquivo);
                  return (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-700">
                          {ANEXO_TIPO_LABEL[a.tipo] || a.tipo}
                        </span>{" "}
                        <span className="text-slate-800">
                          {a.label || a.tipo}
                        </span>
                      </span>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand hover:underline"
                        >
                          Abrir / baixar
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
