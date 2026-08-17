"use client";

import { ConfirmMotivoPanel } from "@/components/ConfirmMotivoPanel";
import {
  RmaItemWorkflowPanel,
  type RmaItemWorkflowData,
} from "@/components/rma/RmaItemWorkflowPanel";
import { api, apiUpload, getStoredUser } from "@/lib/api";
import { userHas } from "@/lib/access";
import { resolveAssetUrl } from "@/lib/assets";
import { matchNomeOuDocumento } from "@/lib/documento";
import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { SIGLA_ESTOQUE_DESCARTE, RMA_ITEM_ETAPA_LABELS } from "@teep/shared";

type RmaAnexo = {
  id: string;
  tipo: string;
  arquivo: string;
  label?: string | null;
  itemId?: string | null;
  ativo?: boolean;
  substituidoEm?: string | null;
  criadoEm?: string;
};

type MovVinculo = {
  id: string;
  status: string;
  dataMovimento?: string;
  transferenciaItem?: { transferenciaId: string } | null;
};

type RmaItem = {
  id: string;
  status: string;
  etapa?: string;
  produtoId: string;
  quantidade: string | number;
  observacao?: string | null;
  cobrou?: boolean | null;
  valorCobrado?: string | number | null;
  nfCobrancaNumero?: string | null;
  aprovacaoEm?: string | null;
  aprovacaoObs?: string | null;
  aprovacaoPor?: { id: string; nome: string } | null;
  produto: { id: string; codigo: string; descricao: string };
  unidadeSerie?: { id: string; numeroSerie: string } | null;
  unidadeSerieSubstituicao?: { id: string; numeroSerie: string } | null;
  anexos?: RmaAnexo[];
  movEntradaId?: string | null;
  movSaidaId?: string | null;
  movDescarteId?: string | null;
  movEntrada?: MovVinculo | null;
  movSaida?: MovVinculo | null;
  movDescarte?: MovVinculo | null;
  checklistExecucoes?: RmaItemWorkflowData["checklistExecucoes"];
  diagnostico?: RmaItemWorkflowData["diagnostico"];
  manutencaoPlano?: RmaItemWorkflowData["manutencaoPlano"];
  orcamento?: RmaItemWorkflowData["orcamento"];
};

type Rma = {
  id: string;
  status: string;
  cobrou: boolean | null;
  valorCobrado: string | number | null;
  nfCobrancaNumero: string | null;
  nfEntradaNumero: string | null;
  nfSaidaNumero: string | null;
  observacao: string | null;
  criadoEm: string;
  responsavelComercialId?: string | null;
  cliente: { id: string; nome: string; documento?: string | null };
  filial: { id: string; sigla: string; nome: string };
  criadoPor: { nome: string };
  responsavelComercial?: { id: string; nome: string; email?: string } | null;
  destinatarios?: Array<{
    id: string;
    origem: string;
    usuario: { id: string; nome: string; email: string; ativo?: boolean };
  }>;
  anexos: RmaAnexo[];
  itens: RmaItem[];
};

const PROC_STATUS: Record<string, string> = {
  ABERTO: "Aberto",
  FECHADO: "Fechado",
  CANCELADO: "Cancelado",
};

const ITEM_STATUS: Record<string, string> = {
  ABERTO: "Aberto",
  EM_ESTOQUE: "Em estoque RMA",
  SEM_MANUTENCAO: "Sem manutenção",
  DEVOLVIDO: "Devolvido",
  DESCARTADO: "Descartado / trocado",
  CANCELADO: "Cancelado",
};

const ETAPA_LABEL: Record<string, string> = {
  ...RMA_ITEM_ETAPA_LABELS,
};

const ETAPAS_SAIDA = new Set(["AGUARDANDO_ENVIO", "NAO_APROVADO"]);

function etapaBadgeClass(etapa: string) {
  switch (etapa) {
    case "AGUARDANDO_RECEBIMENTO":
    case "AGUARDANDO_LAUDO":
      return "bg-violet-100 text-violet-900";
    case "AGUARDANDO_ORCAMENTO":
      return "bg-orange-100 text-orange-900";
    case "AGUARDANDO_APROVACAO":
      return "bg-amber-100 text-amber-900";
    case "AGUARDANDO_MANUTENCAO":
      return "bg-sky-100 text-sky-900";
    case "AGUARDANDO_LIBERACAO":
      return "bg-indigo-100 text-indigo-900";
    case "AGUARDANDO_ENVIO":
      return "bg-emerald-100 text-emerald-800";
    case "NAO_APROVADO":
      return "bg-slate-200 text-slate-700";
    case "FINALIZADO":
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-violet-100 text-violet-900";
  }
}

type FilialOpt = { id: string; nome: string; sigla: string; ativo?: boolean };
type SerieOpt = { id: string; numeroSerie: string };
type ClienteOpt = {
  id: string;
  nome: string;
  tipo: string;
  documento?: string | null;
  ativo: boolean;
};
type ProdutoOpt = {
  id: string;
  codigo: string;
  descricao: string;
  controlaSerie: boolean;
};

type RmaDefaults = {
  filialPreparacaoId: string | null;
  filialDescarteId: string | null;
  filiaisOrigemTrocaIds: string[];
  filiaisOrigemTroca: FilialOpt[];
  avisos?: string[];
};

/** Nome curto para UI; nome completo fica no title. */
function nomeAnexoCurto(label?: string | null, fallback = "Abrir arquivo") {
  const raw = (label || fallback).trim();
  if (raw.length <= 28) return raw;
  const dot = raw.lastIndexOf(".");
  const ext = dot > 0 && raw.length - dot <= 8 ? raw.slice(dot) : "";
  const base = ext ? raw.slice(0, raw.length - ext.length) : raw;
  return `${base.slice(0, 22)}…${ext}`;
}

function anexoAtivoPorTipo(anexos: RmaAnexo[], tipo: string) {
  return anexos.find((a) => a.tipo === tipo && a.ativo !== false) || null;
}

function descricaoProdutoLimpa(codigo: string, descricao: string): string {
  const c = codigo.trim();
  const d = descricao.trim();
  if (!c || !d) return d;
  const esc = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const semPrefixo = d
    .replace(new RegExp(`^${esc}\\s*[—\\-–:]?\\s*`, "i"), "")
    .trim();
  return semPrefixo || d;
}

