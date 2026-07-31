"use client";

import { api, apiUpload, getStoredUser, User, userFilialIds } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";
import { SeriesInput } from "@/components/SeriesInput";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useRef, useState } from "react";

type Tipo = {
  id: string;
  nome: string;
  operacao: "ENTRADA" | "SAIDA" | "TRANSFERENCIA";
  requerCliente: boolean;
  geraAlertaRetorno?: boolean;
  ehRetornoDeId?: string | null;
  requerTermoComodato?: boolean;
};

type SaidaAberta = {
  id: string;
  dataMovimento: string;
  quantidade: number;
  qtyRestante?: number;
  notaFiscalNumero: string | null;
  produto: { id: string; codigo: string; descricao: string };
  filial: { id: string; sigla: string; nome: string };
  tipo: { id: string; nome: string };
};
type Filial = { id: string; nome: string; sigla: string };
type Cliente = { id: string; nome: string; tipo: string };
type Produto = {
  id: string;
  codigo: string;
  descricao: string;
  precoUnitario?: string | number;
  controlaSerie?: boolean;
};

type CreditoDestino = "IMEDIATO" | "AGUARDAR_RECEBIMENTO";

function badgeClass(op: string) {
  if (op === "ENTRADA")
    return "rounded-lg bg-emerald-100 px-3 py-2 text-center text-sm font-semibold text-emerald-800";
  if (op === "TRANSFERENCIA")
    return "rounded-lg bg-amber-100 px-3 py-2 text-center text-sm font-semibold text-amber-900";
  return "rounded-lg bg-red-100 px-3 py-2 text-center text-sm font-semibold text-red-800";
}

function badgeLabel(op: string) {
  if (op === "ENTRADA") return "ENTRADA — entra no estoque selecionado";
  if (op === "TRANSFERENCIA")
    return "TRANSFERÊNCIA — sai da origem e vai para o destino";
  return "SAÍDA — sai do estoque selecionado";
}

function formatQty(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

async function fetchSaldoProduto(
  produtoId: string,
  filialId: string
): Promise<number> {
  const r = await api<{ saldoAtual: string | number }>(
    `/estoques/saldo?produtoId=${encodeURIComponent(produtoId)}&filialId=${encodeURIComponent(filialId)}`
  );
  return Number(r.saldoAtual) || 0;
}

export default function NovoLancamentoPage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-slate-500">Carregando lançamento…</p>
      }
    >
      <NovoLancamentoForm />
    </Suspense>
  );
}

function NovoLancamentoForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const retornoDeId = searchParams.get("retornoDe")?.trim() || "";
  const wantsTransf = searchParams.get("transf") === "1";
  const qOrigem = searchParams.get("origem")?.trim() || "";
  const qDestino = searchParams.get("destino")?.trim() || "";
  const qCodigo = searchParams.get("codigo")?.trim() || "";
  const qQtd = searchParams.get("qtd")?.trim() || "";
  const qtdFromUrl = (() => {
    const n = Number(qQtd);
    return Number.isFinite(n) && n > 0 ? String(n) : "";
  })();
  const codigoRef = useRef<HTMLInputElement>(null);
  const nfNumeroRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipTipoClearRef = useRef(false);
  const [user, setUser] = useState<User | null>(null);
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [produto, setProduto] = useState<Produto | null>(null);
  const [sugestoes, setSugestoes] = useState<Produto[]>([]);
  const [codigo, setCodigo] = useState("");
  const [tipoId, setTipoId] = useState("");
  const [filialId, setFilialId] = useState("");
  const [filialDestinoId, setFilialDestinoId] = useState("");
  const [saldoOrigem, setSaldoOrigem] = useState<number | null>(null);
  const [saldoDestino, setSaldoDestino] = useState<number | null>(null);
  const [creditoDestino, setCreditoDestino] =
    useState<CreditoDestino>("AGUARDAR_RECEBIMENTO");
  const [clienteId, setClienteId] = useState("");
  const [notaFiscalNumero, setNotaFiscalNumero] = useState("");
  const [notaFiscalArquivo, setNotaFiscalArquivo] = useState<string | null>(
    null
  );
  const [nfUploading, setNfUploading] = useState(false);
  const [alertaEmailsText, setAlertaEmailsText] = useState("");
  const [movimentacaoOrigemId, setMovimentacaoOrigemId] = useState("");
  const [saidasAbertas, setSaidasAbertas] = useState<SaidaAberta[]>([]);
  const [saidasLoading, setSaidasLoading] = useState(false);
  const [termoArquivo, setTermoArquivo] = useState<string | null>(null);
  const [termoUploading, setTermoUploading] = useState(false);
  const [guiaTransporte, setGuiaTransporte] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [series, setSeries] = useState<string[]>([]);
  const [observacao, setObservacao] = useState("");
  const [msg, setMsg] = useState("");
  const [lastTransferId, setLastTransferId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retornoPrefill, setRetornoPrefill] = useState(false);
  const [transferPrefill, setTransferPrefill] = useState(false);
  const [prefillLoading, setPrefillLoading] = useState(
    Boolean(retornoDeId || wantsTransf)
  );

  const tipo = tipos.find((t) => t.id === tipoId);
  const isTransf = tipo?.operacao === "TRANSFERENCIA";
  const isRetorno = Boolean(tipo?.ehRetornoDeId);
  const precisaAlerta = Boolean(tipo?.geraAlertaRetorno);
  const precisaTermo = Boolean(tipo?.requerTermoComodato);
  const precisaCliente =
    Boolean(tipo?.requerCliente) ||
    precisaAlerta ||
    isRetorno ||
    precisaTermo;
  const camposTravados = retornoPrefill;
  const prefillAtivo = retornoPrefill || transferPrefill;
  /** Retorno (demo/comodato): NF número + anexo obrigatórios antes de salvar. */
  const nfRetornoOk =
    !isRetorno ||
    (Boolean(notaFiscalNumero.trim()) && Boolean(notaFiscalArquivo));
  const podeSalvar =
    !loading &&
    !prefillLoading &&
    Boolean(tipoId) &&
    (!isRetorno || (Boolean(movimentacaoOrigemId) && nfRetornoOk));

  useEffect(() => {
    if (skipTipoClearRef.current) {
      skipTipoClearRef.current = false;
      return;
    }
    // Retorno trava o formulário; transferência só protege o setTipoId inicial (skip ref).
    if (retornoPrefill) return;
    if (transferPrefill) setTransferPrefill(false);
    // Ao trocar o tipo, limpa campos específicos para não vazar estado
    setClienteId("");
    setNotaFiscalNumero("");
    setNotaFiscalArquivo(null);
    setAlertaEmailsText("");
    setMovimentacaoOrigemId("");
    setSaidasAbertas([]);
    setTermoArquivo(null);
    setGuiaTransporte("");
    setObservacao("");
    setQuantidade("1");
  }, [tipoId, retornoPrefill]);

  useEffect(() => {
    const u = getStoredUser();
    setUser(u);
    Promise.all([
      api<Tipo[]>("/tipos-movimentacao?paraLancamento=1"),
      api<Filial[]>("/filiais"),
      api<Cliente[]>("/clientes"),
    ])
      .then(([t, f, c]) => {
        setTipos(t);
        setFiliais(f);
        setClientes(c);
        const opIds =
          u?.perfil === "OPERADOR" ? userFilialIds(u) : [];
        const origemPadrao =
          u?.perfil === "OPERADOR"
            ? opIds[0] || ""
            : f[0]?.id || "";
        if (origemPadrao) setFilialId(origemPadrao);
        if (!retornoDeId && !wantsTransf && t[0]) setTipoId(t[0].id);
        const dest = f.find((x) => x.id !== origemPadrao);
        if (dest && !wantsTransf) setFilialDestinoId(dest.id);
      })
      .catch((e) => {
        setError(e.message);
        if (retornoDeId || wantsTransf) setPrefillLoading(false);
      });
    if (!retornoDeId && !wantsTransf) {
      setTimeout(() => codigoRef.current?.focus(), 100);
    }
  }, [retornoDeId, wantsTransf]);

  /** Prefill completo a partir de ?retornoDe= — só lê dados; NÃO cria lançamento. */
  useEffect(() => {
    if (!retornoDeId || !tipos.length) return;
    let cancelled = false;
    setPrefillLoading(true);

    void (async () => {
      try {
        const mov = await api<{
          id: string;
          tipoId: string;
          clienteId: string | null;
          status: string;
          operacao: string;
          tipo: { nome: string };
        }>(`/movimentacoes/${encodeURIComponent(retornoDeId)}`);
        if (cancelled) return;

        if (mov.operacao !== "SAIDA" || mov.status !== "CONCLUIDO") {
          setError("Só é possível retornar uma saída concluída");
          setPrefillLoading(false);
          return;
        }
        if (!mov.clienteId) {
          setError(
            "Esta saída não tem cliente — não dá para vincular o retorno"
          );
          setPrefillLoading(false);
          return;
        }
        const tipoRetorno = tipos.find((t) => t.ehRetornoDeId === mov.tipoId);
        if (!tipoRetorno?.ehRetornoDeId) {
          setError(
            `Não há tipo de retorno cadastrado para “${mov.tipo.nome}”`
          );
          setPrefillLoading(false);
          return;
        }

        setSaidasLoading(true);
        const abertas = await api<SaidaAberta[]>(
          `/movimentacoes/saidas-abertas?tipoOrigemId=${encodeURIComponent(tipoRetorno.ehRetornoDeId)}&clienteId=${encodeURIComponent(mov.clienteId)}`
        );
        if (cancelled) return;

        const s = abertas.find((x) => x.id === retornoDeId);
        if (!s) {
          setError(
            "Esta saída não está mais aberta para retorno (já retornada ou inválida)"
          );
          setSaidasLoading(false);
          setPrefillLoading(false);
          return;
        }

        skipTipoClearRef.current = true;
        setRetornoPrefill(true);
        setTipoId(tipoRetorno.id);
        setClienteId(mov.clienteId);
        setSaidasAbertas(abertas);
        setMovimentacaoOrigemId(s.id);
        setProduto(s.produto);
        setCodigo(s.produto.codigo);
        setQuantidade(String(s.qtyRestante ?? s.quantidade));
        setFilialId(s.filial.id);
        setNotaFiscalNumero("");
        setNotaFiscalArquivo(null);
        setObservacao("");
        setError("");
        setSaidasLoading(false);
        setPrefillLoading(false);
        setTimeout(() => nfNumeroRef.current?.focus(), 80);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "Falha ao carregar a saída para retorno"
          );
          setSaidasLoading(false);
          setPrefillLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [retornoDeId, tipos]);

  /** Prefill transferência a partir de ?transf=1&origem=&destino=&codigo=&qtd= */
  useEffect(() => {
    if (!wantsTransf || !tipos.length || !filiais.length) return;
    let cancelled = false;
    setPrefillLoading(true);

    void (async () => {
      try {
        const tipoTransf =
          tipos.find(
            (t) =>
              t.operacao === "TRANSFERENCIA" &&
              /transferência entre estoques/i.test(t.nome)
          ) || tipos.find((t) => t.operacao === "TRANSFERENCIA");
        if (!tipoTransf) {
          if (!cancelled) {
            setError("Não há tipo de Transferência disponível para lançamento");
            setPrefillLoading(false);
          }
          return;
        }

        const matchFilial = (q: string) => {
          const n = q.trim().toLowerCase();
          return (
            filiais.find((f) => f.sigla.toLowerCase() === n) ||
            filiais.find((f) => f.nome.toLowerCase() === n) ||
            filiais.find((f) => f.nome.toLowerCase().includes(n))
          );
        };
        const origem = matchFilial(qOrigem);
        const destino = matchFilial(qDestino);
        if (!origem || !destino) {
          if (!cancelled) {
            setError(
              `Filial não encontrada (origem “${qOrigem}”, destino “${qDestino}”)`
            );
            setPrefillLoading(false);
          }
          return;
        }
        if (origem.id === destino.id) {
          if (!cancelled) {
            setError("Origem e destino devem ser diferentes");
            setPrefillLoading(false);
          }
          return;
        }
        const u = getStoredUser();
        if (u?.perfil === "OPERADOR") {
          const opIds = userFilialIds(u);
          if (!opIds.includes(origem.id)) {
            if (!cancelled) {
              setError(
                `Operador sem acesso à filial de origem ${origem.sigla}`
              );
              setPrefillLoading(false);
            }
            return;
          }
        }
        if (!qCodigo) {
          if (!cancelled) {
            setError("Código do produto ausente no atalho");
            setPrefillLoading(false);
          }
          return;
        }

        const list = await api<Produto[]>(
          `/produtos/busca?q=${encodeURIComponent(qCodigo)}`
        );
        if (cancelled) return;
        const prod = list.find(
          (p) => p.codigo.toLowerCase() === qCodigo.toLowerCase()
        );
        if (!prod) {
          setError(`Produto não encontrado: ${qCodigo}`);
          setPrefillLoading(false);
          return;
        }

        const qtdNum = Number(qQtd);
        const qtdFinal =
          Number.isFinite(qtdNum) && qtdNum > 0 ? String(qtdNum) : "1";
        skipTipoClearRef.current = true;
        setTransferPrefill(true);
        setTipoId(tipoTransf.id);
        setFilialId(origem.id);
        setFilialDestinoId(destino.id);
        setProduto(prod);
        setCodigo(prod.codigo);
        setQuantidade(qtdFinal);
        setObservacao("");
        setError("");
        setPrefillLoading(false);
        setTimeout(() => codigoRef.current?.focus(), 80);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "Falha ao pré-preencher a transferência"
          );
          setPrefillLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wantsTransf, tipos, filiais, qOrigem, qDestino, qCodigo, qQtd]);

  useEffect(() => {
    if (!isTransf || !filialId) return;
    if (filialDestinoId === filialId) {
      const dest = filiais.find((f) => f.id !== filialId);
      setFilialDestinoId(dest?.id || "");
    }
  }, [isTransf, filialId, filiais, filialDestinoId]);

  useEffect(() => {
    if (!produto?.id || !filialId) {
      setSaldoOrigem(null);
      setSaldoDestino(null);
      return;
    }
    let cancelled = false;
    async function loadSaldos() {
      try {
        const origem = await fetchSaldoProduto(produto!.id, filialId);
        if (cancelled) return;
        setSaldoOrigem(origem);
        if (isTransf && filialDestinoId) {
          const dest = await fetchSaldoProduto(produto!.id, filialDestinoId);
          if (!cancelled) setSaldoDestino(dest);
        } else {
          setSaldoDestino(null);
        }
      } catch {
        if (!cancelled) {
          setSaldoOrigem(null);
          setSaldoDestino(null);
        }
      }
    }
    void loadSaldos();
    return () => {
      cancelled = true;
    };
  }, [produto, filialId, filialDestinoId, isTransf]);

  useEffect(() => {
    setSeries([]);
  }, [produto?.id]);

  useEffect(() => {
    // Prefill já carregou saídas — não zerar/recarregar.
    if (retornoPrefill || retornoDeId) return;
    setMovimentacaoOrigemId("");
    setSaidasAbertas([]);
    if (!isRetorno || !tipo?.ehRetornoDeId || !clienteId) return;
    let cancelled = false;
    setSaidasLoading(true);
    void api<SaidaAberta[]>(
      `/movimentacoes/saidas-abertas?tipoOrigemId=${encodeURIComponent(tipo.ehRetornoDeId)}&clienteId=${encodeURIComponent(clienteId)}`
    )
      .then((rows) => {
        if (cancelled) return;
        setSaidasAbertas(rows);
        setError("");
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setSaidasAbertas([]);
          setError(e.message || "Falha ao carregar saídas abertas");
        }
      })
      .finally(() => {
        if (!cancelled) setSaidasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    isRetorno,
    tipo?.ehRetornoDeId,
    clienteId,
    retornoDeId,
    retornoPrefill,
  ]);

  function onCodigoChange(value: string) {
    setCodigo(value);
    setProduto(null);
    setError("");
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) {
      setSugestoes([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const list = await api<Produto[]>(
          `/produtos/busca?q=${encodeURIComponent(value.trim())}`
        );
        setSugestoes(list);
      } catch {
        setSugestoes([]);
      }
    }, 250);
  }

  async function buscarProduto(code: string): Promise<Produto | null> {
    setError("");
    if (!code.trim()) {
      setProduto(null);
      return null;
    }
    const list = await api<Produto[]>(
      `/produtos/busca?q=${encodeURIComponent(code.trim())}`
    );
    const exact =
      list.find((p) => p.codigo.toLowerCase() === code.trim().toLowerCase()) ||
      list[0];
    if (!exact) {
      setProduto(null);
      setError("Produto não encontrado");
      return null;
    }
    setProduto(exact);
    setCodigo(exact.codigo);
    setSugestoes([]);
    return exact;
  }

  function selecionarProduto(p: Produto) {
    setProduto(p);
    setCodigo(p.codigo);
    setSugestoes([]);
    setError("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!podeSalvar) return;
    setLoading(true);
    setError("");
    setMsg("");
    setLastTransferId(null);
    try {
      let prod = produto;
      if (!prod || prod.codigo.toLowerCase() !== codigo.trim().toLowerCase()) {
        prod = await buscarProduto(codigo);
      }
      if (!prod) {
        setError("Informe um produto");
        return;
      }
      if (isTransf && !filialDestinoId) {
        setError("Selecione a filial de destino");
        return;
      }
      if (isTransf && filialDestinoId === filialId) {
        setError("Origem e destino devem ser diferentes");
        return;
      }

      const body: Record<string, unknown> = {
        produtoId: prod.id,
        tipoId,
        filialId,
        clienteId: precisaCliente ? clienteId || null : null,
        quantidade: prod.controlaSerie ? series.length : Number(quantidade),
        observacao: observacao || null,
      };
      if (prod.controlaSerie) {
        if (series.length === 0) {
          setError("Informe os números de série deste produto");
          return;
        }
        body.series = series;
        body.quantidade = series.length;
      }
      if (precisaCliente) {
        body.notaFiscalNumero = notaFiscalNumero.trim() || null;
        body.notaFiscalArquivo = notaFiscalArquivo || null;
      }
      if (precisaAlerta) {
        const emails = alertaEmailsText
          .split(/[,;\s]+/)
          .map((x) => x.trim())
          .filter(Boolean);
        if (emails.length === 0) {
          setError("Informe ao menos um e-mail para alertas de retorno");
          return;
        }
        body.alertaEmails = emails;
      }
      if (isRetorno) {
        if (!movimentacaoOrigemId) {
          setError("Selecione a saída aberta a vincular");
          return;
        }
        if (!notaFiscalNumero.trim()) {
          setError("Informe o número da NF de retorno");
          nfNumeroRef.current?.focus();
          return;
        }
        if (!notaFiscalArquivo) {
          setError("Anexe o arquivo da NF de retorno");
          return;
        }
        body.movimentacaoOrigemId = movimentacaoOrigemId;
        body.notaFiscalNumero = notaFiscalNumero.trim();
        body.notaFiscalArquivo = notaFiscalArquivo;
        const saida = saidasAbertas.find((s) => s.id === movimentacaoOrigemId);
        const max = saida?.qtyRestante ?? saida?.quantidade;
        const qtdEfetiva = prod.controlaSerie
          ? series.length
          : Number(quantidade);
        if (max != null && qtdEfetiva > max + 1e-9) {
          setError(`Quantidade não pode exceder o saldo em aberto (${max})`);
          return;
        }
      }
      if (precisaTermo && termoArquivo) {
        body.anexos = [
          {
            tipo: "TERMO_COMODATO",
            arquivo: termoArquivo,
            label: "Termo de recebimento",
          },
        ];
      }
      if (isTransf) {
        body.filialDestinoId = filialDestinoId;
        body.creditoDestino = creditoDestino;
        body.guiaTransporte = guiaTransporte.trim() || null;
      }

      const result = await api<{
        fluxo?: string;
        creditoDestino?: string;
        transferencia?: { id: string; status: string };
        movimentacao: { status: string; id?: string };
        alertaEstoqueMinimo: boolean;
        alertaEstoqueMaximo?: boolean;
        alertas?: Array<{ mensagem: string }>;
      }>("/movimentacoes", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const extras =
        result.alertas?.map((a) => a.mensagem).join(" · ") ||
        [
          result.alertaEstoqueMinimo ? "estoque mínimo" : "",
          result.alertaEstoqueMaximo ? "estoque máximo" : "",
        ]
          .filter(Boolean)
          .map((x) => `Alerta: ${x}`)
          .join(" · ");

      if (retornoPrefill) {
        router.push(
          `/movimentacoes?retornoOk=1&status=${encodeURIComponent(result.movimentacao.status)}`
        );
        return;
      }

      if (result.fluxo === "TRANSFERENCIA") {
        const st = result.transferencia?.status || result.movimentacao.status;
        const tid = result.transferencia?.id;
        if (st === "PENDENTE_APROVACAO") {
          setMsg(
            `Transferência aguardando aprovação do Gerente${extras ? ` · ${extras}` : ""}`
          );
          setLastTransferId(null);
        } else {
          const modo =
            result.creditoDestino === "IMEDIATO"
              ? "crédito imediato no destino"
              : "aguardando confirmação de recebimento";
          setMsg(
            `Transferência ${st} · ${modo}${extras ? ` · ${extras}` : ""}`
          );
          setLastTransferId(
            result.creditoDestino === "AGUARDAR_RECEBIMENTO" && tid ? tid : null
          );
        }
      } else {
        setLastTransferId(null);
        setMsg(
          `Lançamento ${result.movimentacao.status}${extras ? ` · ${extras}` : ""}`
        );
      }

      if (transferPrefill || wantsTransf) {
        setTransferPrefill(false);
        router.replace("/lancamentos/novo");
      }

      setCodigo("");
      setProduto(null);
      setSugestoes([]);
      setSaldoOrigem(null);
      setSaldoDestino(null);
      setQuantidade("1");
      setObservacao("");
      setNotaFiscalNumero("");
      setNotaFiscalArquivo(null);
      setAlertaEmailsText("");
      setMovimentacaoOrigemId("");
      setSaidasAbertas([]);
      setTermoArquivo(null);
      setGuiaTransporte("");
      codigoRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  const operadorFilialIdsList =
    user?.perfil === "OPERADOR" ? userFilialIds(user) : [];
  const filiaisOrigem =
    user?.perfil === "OPERADOR"
      ? filiais.filter((f) => operadorFilialIdsList.includes(f.id))
      : filiais;
  const operadorMultiFilial =
    user?.perfil === "OPERADOR" && filiaisOrigem.length > 1;

  const filialOrigemLabel = filiais.find((f) => f.id === filialId);
  const filialDestinoLabel = filiais.find((f) => f.id === filialDestinoId);

  return (
    <>
    <h1 className="text-2xl font-semibold">
        {retornoPrefill || retornoDeId
          ? "Lançar retorno"
          : transferPrefill || wantsTransf
            ? "Transferência entre filiais"
            : "Novo Lançamento"}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {retornoPrefill || retornoDeId ? (
          <>
            Rascunho a partir da saída —{" "}
            <strong className="font-medium text-slate-700">
              nada é gravado até você confirmar
            </strong>
            . Preencha o número e o anexo da NF, depois clique em Confirmar
            retorno.
          </>
        ) : transferPrefill || wantsTransf ? (
          <>
            Rascunho sugerido pelo assistente —{" "}
            <strong className="font-medium text-slate-700">
              nada é gravado até você confirmar
            </strong>
            . Revise origem, destino, produto e quantidade, depois confirme a
            transferência.
          </>
        ) : (
          <>
            O tipo de movimentação define se é entrada, saída ou transferência
            entre filiais. Confirmação de recebimento fica em{" "}
            <Link
              href="/transferencias"
              className="text-brand hover:underline"
            >
              Confirmar Recebimento
            </Link>
            .
          </>
        )}
      </p>

      <form
        onSubmit={onSubmit}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const tag = (e.target as HTMLElement).tagName;
          if (tag === "TEXTAREA") return;
          if (isRetorno && !nfRetornoOk) {
            e.preventDefault();
          }
        }}
        className={`mt-4 space-y-4 rounded-xl border bg-white p-4 ${
          retornoPrefill || transferPrefill
            ? "border-amber-300/70 ring-1 ring-amber-200/50"
            : ""
        }`}
      >
        {prefillLoading && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {wantsTransf
              ? "Preparando rascunho da transferência… Ainda não há lançamento salvo."
              : "Carregando dados da saída… Ainda não há lançamento salvo."}
          </div>
        )}
        {transferPrefill && !prefillLoading && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
            Dados sugeridos pelo assistente. Confira e clique em confirmar para
            gravar a transferência
            {filialOrigemLabel && filialDestinoLabel
              ? ` (${filialOrigemLabel.sigla} → ${filialDestinoLabel.sigla})`
              : ""}
            {qtdFromUrl ? ` · quantidade do atalho: ${qtdFromUrl}` : ""}.
            {saldoOrigem != null &&
            qtdFromUrl &&
            Number(qtdFromUrl) !== saldoOrigem ? (
              <span className="mt-1 block text-xs text-amber-800/90">
                Saldo na origem ({formatQty(saldoOrigem)}) é só referência — a
                quantidade a lançar é a pedida no atalho.
              </span>
            ) : null}
          </div>
        )}
        {retornoPrefill && !prefillLoading && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
            Dados da saída preenchidos (somente visualização). Informe a{" "}
            <strong className="font-semibold">NF de retorno</strong> (número +
            anexo) e confirme para gravar a entrada no estoque.
          </div>
        )}
        {tipo && (
          <div className={badgeClass(tipo.operacao)}>
            {badgeLabel(tipo.operacao)}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Tipo</span>
          <select
            className="w-full rounded-lg border px-3 py-3 disabled:bg-slate-50 disabled:text-slate-600"
            value={tipoId}
            disabled={camposTravados}
            onChange={(e) => setTipoId(e.target.value)}
          >
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome} ({t.operacao === "TRANSFERENCIA" ? "A→B" : t.operacao})
              </option>
            ))}
          </select>
        </label>

        <label className="relative block">
          <span className="mb-1 block text-sm font-medium">Código / produto</span>
          <input
            ref={codigoRef}
            value={codigo}
            disabled={camposTravados}
            onChange={(e) => onCodigoChange(e.target.value)}
            onBlur={() => {
              setTimeout(() => {
                if (codigo.trim() && !produto) void buscarProduto(codigo);
              }, 150);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (
                !produto ||
                produto.codigo.toLowerCase() !== codigo.trim().toLowerCase()
              ) {
                e.preventDefault();
                void buscarProduto(codigo);
              }
            }}
            className="w-full rounded-lg border px-3 py-3 font-mono disabled:bg-slate-50 disabled:text-slate-600"
            placeholder="Ex: TMP-1088-W ou descrição"
            autoComplete="off"
          />
          {sugestoes.length > 0 && !produto && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-white shadow-lg">
              {sugestoes.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-brand-light"
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      selecionarProduto(p);
                    }}
                  >
                    <span className="font-mono text-xs">{p.codigo}</span> —{" "}
                    {p.descricao}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>

        {produto && (
          <div className="rounded-lg bg-brand-light px-3 py-2 text-sm">
            <div className="font-medium">{produto.descricao}</div>
            <div className="text-slate-600">
              Preço: R$ {Number(produto.precoUnitario).toFixed(2)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-slate-700">
              <span>
                {isTransf ? "Saldo origem" : "Saldo disponível"}
                {filialOrigemLabel ? ` (${filialOrigemLabel.sigla})` : ""}:{" "}
                <strong>
                  {saldoOrigem === null ? "…" : formatQty(saldoOrigem)}
                </strong>
              </span>
              {isTransf && (
                <span>
                  Saldo destino
                  {filialDestinoLabel ? ` (${filialDestinoLabel.sigla})` : ""}:{" "}
                  <strong>
                    {saldoDestino === null ? "…" : formatQty(saldoDestino)}
                  </strong>
                </span>
              )}
            </div>
          </div>
        )}

        {user?.perfil === "OPERADOR" ? (
          isTransf ? (
            <div className="grid gap-3 md:grid-cols-2">
              {operadorMultiFilial ? (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">
                    Filial de origem
                  </span>
                  <select
                    className="w-full rounded-lg border px-3 py-3"
                    value={filialId}
                    onChange={(e) => setFilialId(e.target.value)}
                    required
                  >
                    {filiaisOrigem.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.sigla} — {f.nome}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                  <div className="font-medium text-slate-700">
                    Filial de origem
                  </div>
                  <div className="mt-1 text-slate-600">
                    {filialOrigemLabel
                      ? `${filialOrigemLabel.sigla} — ${filialOrigemLabel.nome}`
                      : "Filial do operador"}
                  </div>
                </div>
              )}
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Filial de destino
                </span>
                <select
                  className="w-full rounded-lg border px-3 py-3"
                  value={filialDestinoId}
                  onChange={(e) => setFilialDestinoId(e.target.value)}
                  required
                >
                  {filiais
                    .filter((f) => f.id !== filialId)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.sigla} — {f.nome}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          ) : operadorMultiFilial ? (
            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                Estoque (filial) afetado
              </span>
              <select
                className="w-full rounded-lg border px-3 py-3"
                value={filialId}
                onChange={(e) => setFilialId(e.target.value)}
                required
              >
                {filiaisOrigem.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.sigla} — {f.nome}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
              <div className="font-medium text-slate-700">Estoque afetado</div>
              <div className="mt-1 text-slate-600">
                {filialOrigemLabel
                  ? `${filialOrigemLabel.sigla} — ${filialOrigemLabel.nome}`
                  : "Filial do operador"}
              </div>
            </div>
          )
        ) : isTransf ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                Filial de origem
              </span>
              <select
                className="w-full rounded-lg border px-3 py-3"
                value={filialId}
                onChange={(e) => setFilialId(e.target.value)}
                required
              >
                {filiais.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.sigla} — {f.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                Filial de destino
              </span>
              <select
                className="w-full rounded-lg border px-3 py-3"
                value={filialDestinoId}
                onChange={(e) => setFilialDestinoId(e.target.value)}
                required
              >
                {filiais
                  .filter((f) => f.id !== filialId)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.sigla} — {f.nome}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        ) : (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Estoque (filial) afetado
            </span>
            <select
              className="w-full rounded-lg border px-3 py-3 disabled:bg-slate-50 disabled:text-slate-600"
              value={filialId}
              disabled={camposTravados}
              onChange={(e) => setFilialId(e.target.value)}
              required
            >
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.sigla} — {f.nome}
                </option>
              ))}
            </select>
          </label>
        )}

        {isTransf && (
          <fieldset className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
            <legend className="px-1 text-sm font-medium text-amber-950">
              Creditar Saldo no Destino
            </legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-transparent bg-white/70 px-3 py-2 text-sm hover:border-amber-200">
                <input
                  type="radio"
                  name="credito"
                  className="mt-1"
                  checked={creditoDestino === "IMEDIATO"}
                  onChange={() => setCreditoDestino("IMEDIATO")}
                />
                <span>
                  <span className="font-medium">Agora</span>
                  <span className="block text-xs text-slate-600">
                    Baixa na origem e entra no destino na mesma operação.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-transparent bg-white/70 px-3 py-2 text-sm hover:border-amber-200">
                <input
                  type="radio"
                  name="credito"
                  className="mt-1"
                  checked={creditoDestino === "AGUARDAR_RECEBIMENTO"}
                  onChange={() => setCreditoDestino("AGUARDAR_RECEBIMENTO")}
                />
                <span>
                  <span className="font-medium">
                    Na Confirmação do Recebimento
                  </span>
                  <span className="block text-xs text-slate-600">
                    Fica em trânsito; o destino confirma em Confirmar Recebimento.
                  </span>
                </span>
              </label>
            </div>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium text-amber-950">
                Transportadora / guia
              </span>
              <input
                type="text"
                maxLength={120}
                value={guiaTransporte}
                onChange={(e) => setGuiaTransporte(e.target.value)}
                placeholder="Nome da transportadora ou nº da guia (opcional)"
                className="w-full rounded-lg border border-amber-100 bg-white px-3 py-2"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Campo livre — cadastro de transportadoras virá no futuro.
              </span>
            </label>
          </fieldset>
        )}

        {precisaCliente && (
          <>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                Cliente / Fornecedor
              </span>
              <select
                required
                disabled={camposTravados}
                className="w-full rounded-lg border px-3 py-3 disabled:bg-slate-50 disabled:text-slate-600"
                value={clienteId}
                onChange={(e) => setClienteId(e.target.value)}
              >
                <option value="">Selecione</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} ({c.tipo})
                  </option>
                ))}
              </select>
            </label>

            {isRetorno && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Saída aberta a vincular
                </span>
                <select
                  required
                  disabled={camposTravados}
                  className="w-full rounded-lg border px-3 py-3 disabled:bg-slate-50 disabled:text-slate-600"
                  value={movimentacaoOrigemId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setMovimentacaoOrigemId(id);
                    const s = saidasAbertas.find((x) => x.id === id);
                    if (s) {
                      setProduto(s.produto);
                      setCodigo(s.produto.codigo);
                      setQuantidade(
                        String(s.qtyRestante ?? s.quantidade)
                      );
                      setFilialId(s.filial.id);
                    }
                  }}
                >
                  <option value="">
                    {!clienteId
                      ? "Selecione o cliente primeiro"
                      : saidasLoading
                        ? "Carregando saídas abertas…"
                        : saidasAbertas.length
                          ? "Selecione a saída"
                          : "Nenhuma saída aberta para este cliente"}
                  </option>
                  {saidasAbertas.map((s) => {
                    const restante = s.qtyRestante ?? s.quantidade;
                    return (
                      <option key={s.id} value={s.id}>
                        {new Date(s.dataMovimento).toLocaleDateString("pt-BR")} ·{" "}
                        {s.produto.codigo} · aberto {restante}
                        {restante !== s.quantidade
                          ? ` / ${s.quantidade}`
                          : ""}
                        {s.notaFiscalNumero
                          ? ` · NF ${s.notaFiscalNumero}`
                          : ""}{" "}
                        · {s.filial.sigla}
                      </option>
                    );
                  })}
                </select>
                <span className="mt-1 block text-xs text-slate-500">
                  O sistema pré-preenche produto, quantidade restante e filial
                  da saída.
                </span>
              </label>
            )}

            {precisaAlerta && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  E-mails para alertas de retorno
                </span>
                <input
                  type="text"
                  required
                  value={alertaEmailsText}
                  onChange={(e) => setAlertaEmailsText(e.target.value)}
                  placeholder="financeiro@teep.com.br, outro@…"
                  className="w-full rounded-lg border px-3 py-3"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Disparos conforme os dias do tipo (calendário
                  America/Sao_Paulo), a partir desta data de lançamento
                  (separados por vírgula).
                </span>
              </label>
            )}

            <div
              className={`grid gap-3 md:grid-cols-2 ${
                retornoPrefill
                  ? "rounded-lg border border-amber-200 bg-amber-50/40 p-3"
                  : ""
              }`}
            >
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  {isRetorno
                    ? "Número da NF de retorno"
                    : "Número da nota fiscal"}
                  {isRetorno && (
                    <span className="ml-1 font-normal text-rose-600">*</span>
                  )}
                  {retornoPrefill && (
                    <span className="ml-1 font-normal text-amber-800">
                      (obrigatório)
                    </span>
                  )}
                </span>
                <input
                  ref={nfNumeroRef}
                  type="text"
                  maxLength={60}
                  required={isRetorno}
                  value={notaFiscalNumero}
                  onChange={(e) => setNotaFiscalNumero(e.target.value)}
                  placeholder="Ex.: 123456"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3"
                />
              </label>
              <div className="block">
                <span className="mb-1 block text-sm font-medium">
                  {isRetorno
                    ? "Anexo da NF de retorno"
                    : "Anexo da nota fiscal"}
                  {isRetorno && (
                    <span className="ml-1 font-normal text-rose-600">*</span>
                  )}
                </span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/gif,image/webp"
                  disabled={nfUploading}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-brand/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setError("");
                    setNfUploading(true);
                    try {
                      const fd = new FormData();
                      fd.append("file", file);
                      fd.append("context", "nota-fiscal");
                      const r = await apiUpload<{ url: string }>("/upload", fd);
                      setNotaFiscalArquivo(r.url);
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Falha no upload da nota"
                      );
                    } finally {
                      setNfUploading(false);
                    }
                  }}
                />
                <p className="mt-1 text-xs text-slate-400">
                  {isRetorno
                    ? "PDF ou imagem da NF — obrigatório para gravar o retorno."
                    : "PDF ou imagem (opcional)."}
                  {nfUploading ? " Enviando…" : ""}
                  {notaFiscalArquivo ? " Anexo pronto." : ""}
                </p>
                {notaFiscalArquivo && (
                  <p className="mt-1 text-xs text-emerald-700">
                    Arquivo anexado.{" "}
                    <a
                      href={resolveAssetUrl(notaFiscalArquivo) || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Abrir
                    </a>
                    {" · "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setNotaFiscalArquivo(null)}
                    >
                      Remover
                    </button>
                  </p>
                )}
              </div>
            </div>

            {precisaTermo && (
              <div className="block rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                <span className="mb-1 block text-sm font-medium">
                  Termo de recebimento (assinado){" "}
                  <span className="font-normal text-slate-400">(opcional agora)</span>
                </span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/gif,image/webp"
                  disabled={termoUploading}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-brand/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setError("");
                    setTermoUploading(true);
                    try {
                      const fd = new FormData();
                      fd.append("file", file);
                      fd.append("context", "documento");
                      const r = await apiUpload<{ url: string }>("/upload", fd);
                      setTermoArquivo(r.url);
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Falha no upload do termo"
                      );
                    } finally {
                      setTermoUploading(false);
                    }
                  }}
                />
                <p className="mt-1 text-xs text-slate-500">
                  O técnico leva o material e o termo volta assinado depois —
                  você pode anexar aqui ou mais tarde em{" "}
                  <span className="font-medium">Movimentações</span>.
                  {termoUploading ? " Enviando…" : ""}
                </p>
                {termoArquivo && (
                  <p className="mt-1 text-xs text-emerald-700">
                    Termo anexado.{" "}
                    <a
                      href={resolveAssetUrl(termoArquivo) || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Abrir
                    </a>
                    {" · "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setTermoArquivo(null)}
                    >
                      Remover
                    </button>
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Quantidade</span>
          {produto?.controlaSerie ? (
            <input
              type="number"
              readOnly
              value={series.length || ""}
              className="w-full rounded-lg border bg-slate-50 px-3 py-3 text-slate-700"
            />
          ) : (
            <input
              type="number"
              min="0.0001"
              step="any"
              required
              disabled={camposTravados}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              className="w-full rounded-lg border px-3 py-3 disabled:bg-slate-50 disabled:text-slate-600"
            />
          )}
        </label>

        {produto?.controlaSerie ? (
          <SeriesInput
            value={series}
            onChange={setSeries}
            disabled={camposTravados}
            label="Números de série (digite os códigos físicos)"
          />
        ) : null}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Observação</span>
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder={
              retornoPrefill ? "Opcional — detalhes do retorno" : undefined
            }
            className="w-full rounded-lg border px-3 py-3"
          />
        </label>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {msg && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {msg}
            {lastTransferId && (
              <>
                {" "}
                <Link
                  href={`/transferencias/${lastTransferId}`}
                  className="font-medium underline"
                >
                  Conferir recebimento
                </Link>
              </>
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={!podeSalvar}
          className="w-full rounded-lg bg-brand py-3.5 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {loading
            ? "Salvando…"
            : prefillLoading
              ? "Carregando…"
              : isTransf
                ? "Registrar transferência"
                : isRetorno
                  ? nfRetornoOk
                    ? "Confirmar retorno"
                    : "Informe a NF para confirmar"
                  : "Salvar lançamento"}
        </button>
        {isRetorno && !nfRetornoOk && !prefillLoading && (
          <p className="text-center text-xs text-slate-500">
            O retorno só é gravado ao confirmar — número e anexo da NF são
            obrigatórios.
          </p>
        )}
      </form>
    </>
  );
}