export default function RmaDetalhePage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || "");
  const user = getStoredUser();
  const canFin = Boolean(user && userHas(user, "rma_cobranca"));
  const canCancelar =
    user?.perfil === "ADMIN" || user?.perfil === "GERENTE";

  const [row, setRow] = useState<Rma | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [acting, setActing] = useState(false);
  const actingRef = useRef(false);

  const [nfEnt, setNfEnt] = useState("");
  const [nfSai, setNfSai] = useState("");
  const [obs, setObs] = useState("");
  /** Cobrança editável por item */
  const [itemFinEditId, setItemFinEditId] = useState<string | null>(null);
  const [itemCobrou, setItemCobrou] = useState<"" | "true" | "false">("");
  const [itemValor, setItemValor] = useState("");
  const [itemNfCob, setItemNfCob] = useState("");

  /** Item com painel de troca aberto */
  const [trocaItemId, setTrocaItemId] = useState<string | null>(null);
  const [filiais, setFiliais] = useState<FilialOpt[]>([]);
  const [rmaDefaults, setRmaDefaults] = useState<RmaDefaults | null>(null);
  const [origemFilialId, setOrigemFilialId] = useState("");
  const [destinoDescarteId, setDestinoDescarteId] = useState("");
  const [serieBoa, setSerieBoa] = useState("");
  const [seriesDisp, setSeriesDisp] = useState<SerieOpt[]>([]);
  const [trocaObs, setTrocaObs] = useState("");
  const [painelAcao, setPainelAcao] = useState<
    null | "cancelar" | "devolver-todos"
  >(null);
  const [motivoAcao, setMotivoAcao] = useState("");
  const [removerItemId, setRemoverItemId] = useState<string | null>(null);

  const [editCliente, setEditCliente] = useState(false);
  const [clientes, setClientes] = useState<ClienteOpt[]>([]);
  const [clienteQuery, setClienteQuery] = useState("");
  const [clienteOpen, setClienteOpen] = useState(false);
  const [clienteIdEdit, setClienteIdEdit] = useState("");

  const [showAddItem, setShowAddItem] = useState(false);
  const [editDest, setEditDest] = useState(false);
  const [destTodos, setDestTodos] = useState<
    Array<{ id: string; nome: string; email: string }>
  >([]);
  const [destIdsEdit, setDestIdsEdit] = useState<string[]>([]);
  const [destQuery, setDestQuery] = useState("");
  const [notifyingLaudos, setNotifyingLaudos] = useState(false);
  const [editComercial, setEditComercial] = useState(false);
  const [comercialIdEdit, setComercialIdEdit] = useState("");
  const [usuariosComercial, setUsuariosComercial] = useState<
    Array<{ id: string; nome: string; email: string }>
  >([]);
  const [addProdutoId, setAddProdutoId] = useState("");
  const [addProdutoQuery, setAddProdutoQuery] = useState("");
  const [addProdutoSugestoes, setAddProdutoSugestoes] = useState<ProdutoOpt[]>(
    []
  );
  const [addProdutoOpen, setAddProdutoOpen] = useState(false);
  const [addSerie, setAddSerie] = useState("");
  const addSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addSearchAbort = useRef<AbortController | null>(null);

  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      setError("");
      try {
        const r = await api<Rma>(`/rma/${id}`);
        if (signal?.cancelled) return;
        setRow(r);
        setNfEnt(r.nfEntradaNumero || "");
        setNfSai(r.nfSaidaNumero || "");
        setObs(r.observacao || "");
      } catch (e) {
        if (signal?.cancelled) return;
        setError(e instanceof Error ? e.message : "Erro");
      }
    },
    [id]
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  async function salvarFinanceiro(e: FormEvent) {
    e.preventDefault();
    if (!canFin || actingRef.current) return;
    if (row?.status !== "ABERTO") {
      setError("Processo fechado ou cancelado — financeiro somente leitura");
      return;
    }
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/financeiro`, {
        method: "PATCH",
        body: JSON.stringify({
          nfEntradaNumero: nfEnt.trim() || null,
          nfSaidaNumero: nfSai.trim() || null,
          observacao: obs.trim() || null,
        }),
      });
      setMsg("Dados do processo salvos");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function salvarItemFinanceiro(itemId: string) {
    if (!canFin || actingRef.current) return;
    if (row?.status === "CANCELADO") {
      setError("Processo cancelado — cobrança indisponível");
      return;
    }
    if (itemCobrou === "true") {
      const v = Number(itemValor.replace(",", "."));
      if (!(v > 0)) {
        setError("Informe o valor cobrado (maior que zero)");
        return;
      }
      if (!itemNfCob.trim()) {
        setError("Informe o número da NF de cobrança");
        return;
      }
    }
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      const body: Record<string, unknown> = {};
      if (itemCobrou === "true") {
        body.cobrou = true;
        body.valorCobrado = Number(itemValor.replace(",", "."));
        body.nfCobrancaNumero = itemNfCob.trim();
      } else if (itemCobrou === "false") {
        body.cobrou = false;
      } else {
        body.cobrou = null;
      }
      await api(`/rma/${id}/itens/${itemId}/financeiro`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setMsg("Cobrança do item salva");
      setItemFinEditId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function uploadAnexo(tipo: string, file: File, itemId?: string) {
    if (actingRef.current) return;
    if (tipo === "LAUDO" && !itemId) {
      setError("Selecione o item (produto/série) para anexar o laudo");
      return;
    }
    const status = row?.status;
    if (status === "CANCELADO") {
      setError("Processo cancelado — não é possível anexar");
      return;
    }
    if (status === "FECHADO" && tipo !== "NF_COBRANCA") {
      setError(
        "Processo fechado — só a NF de cobrança pode ser anexada pelo financeiro"
      );
      return;
    }
    if (
      (tipo === "NF_ENTRADA" ||
        tipo === "NF_SAIDA" ||
        tipo === "NF_COBRANCA") &&
      !canFin
    ) {
      setError("Sem permissão para anexar NF");
      return;
    }
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("context", "rma");
      fd.append("kind", tipo === "LAUDO" ? "laudo" : "nf");
      const up = await apiUpload<{ url: string }>("/upload", fd);
      if (!up?.url || typeof up.url !== "string") {
        throw new Error("Upload não retornou o caminho do arquivo");
      }
      const labelRaw = file.name.trim();
      let label: string | null = null;
      if (labelRaw) {
        if (labelRaw.length <= 120) {
          label = labelRaw;
        } else {
          const dot = labelRaw.lastIndexOf(".");
          const ext =
            dot > 0 && labelRaw.length - dot <= 10 ? labelRaw.slice(dot) : "";
          label = ext
            ? `${labelRaw.slice(0, Math.max(1, 120 - ext.length))}${ext}`
            : labelRaw.slice(0, 120);
        }
      }
      await api(`/rma/${id}/anexos`, {
        method: "POST",
        body: JSON.stringify({
          tipo,
          arquivo: up.url,
          label,
          ...(itemId ? { itemId } : {}),
        }),
      });
      setMsg(
        tipo === "LAUDO"
          ? "Laudo atualizado"
          : tipo.startsWith("NF")
            ? "Nota atualizada"
            : "Anexo enviado"
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function devolver(
    itemIds?: string[],
    observacao?: string,
    sucessoMsg?: string
  ) {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/devolver`, {
        method: "POST",
        body: JSON.stringify({
          itemIds,
          nfSaidaNumero: nfSai.trim() || undefined,
          observacao: observacao?.trim() || undefined,
        }),
      });
      setMsg(
        sucessoMsg ||
          (itemIds?.length
            ? `${itemIds.length} item(ns) devolvido(s) ao cliente.`
            : "Itens devolvidos ao cliente.")
      );
      setTrocaItemId(null);
      setPainelAcao(null);
      setMotivoAcao("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function confirmarCancelarRma() {
    const motivo = motivoAcao.trim();
    if (!motivo || actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/cancelar`, {
        method: "POST",
        body: JSON.stringify({ observacao: motivo }),
      });
      setMsg("RMA cancelado. Entradas estornadas quando havia estoque.");
      setPainelAcao(null);
      setMotivoAcao("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function salvarCliente() {
    if (!clienteIdEdit || actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/cliente`, {
        method: "PATCH",
        body: JSON.stringify({ clienteId: clienteIdEdit }),
      });
      setMsg("Cliente atualizado");
      setEditCliente(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function confirmarRemoverItem() {
    const motivo = motivoAcao.trim();
    if (!removerItemId || !motivo || actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/itens/${removerItemId}/remover`, {
        method: "POST",
        body: JSON.stringify({ observacao: motivo }),
      });
      setMsg("Item removido. Entrada estornada.");
      setRemoverItemId(null);
      setMotivoAcao("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  function onAddProdutoQuery(q: string) {
    setAddProdutoQuery(q);
    setAddProdutoId("");
    setAddProdutoOpen(true);
    if (addSearchTimer.current) clearTimeout(addSearchTimer.current);
    addSearchAbort.current?.abort();
    if (!q.trim()) {
      setAddProdutoSugestoes([]);
      return;
    }
    addSearchTimer.current = setTimeout(() => {
      const ac = new AbortController();
      addSearchAbort.current = ac;
      void api<ProdutoOpt[]>(
        `/produtos/busca?q=${encodeURIComponent(q.trim())}`,
        { signal: ac.signal }
      )
        .then((list) =>
          setAddProdutoSugestoes(list.filter((p) => p.controlaSerie))
        )
        .catch((e) => {
          if (e instanceof Error && e.name === "AbortError") return;
          setAddProdutoSugestoes([]);
        });
    }, 250);
  }

  async function adicionarItem(e: FormEvent) {
    e.preventDefault();
    if (actingRef.current) return;
    const sn = addSerie.trim();
    if (!addProdutoId || !sn) {
      setError("Selecione o produto e informe o número de série");
      return;
    }
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/itens`, {
        method: "POST",
        body: JSON.stringify({
          produtoId: addProdutoId,
          series: [sn],
        }),
      });
      setMsg("Item incluído no RMA");
      setShowAddItem(false);
      setAddProdutoId("");
      setAddProdutoQuery("");
      setAddProdutoSugestoes([]);
      setAddSerie("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function abrirEditarDestinatarios() {
    setError("");
    setEditDest(true);
    setDestIdsEdit((row?.destinatarios || []).map((d) => d.usuario.id));
    if (destTodos.length === 0) {
      try {
        const list = await api<
          Array<{ id: string; nome: string; email: string }>
        >("/rma/usuarios-destinatarios");
        setDestTodos(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro");
      }
    }
  }

  async function salvarDestinatarios() {
    if (actingRef.current) return;
    if (destIdsEdit.length === 0) {
      setError("Selecione ao menos um destinatário");
      return;
    }
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/destinatarios`, {
        method: "PATCH",
        body: JSON.stringify({ destinatarioIds: destIdsEdit }),
      });
      setMsg("Destinatários atualizados");
      setEditDest(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function notificarLaudos() {
    if (actingRef.current || notifyingLaudos) return;
    if (row?.status !== "ABERTO") {
      setError("RMA fechado ou cancelado — aviso indisponível");
      return;
    }
    actingRef.current = true;
    setNotifyingLaudos(true);
    setActing(true);
    setError("");
    setMsg("");
    try {
      const r = await api<{ qtdLaudos: number; qtdDestinatarios: number }>(
        `/rma/${id}/notificar-laudos`,
        { method: "POST" }
      );
      setMsg(
        `Diagnóstico avisado (${r.qtdLaudos}) para ${r.qtdDestinatarios} usuário(s).`
      );
      router.push("/rma?ok=laudos");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setNotifyingLaudos(false);
      setActing(false);
    }
  }

  async function abrirEditarComercial() {
    setError("");
    setEditComercial(true);
    setEditDest(false);
    setComercialIdEdit(
      row?.responsavelComercialId || row?.responsavelComercial?.id || ""
    );
    if (usuariosComercial.length === 0) {
      try {
        const list = await api<
          Array<{ id: string; nome: string; email: string }>
        >("/rma/usuarios-destinatarios");
        setUsuariosComercial(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro");
      }
    }
  }

  async function salvarComercial() {
    if (actingRef.current || !comercialIdEdit) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/comercial`, {
        method: "PATCH",
        body: JSON.stringify({ responsavelComercialId: comercialIdEdit }),
      });
      setMsg("Responsável comercial atualizado");
      setEditComercial(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function marcarManutencaoRealizada(itemId: string) {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/itens/${itemId}/manutencao-realizada`, {
        method: "POST",
      });
      setMsg("Manutenção marcada — item aguarda checklist de liberação");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function abrirTroca(item: RmaItem) {
    setError("");
    setTrocaItemId(item.id);
    setSerieBoa("");
    setTrocaObs("");
    setSeriesDisp([]);
    try {
      const [list, defs] = await Promise.all([
        api<FilialOpt[]>("/filiais"),
        api<RmaDefaults>("/rma/defaults"),
      ]);
      const ativas = (list || []).filter((f) => f.ativo !== false);
      setFiliais(ativas);
      setRmaDefaults(defs);

      // Defaults vêm da API (env ou fallback por sigla de instalação) — sem preferir estoques fixos
      const descarteId = defs.filialDescarteId || "";
      setDestinoDescarteId(
        descarteId && descarteId !== row?.filial.id ? descarteId : ""
      );

      const origemPadrao = (defs.filiaisOrigemTroca || []).find(
        (f) => f.id !== row?.filial.id
      );
      setOrigemFilialId(origemPadrao?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar estoques");
    }
  }

  useEffect(() => {
    if (!trocaItemId || !origemFilialId || !row) {
      setSeriesDisp([]);
      return;
    }
    const item = row.itens.find((i) => i.id === trocaItemId);
    const produtoId = item?.produtoId || item?.produto?.id;
    if (!produtoId) {
      return;
    }
    let cancelled = false;
    api<SerieOpt[]>(
      `/series/disponiveis?produtoId=${encodeURIComponent(produtoId)}&filialId=${encodeURIComponent(origemFilialId)}`
    )
      .then((rows) => {
        if (!cancelled) setSeriesDisp(rows || []);
      })
      .catch(() => {
        if (!cancelled) setSeriesDisp([]);
      });
    return () => {
      cancelled = true;
    };
  }, [trocaItemId, origemFilialId, row]);

  async function confirmarTroca() {
    if (!trocaItemId || actingRef.current) return;
    if (!origemFilialId) {
      setError("Selecione o estoque de origem da peça boa");
      return;
    }
    if (!serieBoa.trim()) {
      setError("Informe a série substituta");
      return;
    }
    if (!destinoDescarteId) {
      setError("Selecione o estoque de descarte");
      return;
    }
    if (
      !confirm(
        "Confirmar troca? A série boa será transferida e expedida ao cliente; a série ruim vai ao descarte."
      )
    ) {
      return;
    }
    actingRef.current = true;
    setActing(true);
    setError("");
    setMsg("");
    try {
      await api(`/rma/${id}/trocar`, {
        method: "POST",
        body: JSON.stringify({
          itemId: trocaItemId,
          origemFilialId,
          numeroSerieBoa: serieBoa.trim(),
          destinoDescarteFilialId: destinoDescarteId,
          nfSaidaNumero: nfSai.trim() || undefined,
          observacao: trocaObs.trim() || undefined,
        }),
      });
      setMsg("Troca concluída");
      setTrocaItemId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  if (!row && !error) {
    return <p className="text-sm text-slate-500">Carregando…</p>;
  }
  if (!row) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }

  const noRma = row.itens.filter(
    (i) => i.status === "EM_ESTOQUE" || i.status === "SEM_MANUTENCAO"
  );
  const itensParaDevolver = noRma.filter((i) =>
    ETAPAS_SAIDA.has(i.etapa || "")
  );
  const itensAtivos = row.itens.filter((i) => i.status !== "CANCELADO");
  const itensRemovidos = row.itens.filter((i) => i.status === "CANCELADO");
  const processoAberto = row.status === "ABERTO";
  const itensAguardandoAprovacao = itensAtivos.filter(
    (i) => i.etapa === "AGUARDANDO_APROVACAO"
  );
  const ctaOrcamento = itensAtivos.some((i) => i.etapa === "AGUARDANDO_ORCAMENTO")
    ? "Gerar orçamento"
    : itensAguardandoAprovacao.length > 0
      ? "PDF e orçar com cliente"
      : "Orçamento";
  const podeDecidirAprovacao =
    processoAberto &&
    (canCancelar ||
      (user?.id &&
        user.id ===
          (row.responsavelComercialId || row.responsavelComercial?.id)));
  const podeEditarComercial =
    processoAberto &&
    itensAtivos.some((i) =>
      [
        "AGUARDANDO_RECEBIMENTO",
        "AGUARDANDO_ORCAMENTO",
        "AGUARDANDO_APROVACAO",
        "AGUARDANDO_LAUDO",
      ].includes(i.etapa || "")
    );
  /** NFs do processo só com RMA aberto; cobrança por item também após FECHADO. */
  const canEditFin = canFin && processoAberto;
  const canEditCobrancaItem = canFin && row.status !== "CANCELADO";
  const resumoEtapas = (() => {
    const counts = new Map<string, number>();
    for (const i of itensAtivos) {
      const e = i.etapa || "AGUARDANDO_RECEBIMENTO";
      counts.set(e, (counts.get(e) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([e, n]) => `${n} ${ETAPA_LABEL[e] || e}`)
      .join(" · ");
  })();
  const podeEditarCliente =
    processoAberto &&
    !row.itens.some(
      (i) => i.status === "DEVOLVIDO" || i.status === "DESCARTADO"
    );
  const clientesFiltrados = clientes
    .filter((c) => matchNomeOuDocumento(c.nome, c.documento, clienteQuery))
    .slice(0, 20);
  const itemRemovendo = removerItemId
    ? row.itens.find((i) => i.id === removerItemId)
    : null;

  return (
    <div>
      <div className="mb-2">
        <Link href="/rma" className="text-sm text-brand underline">
          ← Voltar
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">RMA</h1>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">
          {PROC_STATUS[row.status] || row.status}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        <span className="font-medium text-slate-800">{row.cliente.nome}</span>
        {podeEditarCliente && !editCliente && (
          <>
            {" "}
            <button
              type="button"
              disabled={acting}
              className="text-xs text-brand underline disabled:opacity-50"
              onClick={() => {
                setEditCliente(true);
                setShowAddItem(false);
                setRemoverItemId(null);
                setPainelAcao(null);
                setClienteIdEdit(row.cliente.id);
                setClienteQuery(
                  row.cliente.documento
                    ? `${row.cliente.nome} · ${row.cliente.documento}`
                    : row.cliente.nome
                );
                setClienteOpen(false);
                if (clientes.length === 0) {
                  void api<ClienteOpt[]>("/clientes")
                    .then((c) =>
                      setClientes(
                        c.filter(
                          (x) => x.ativo !== false && x.tipo !== "FORNECEDOR"
                        )
                      )
                    )
                    .catch((e) =>
                      setError(e instanceof Error ? e.message : "Erro")
                    );
                }
              }}
            >
              Alterar cliente
            </button>
          </>
        )}
        {" · "}
        estoque {row.filial.sigla} — {row.filial.nome} · por {row.criadoPor.nome}{" "}
        · {new Date(row.criadoEm).toLocaleString("pt-BR")}
      </p>

      {editCliente && podeEditarCliente && (
        <div className="relative mt-3 max-w-lg rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-sm font-medium text-slate-800">
            Alterar cliente do RMA
          </p>
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm"
            value={clienteQuery}
            onChange={(e) => {
              setClienteQuery(e.target.value);
              setClienteIdEdit("");
              setClienteOpen(true);
            }}
            onFocus={() => setClienteOpen(true)}
            placeholder="Buscar cliente…"
            disabled={acting}
          />
          {clienteOpen && clienteQuery.trim() && (
            <ul className="absolute z-20 mt-1 max-h-48 w-[calc(100%-1.5rem)] overflow-auto rounded-lg border bg-white shadow">
              {clientesFiltrados.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setClienteIdEdit(c.id);
                      setClienteQuery(
                        c.documento ? `${c.nome} · ${c.documento}` : c.nome
                      );
                      setClienteOpen(false);
                    }}
                  >
                    {c.nome}
                    {c.documento ? (
                      <span className="text-slate-500"> · {c.documento}</span>
                    ) : null}
                  </button>
                </li>
              ))}
              {clientesFiltrados.length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-500">
                  Nenhum cliente
                </li>
              )}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={acting || !clienteIdEdit}
              onClick={() => void salvarCliente()}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Salvar cliente
            </button>
            <button
              type="button"
              disabled={acting}
              onClick={() => {
                setEditCliente(false);
                setClienteOpen(false);
              }}
              className="rounded-lg border px-3 py-1.5 text-sm text-slate-600"
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {msg && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">
              Comercial
            </h2>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              Aprovação e cobrança são por item. Pendente no item bloqueia
              Devolver/Trocar daquele item.
            </p>
          </div>
          {podeEditarComercial && !editComercial && (
            <button
              type="button"
              disabled={acting}
              onClick={() => void abrirEditarComercial()}
              className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
            >
              Alterar comercial
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-700">
            Comercial:{" "}
            <span className="font-medium">
              {row.responsavelComercial?.nome || "—"}
            </span>
          </span>
          {resumoEtapas && (
            <span className="text-xs text-slate-500">· {resumoEtapas}</span>
          )}
        </div>
        {editComercial && podeEditarComercial && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="min-w-[16rem] flex-1 text-xs">
              <span className="mb-1 block font-medium text-slate-600">
                Responsável comercial
              </span>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={comercialIdEdit}
                onChange={(e) => setComercialIdEdit(e.target.value)}
                disabled={acting}
              >
                <option value="">Selecione…</option>
                {usuariosComercial.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                    {u.email ? ` · ${u.email}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={acting || !comercialIdEdit}
              onClick={() => void salvarComercial()}
              className="rounded-md bg-brand px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              Salvar
            </button>
            <button
              type="button"
              disabled={acting}
              onClick={() => setEditComercial(false)}
              className="rounded-md border px-3 py-2 text-xs disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        )}
        {podeDecidirAprovacao && itensAguardandoAprovacao.length > 0 && (
          <p className="mt-2 text-xs text-amber-800">
            {itensAguardandoAprovacao.length} item(ns) aguardando aprovação —
            decida em{" "}
            <Link href={`/rma/${id}/orcamento`} className="underline">
              Orçamento
            </Link>
            .
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">
              Notificações
            </h2>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              Quem recebe sino e e-mail. “Avisar diagnóstico” só notifica a
              equipe — o orçamento fica na página Gerar orçamento.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {processoAberto && (
              <button
                type="button"
                disabled={acting}
                onClick={() => void abrirEditarDestinatarios()}
                className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
              >
                Destinatários
              </button>
            )}
            <button
              type="button"
              disabled={acting || notifyingLaudos || !processoAberto}
              title={
                !processoAberto
                  ? "RMA fechado ou cancelado — aviso indisponível"
                  : undefined
              }
              onClick={() => void notificarLaudos()}
              className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {notifyingLaudos ? "Enviando…" : "Avisar diagnóstico"}
            </button>
          </div>
        </div>
        {!editDest && (
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {(row.destinatarios || []).length === 0 ? (
              <li className="text-xs text-slate-500">
                Nenhum destinatário cadastrado.
              </li>
            ) : (
              (row.destinatarios || []).map((d) => (
                <li key={d.id}>
                  {d.usuario.nome}
                  <span className="text-slate-400"> · {d.usuario.email}</span>
                  {d.origem === "GLOBAL" && (
                    <span className="ml-1 text-[10px] text-slate-500">
                      (global)
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
        {editDest && (
          <div className="mt-2 space-y-2">
            <ul className="max-h-40 space-y-1 overflow-auto text-sm">
              {destTodos
                .filter((u) => destIdsEdit.includes(u.id))
                .map((u) => (
                  <li key={u.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        setDestIdsEdit((ids) =>
                          ids.filter((x) => x !== u.id)
                        )
                      }
                    />
                    <span>
                      {u.nome}
                      <span className="text-slate-400"> · {u.email}</span>
                    </span>
                  </li>
                ))}
            </ul>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="Buscar para incluir…"
              value={destQuery}
              onChange={(e) => setDestQuery(e.target.value)}
            />
            <ul className="max-h-32 overflow-auto rounded border bg-white text-sm">
              {destTodos
                .filter((u) => !destIdsEdit.includes(u.id))
                .filter((u) => {
                  const q = destQuery.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    u.nome.toLowerCase().includes(q) ||
                    u.email.toLowerCase().includes(q)
                  );
                })
                .slice(0, 10)
                .map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                      onClick={() =>
                        setDestIdsEdit((ids) => [...ids, u.id])
                      }
                    >
                      {u.nome}
                      <span className="text-slate-400"> · {u.email}</span>
                    </button>
                  </li>
                ))}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={acting}
                onClick={() => void salvarDestinatarios()}
                className="rounded-md bg-brand px-3 py-1.5 text-xs text-white disabled:opacity-50"
              >
                Salvar destinatários
              </button>
              <button
                type="button"
                disabled={acting}
                onClick={() => setEditDest(false)}
                className="rounded-md border px-3 py-1.5 text-xs"
              >
                Voltar
              </button>
            </div>
          </div>
        )}
      </section>
      </div>

      <section className="mt-4 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">Processo / NFs</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              NF entrada e NF de retorno (saída): incluir antes de fechar; depois
              só visualização. NF de cobrança: financeiro pode anexar também
              após o fechamento. Cobrança de manutenção (valor/NF) fica em cada
              item.
              {!canFin && " Sem permissão de cobrança — somente leitura."}
              {canFin &&
                !processoAberto &&
                " Processo fechado — retorno somente leitura; cobrança editável."}
            </p>
          </div>
          {canEditFin && (
            <button
              type="submit"
              form="rma-financeiro-form"
              disabled={acting}
              className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Salvar
            </button>
          )}
        </div>

        <form
          id="rma-financeiro-form"
          onSubmit={(e) => void salvarFinanceiro(e)}
          className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          <label className="block text-xs">
            <span className="mb-0.5 block font-medium text-slate-600">
              NF entrada
            </span>
            <input
              disabled={!canEditFin || acting}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50"
              value={nfEnt}
              onChange={(e) => setNfEnt(e.target.value)}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-0.5 block font-medium text-slate-600">
              NF retorno
            </span>
            <input
              disabled={!canEditFin || acting}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50"
              value={nfSai}
              onChange={(e) => setNfSai(e.target.value)}
            />
          </label>
          <label className="block text-xs sm:col-span-2 lg:col-span-3">
            <span className="mb-0.5 block font-medium text-slate-600">
              Observação
            </span>
            <input
              disabled={!canEditFin || acting}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Opcional"
            />
          </label>
        </form>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Arquivos do RMA
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["NF_ENTRADA", "NF entrada", "antesFechar"],
                ["NF_SAIDA", "NF retorno", "antesFechar"],
                ["NF_COBRANCA", "NF cobrança", "financeiro"],
              ] as const
            ).map(([tipo, titulo, regra]) => {
              const atual = anexoAtivoPorTipo(row.anexos, tipo);
              const hist = row.anexos.filter(
                (a) => a.tipo === tipo && a.ativo === false
              );
              const podeAnexar =
                regra === "financeiro"
                  ? canEditCobrancaItem
                  : canEditFin;
              return (
                <div
                  key={tipo}
                  className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      {titulo}
                    </span>
                    {podeAnexar && (
                      <label className="shrink-0 cursor-pointer text-[11px] font-medium text-brand underline underline-offset-2">
                        {atual ? "Trocar" : "Anexar"}
                        <input
                          type="file"
                          className="hidden"
                          disabled={acting}
                          accept=".pdf,image/*"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void uploadAnexo(tipo, f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                  {atual ? (
                    <a
                      href={resolveAssetUrl(atual.arquivo) || "#"}
                      target="_blank"
                      rel="noreferrer"
                      title={atual.label || titulo}
                      className="truncate text-xs text-brand underline underline-offset-2"
                    >
                      {nomeAnexoCurto(atual.label, "Ver arquivo")}
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">Sem arquivo</span>
                  )}
                  {hist.length > 0 && (
                    <details className="text-[11px] text-slate-500">
                      <summary className="cursor-pointer select-none">
                        Anteriores ({hist.length})
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {hist.map((a) => (
                          <li key={a.id} className="min-w-0">
                            <a
                              href={resolveAssetUrl(a.arquivo) || "#"}
                              target="_blank"
                              rel="noreferrer"
                              title={a.label || titulo}
                              className="block truncate text-brand underline"
                            >
                              {nomeAnexoCurto(a.label, "Arquivo")}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">
              Itens / Estoque
            </h2>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              Checklist e diagnóstico no sistema · devolução ou troca após
              aprovação comercial.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {processoAberto && (
              <button
                type="button"
                disabled={
                  acting ||
                  painelAcao !== null ||
                  removerItemId !== null ||
                  showAddItem
                }
                onClick={() => {
                  setError("");
                  setEditCliente(false);
                  setShowAddItem(true);
                  setAddProdutoId("");
                  setAddProdutoQuery("");
                  setAddProdutoSugestoes([]);
                  setAddSerie("");
                  setRemoverItemId(null);
                  setPainelAcao(null);
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 disabled:opacity-50"
              >
                Incluir item
              </button>
            )}
            {itensParaDevolver.length > 0 && (
              <button
                type="button"
                disabled={
                  acting || painelAcao !== null || removerItemId !== null
                }
                onClick={() => {
                  setError("");
                  setMotivoAcao("");
                  setEditCliente(false);
                  setRemoverItemId(null);
                  setShowAddItem(false);
                  setPainelAcao("devolver-todos");
                }}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Devolver liberados ({itensParaDevolver.length})
              </button>
            )}
            {canCancelar && row.status === "ABERTO" && (
              <button
                type="button"
                disabled={
                  acting || painelAcao !== null || removerItemId !== null
                }
                onClick={() => {
                  setError("");
                  setMotivoAcao("");
                  setEditCliente(false);
                  setRemoverItemId(null);
                  setShowAddItem(false);
                  setPainelAcao("cancelar");
                }}
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
              >
                Cancelar RMA
              </button>
            )}
          </div>
        </div>

        {showAddItem && processoAberto && (
          <form
            onSubmit={(e) => void adicionarItem(e)}
            className="relative mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
          >
            <p className="text-sm font-medium text-slate-800">
              Incluir produto / série
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
            <label className="relative block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Produto *
              </span>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={addProdutoQuery}
                onChange={(e) => onAddProdutoQuery(e.target.value)}
                onFocus={() => setAddProdutoOpen(true)}
                placeholder="Buscar produto com série…"
                disabled={acting}
              />
              {addProdutoOpen && addProdutoSugestoes.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-white shadow">
                  {addProdutoSugestoes.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => {
                          setAddProdutoId(p.id);
                          setAddProdutoQuery(`${p.codigo} — ${p.descricao}`);
                          setAddProdutoOpen(false);
                        }}
                      >
                        <span className="font-mono text-xs">{p.codigo}</span>{" "}
                        {p.descricao}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Número de série *
              </span>
              <input
                className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
                value={addSerie}
                onChange={(e) => setAddSerie(e.target.value)}
                disabled={acting}
                placeholder="S/N"
              />
            </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={acting || !addProdutoId || !addSerie.trim()}
                className="rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {acting ? "Aguarde…" : "Incluir no RMA"}
              </button>
              <button
                type="button"
                disabled={acting}
                onClick={() => setShowAddItem(false)}
                className="rounded-lg border px-3 py-2 text-sm text-slate-600"
              >
                Voltar
              </button>
            </div>
          </form>
        )}

        {itemRemovendo && (
          <ConfirmMotivoPanel
            title={`Excluir ${itemRemovendo.produto.codigo}${
              itemRemovendo.unidadeSerie
                ? ` · S/N ${itemRemovendo.unidadeSerie.numeroSerie}`
                : ""
            }?`}
            confirmLabel="Excluir item"
            cancelLabel="Voltar"
            motivoLabel="Motivo da exclusão"
            motivoRequired
            motivoPlaceholder="Obrigatório — ex.: série digitada errada"
            motivo={motivoAcao}
            onMotivoChange={setMotivoAcao}
            onConfirm={() => void confirmarRemoverItem()}
            onCancel={() => {
              setRemoverItemId(null);
              setMotivoAcao("");
            }}
            loading={acting}
            danger
          >
            <p className="text-xs text-slate-600">
              Estorna a entrada deste item no Estoque RMA. O processo continua
              aberto — você pode incluir o produto/série corretos. O motivo fica
              registrado na observação do RMA.
            </p>
          </ConfirmMotivoPanel>
        )}

        {painelAcao === "cancelar" && (
          <ConfirmMotivoPanel
            title="Cancelar este processo RMA?"
            confirmLabel="Confirmar cancelamento"
            cancelLabel="Voltar"
            motivoLabel="Motivo do cancelamento"
            motivoRequired
            motivoPlaceholder="Obrigatório — por que o RMA está sendo cancelado?"
            motivo={motivoAcao}
            onMotivoChange={setMotivoAcao}
            onConfirm={() => void confirmarCancelarRma()}
            onCancel={() => {
              setPainelAcao(null);
              setMotivoAcao("");
            }}
            loading={acting}
            danger
          >
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
              {noRma.length > 0 ? (
                <li>
                  Estorna as entradas de {noRma.length} item(ns) no Estoque RMA
                  (séries/saldos voltam).
                </li>
              ) : (
                <li>Não há itens no Estoque RMA para estornar.</li>
              )}
              <li>
                O processo fica <strong>CANCELADO</strong> — isto{" "}
                <strong>não</strong> é devolução ao cliente. Prefira alterar
                cliente ou remover/incluir itens quando for só correção.
              </li>
            </ul>
          </ConfirmMotivoPanel>
        )}

        {painelAcao === "devolver-todos" && (
          <ConfirmMotivoPanel
            title={`Devolver ${itensParaDevolver.length} item(ns) liberados ao cliente?`}
            confirmLabel="Confirmar devolução"
            cancelLabel="Voltar"
            motivoLabel="Observação"
            motivoPlaceholder="Opcional — ex.: NF, condição da peça, combinado com o cliente"
            motivo={motivoAcao}
            onMotivoChange={setMotivoAcao}
            onConfirm={() => {
              const ids = itensParaDevolver.map((i) => i.id);
              const qtd = ids.length;
              void devolver(
                ids,
                motivoAcao.trim() || undefined,
                `${qtd} item(ns) devolvidos ao cliente.`
              );
            }}
            onCancel={() => {
              setPainelAcao(null);
              setMotivoAcao("");
            }}
            loading={acting}
          >
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
              <li>
                Só itens em <strong>Aguardando envio</strong> ou{" "}
                <strong>Não aprovado</strong> ({itensParaDevolver.length}).
              </li>
              <li>
                Destino: cliente do processo ({row.cliente.nome}) —{" "}
                <strong>não</strong> estorna a entrada.
              </li>
            </ul>
          </ConfirmMotivoPanel>
        )}
      </section>

      <section className="mt-3 rounded-xl border bg-white p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Itens em manutenção
            <span className="ml-1.5 font-normal normal-case text-slate-400">
              ({itensAtivos.length})
            </span>
          </h3>
          {processoAberto &&
            itensAtivos.some(
              (i) =>
                i.etapa === "AGUARDANDO_ORCAMENTO" ||
                i.etapa === "AGUARDANDO_APROVACAO" ||
                Boolean(i.orcamento) ||
                Boolean(i.diagnostico)
            ) && (
              <Link
                href={`/rma/${id}/orcamento`}
                className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800"
              >
                {ctaOrcamento}
              </Link>
            )}
        </div>

        <ul className="grid gap-3 text-sm [grid-template-columns:repeat(auto-fill,minmax(min(100%,17.5rem),1fr))]">
          {itensAtivos.map((i) => {
            const origemIds = new Set(rmaDefaults?.filiaisOrigemTrocaIds || []);
            const descarteId = rmaDefaults?.filialDescarteId;
            const filiaisOrigem = filiais.filter((f) => {
              if (f.id === row.filial.id) return false;
              if (descarteId && f.id === descarteId) return false;
              if (
                !descarteId &&
                f.sigla.toUpperCase() === SIGLA_ESTOQUE_DESCARTE
              ) {
                return false;
              }
              if (origemIds.size > 0) return origemIds.has(f.id);
              return true;
            });
            const filiaisDescarte = filiais.filter((f) => f.id !== row.filial.id);
            const descLimpa = descricaoProdutoLimpa(
              i.produto.codigo,
              i.produto.descricao
            );
            /** Só troca precisa de largura extra; cobrança/aprovação ficam no card */
            const expandido = trocaItemId === i.id;
            const podeExcluir =
              processoAberto &&
              (i.status === "EM_ESTOQUE" || i.status === "SEM_MANUTENCAO");
            const podeAcoesSecundarias =
              (canEditCobrancaItem && i.status !== "CANCELADO") || podeExcluir;
            return (
              <li
                key={i.id}
                className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 sm:p-3 ${
                  expandido ? "[grid-column:1/-1]" : ""
                }`}
              >
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`max-w-full truncate rounded px-1.5 py-0.5 text-[10px] font-semibold ${etapaBadgeClass(
                        i.etapa || "AGUARDANDO_RECEBIMENTO"
                      )}`}
                    >
                      {ETAPA_LABEL[i.etapa || ""] ||
                        i.etapa ||
                        "Aguardando recebimento"}
                    </span>
                    <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                      {ITEM_STATUS[i.status] || i.status}
                    </span>
                    {i.cobrou === true && (
                      <span className="min-w-0 truncate text-[10px] text-slate-600">
                        Cobrou R${" "}
                        {Number(i.valorCobrado || 0).toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                        {i.nfCobrancaNumero
                          ? ` · NF ${i.nfCobrancaNumero}`
                          : ""}
                      </span>
                    )}
                    {i.cobrou === false && (
                      <span className="text-[10px] text-slate-500">
                        Sem cobrança
                      </span>
                    )}
                  </div>
                  <dl className="min-w-0 space-y-1 text-xs leading-snug">
                    <div className="grid grid-cols-1 gap-1 min-[360px]:grid-cols-2">
                      <div className="flex min-w-0 gap-1.5">
                        <dt className="w-9 shrink-0 font-medium text-slate-500">
                          Cód.
                        </dt>
                        <dd className="min-w-0 truncate font-mono text-slate-900" title={i.produto.codigo}>
                          {i.produto.codigo}
                        </dd>
                      </div>
                      <div className="flex min-w-0 gap-1.5">
                        <dt className="w-9 shrink-0 font-medium text-slate-500">
                          N/S
                        </dt>
                        <dd
                          className="min-w-0 truncate font-mono text-slate-900"
                          title={
                            i.unidadeSerieSubstituicao?.numeroSerie
                              ? `${i.unidadeSerie?.numeroSerie || "—"} → ${i.unidadeSerieSubstituicao.numeroSerie}`
                              : i.unidadeSerie?.numeroSerie || "—"
                          }
                        >
                          {i.unidadeSerie?.numeroSerie || "—"}
                          {i.unidadeSerieSubstituicao?.numeroSerie ? (
                            <span className="text-emerald-700">
                              {" "}
                              → {i.unidadeSerieSubstituicao.numeroSerie}
                            </span>
                          ) : null}
                        </dd>
                      </div>
                    </div>
                    <div className="flex min-w-0 gap-1.5">
                      <dt className="w-9 shrink-0 font-medium text-slate-500">
                        Desc.
                      </dt>
                      <dd
                        className="min-w-0 line-clamp-2 text-slate-700"
                        title={descLimpa || i.produto.descricao}
                      >
                        {descLimpa || i.produto.descricao || "—"}
                      </dd>
                    </div>
                  </dl>
                  <RmaItemWorkflowPanel
                    processoId={row.id}
                    item={i}
                    processoAberto={processoAberto}
                    produtoCodigo={i.produto.codigo}
                    produtoDescricao={descLimpa || i.produto.descricao}
                    numeroSerie={i.unidadeSerie?.numeroSerie || null}
                    onUpdated={async () => {
                      await load();
                    }}
                    onError={(msg) => setError(msg)}
                  />
                  {podeAcoesSecundarias && (
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-200/80 pt-2 text-xs">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                        {canEditCobrancaItem && i.status !== "CANCELADO" && (
                          <button
                            type="button"
                            disabled={acting}
                            className="min-h-8 font-medium text-brand underline disabled:opacity-50"
                            onClick={() => {
                              setItemFinEditId(i.id);
                              setItemCobrou(
                                i.cobrou === true ? "true" : "false"
                              );
                              setItemValor(
                                i.valorCobrado != null
                                  ? String(i.valorCobrado)
                                  : ""
                              );
                              setItemNfCob(i.nfCobrancaNumero || "");
                            }}
                          >
                            Cobrança
                          </button>
                        )}
                        {podeExcluir &&
                          i.etapa === "AGUARDANDO_APROVACAO" &&
                          i.orcamento && (
                            <Link
                              href={`/rma/${id}/orcamento`}
                              className="min-h-8 font-medium text-amber-800 underline"
                            >
                              PDF / orçar com cliente
                            </Link>
                          )}
                        {podeExcluir && i.etapa === "AGUARDANDO_MANUTENCAO" && (
                          <button
                            type="button"
                            disabled={acting || removerItemId !== null}
                            className="min-h-8 font-medium text-sky-800 underline disabled:opacity-50"
                            onClick={() =>
                              void marcarManutencaoRealizada(i.id)
                            }
                          >
                            Manutenção realizada
                          </button>
                        )}
                        {podeExcluir && ETAPAS_SAIDA.has(i.etapa || "") && (
                          <>
                            <button
                              type="button"
                              disabled={acting || removerItemId !== null}
                              className="min-h-8 text-brand underline disabled:opacity-50"
                              onClick={() => void devolver([i.id])}
                            >
                              Devolver
                            </button>
                            <button
                              type="button"
                              disabled={acting || removerItemId !== null}
                              className="min-h-8 text-amber-800 underline disabled:opacity-50"
                              onClick={() => void abrirTroca(i)}
                            >
                              Trocar
                            </button>
                          </>
                        )}
                      </div>
                      {podeExcluir && (
                        <button
                          type="button"
                          disabled={
                            acting ||
                            painelAcao !== null ||
                            removerItemId !== null
                          }
                          className="min-h-8 shrink-0 font-medium text-red-700 underline disabled:opacity-50"
                          onClick={() => {
                            setPainelAcao(null);
                            setShowAddItem(false);
                            setTrocaItemId(null);
                            setMotivoAcao("");
                            setRemoverItemId(i.id);
                          }}
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  )}
                  {itemFinEditId === i.id && (
                    <div className="space-y-1.5 rounded-md border border-slate-200 bg-white p-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-500">
                          Cobrou?
                        </span>
                        <div
                          className="inline-flex rounded-md border border-slate-200 p-0.5"
                          role="group"
                          aria-label="Cobrou"
                        >
                          <button
                            type="button"
                            disabled={acting}
                            onClick={() => setItemCobrou("false")}
                            className={`rounded px-2.5 py-0.5 text-[11px] font-medium disabled:opacity-50 ${
                              itemCobrou === "false"
                                ? "bg-slate-700 text-white"
                                : "text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            Não
                          </button>
                          <button
                            type="button"
                            disabled={acting}
                            onClick={() => setItemCobrou("true")}
                            className={`rounded px-2.5 py-0.5 text-[11px] font-medium disabled:opacity-50 ${
                              itemCobrou === "true"
                                ? "bg-brand text-white"
                                : "text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            Sim
                          </button>
                        </div>
                      </div>
                      {itemCobrou === "true" && (
                        <div className="grid grid-cols-1 gap-1.5 min-[360px]:grid-cols-2">
                          <label className="block min-w-0">
                            <span className="font-medium text-slate-500">
                              Valor *
                            </span>
                            <input
                              className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1.5 text-[11px]"
                              value={itemValor}
                              onChange={(e) => setItemValor(e.target.value)}
                              disabled={acting}
                              placeholder="0,00"
                            />
                          </label>
                          <label className="block min-w-0">
                            <span className="font-medium text-slate-500">
                              NF *
                            </span>
                            <input
                              className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1.5 text-[11px]"
                              value={itemNfCob}
                              onChange={(e) => setItemNfCob(e.target.value)}
                              disabled={acting}
                              placeholder="Nº NF"
                            />
                          </label>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        <button
                          type="button"
                          disabled={acting}
                          className="rounded bg-brand px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
                          onClick={() => void salvarItemFinanceiro(i.id)}
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          disabled={acting}
                          className="rounded border px-2.5 py-1.5 text-[11px] disabled:opacity-50"
                          onClick={() => setItemFinEditId(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                  {i.aprovacaoPor && i.aprovacaoEm && (
                    <p className="text-[10px] text-slate-500">
                      Decisão: {i.aprovacaoPor.nome} em{" "}
                      {new Date(i.aprovacaoEm).toLocaleString("pt-BR")}
                      {i.aprovacaoObs ? ` — ${i.aprovacaoObs}` : ""}
                    </p>
                  )}
                </div>
                {trocaItemId === i.id && (
                  <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3 text-xs sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0 lg:grid-cols-3">
                    <p className="font-medium text-amber-950 sm:col-span-2 lg:col-span-3">
                      Troca — peça boa de outro estoque; série ruim vai ao
                      descarte
                    </p>
                    {rmaDefaults?.avisos && rmaDefaults.avisos.length > 0 && (
                      <p className="rounded border border-amber-300 bg-amber-100/80 px-2 py-1 text-[10px] text-amber-950 sm:col-span-2 lg:col-span-3">
                        {rmaDefaults.avisos.join(" · ")}
                      </p>
                    )}
                    <label className="block">
                      <span className="text-slate-600">Origem da peça boa</span>
                      <select
                        className="mt-0.5 w-full rounded border px-2 py-1.5"
                        value={origemFilialId}
                        onChange={(e) => {
                          setOrigemFilialId(e.target.value);
                          setSerieBoa("");
                        }}
                      >
                        <option value="">Selecione…</option>
                        {filiaisOrigem.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.sigla} — {f.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-slate-600">Série substituta</span>
                      {seriesDisp.length > 0 ? (
                        <select
                          className="mt-0.5 w-full rounded border px-2 py-1.5 font-mono"
                          value={serieBoa}
                          onChange={(e) => setSerieBoa(e.target.value)}
                        >
                          <option value="">Selecione…</option>
                          {seriesDisp.map((s) => (
                            <option key={s.id} value={s.numeroSerie}>
                              {s.numeroSerie}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="mt-0.5 w-full rounded border px-2 py-1.5 font-mono"
                          placeholder="Digite o S/N"
                          value={serieBoa}
                          onChange={(e) => setSerieBoa(e.target.value)}
                        />
                      )}
                      {origemFilialId && seriesDisp.length === 0 && (
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          Nenhuma série listada neste estoque — digite o S/N
                          manualmente
                        </span>
                      )}
                    </label>
                    <label className="block">
                      <span className="text-slate-600">
                        Destino da série ruim (descarte)
                      </span>
                      <select
                        className="mt-0.5 w-full rounded border px-2 py-1.5"
                        value={destinoDescarteId}
                        onChange={(e) => setDestinoDescarteId(e.target.value)}
                      >
                        <option value="">Selecione…</option>
                        {filiaisDescarte.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.sigla} — {f.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-slate-600">Observação (opcional)</span>
                      <input
                        className="mt-0.5 w-full rounded border px-2 py-1.5"
                        value={trocaObs}
                        onChange={(e) => setTrocaObs(e.target.value)}
                        maxLength={500}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2 pt-1 sm:col-span-2 lg:col-span-3">
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void confirmarTroca()}
                        className="rounded bg-amber-800 px-3 py-1.5 text-white disabled:opacity-50"
                      >
                        Confirmar troca
                      </button>
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => setTrocaItemId(null)}
                        className="rounded border px-3 py-1.5"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                {i.observacao && i.status === "DESCARTADO" && (
                  <p className="mt-1 text-[11px] text-slate-500">{i.observacao}</p>
                )}
              </li>
            );
          })}
        </ul>
        {itensAtivos.length === 0 && (
          <p className="text-sm text-slate-500">
            Nenhum item ativo neste RMA.
            {processoAberto ? " Use Incluir item para adicionar." : ""}
          </p>
        )}
        {itensRemovidos.length > 0 && (
          <details className="mt-3 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">
              Itens removidos ({itensRemovidos.length})
            </summary>
            <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
              {itensRemovidos.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-slate-100 pt-1.5 first:border-0 first:pt-0"
                >
                  <span className="font-mono">{i.produto.codigo}</span>
                  {i.unidadeSerie && (
                    <span className="font-mono text-[10px]">
                      S/N {i.unidadeSerie.numeroSerie}
                    </span>
                  )}
                  {i.observacao && (
                    <span className="min-w-0 flex-1 text-[11px] text-slate-500">
                      {i.observacao}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
