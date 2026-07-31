"use client";

import { api } from "@/lib/api";
import {
  formatCepInput,
  formatCnpj,
  matchNomeOuDocumento,
  onlyDigits,
} from "@/lib/documento";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Cliente = {
  id: string;
  nome: string;
  nomeFantasia?: string | null;
  tipo: string;
  documento?: string | null;
  email?: string | null;
  telefone?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  ativo: boolean;
};

type CnpjLookup = {
  documento: string;
  nome: string;
  nomeFantasia: string | null;
  email: string | null;
  telefone: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
};

type CepLookup = {
  cep: string;
  logradouro: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  complemento: string | null;
};

type ResumoItem = {
  clienteId: string;
  comprados: number;
  vendidos: number;
};

type ProdutoRel = {
  produtoId: string;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidadeTotal: number;
  ultimaData: string;
  movimentos: number;
  controlaSerie?: boolean;
  series?: string[];
};

type Relacionamentos = {
  clienteId: string;
  comprados: ProdutoRel[];
  vendidos: ProdutoRel[];
};

const emptyForm = {
  nome: "",
  nomeFantasia: "",
  tipo: "CLIENTE",
  documento: "",
  email: "",
  telefone: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  estado: "",
};

function formatData(iso: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatQty(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 4,
  }).format(n);
}

function nullish(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

export default function ClientesPage() {
  const [lista, setLista] = useState<Cliente[]>([]);
  const [resumo, setResumo] = useState<Record<string, ResumoItem>>({});
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [warn, setWarn] = useState("");
  const [expandidoId, setExpandidoId] = useState<string | null>(null);
  const [relCache, setRelCache] = useState<Record<string, Relacionamentos>>({});
  const [loadingRel, setLoadingRel] = useState<string | null>(null);
  const lastCnpjLookup = useRef("");
  const lastCepLookup = useRef("");

  async function load() {
    const [clientes, resumos] = await Promise.all([
      api<Cliente[]>("/clientes?ativas=0"),
      api<ResumoItem[]>("/clientes/relacionamentos-resumo"),
    ]);
    setLista(clientes);
    const map: Record<string, ResumoItem> = {};
    for (const r of resumos) map[r.clienteId] = r;
    setResumo(map);
    setRelCache({});
    setExpandidoId(null);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const filtrados = useMemo(() => {
    const q = busca.trim();
    return lista.filter((c) => {
      if (filtroTipo && c.tipo !== filtroTipo) return false;
      if (!q) return true;
      if (matchNomeOuDocumento(c.nome, c.documento, q)) return true;
      if ((c.nomeFantasia || "").toLowerCase().includes(q.toLowerCase())) {
        return true;
      }
      return c.tipo.toLowerCase().includes(q.toLowerCase());
    });
  }, [lista, busca, filtroTipo]);

  function cancelEdit() {
    setEditId(null);
    setForm(emptyForm);
    lastCnpjLookup.current = "";
    lastCepLookup.current = "";
    setWarn("");
  }

  function startEdit(c: Cliente) {
    setEditId(c.id);
    setForm({
      nome: c.nome,
      nomeFantasia: c.nomeFantasia || "",
      tipo: c.tipo,
      documento: c.documento || "",
      email: c.email || "",
      telefone: c.telefone || "",
      cep: c.cep || "",
      logradouro: c.logradouro || "",
      numero: c.numero || "",
      complemento: c.complemento || "",
      bairro: c.bairro || "",
      cidade: c.cidade || "",
      estado: c.estado || "",
    });
    lastCnpjLookup.current = onlyDigits(c.documento || "");
    lastCepLookup.current = onlyDigits(c.cep || "");
    setError("");
    setWarn("");
    setMsg("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function buscarCnpj(opts?: { silent?: boolean; documento?: string }) {
    const digits = onlyDigits(opts?.documento ?? form.documento);
    if (digits.length !== 14) {
      if (!opts?.silent) {
        setError("Informe um CNPJ com 14 dígitos para consultar");
      }
      return;
    }
    if (digits === lastCnpjLookup.current && opts?.silent) return;

    setError("");
    setWarn("");
    if (!opts?.silent) setMsg("");
    setCnpjLoading(true);
    try {
      const data = await api<CnpjLookup>(`/clientes/cnpj/${digits}`);
      lastCnpjLookup.current = digits;
      setForm((prev) => ({
        ...prev,
        documento: data.documento || prev.documento,
        nome: data.nome || prev.nome,
        nomeFantasia: data.nomeFantasia || prev.nomeFantasia,
        email: data.email || prev.email,
        telefone: data.telefone || prev.telefone,
        cep: data.cep || prev.cep,
        logradouro: data.logradouro || prev.logradouro,
        numero: data.numero || prev.numero,
        complemento: data.complemento || prev.complemento,
        bairro: data.bairro || prev.bairro,
        cidade: data.cidade || prev.cidade,
        estado: data.estado || prev.estado,
      }));
      if (data.cep) lastCepLookup.current = onlyDigits(data.cep);
      setMsg("Dados do CNPJ preenchidos — revise e salve");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Falha na consulta CNPJ";
      if (opts?.silent) {
        setWarn(`${message}. Preencha manualmente se preferir.`);
      } else {
        setError(message);
      }
    } finally {
      setCnpjLoading(false);
    }
  }

  async function buscarCep(opts?: { silent?: boolean; cep?: string }) {
    const digits = onlyDigits(opts?.cep ?? form.cep);
    if (digits.length !== 8 || /^0+$/.test(digits)) {
      if (!opts?.silent) setError("Informe um CEP com 8 dígitos");
      return;
    }
    if (digits === lastCepLookup.current && opts?.silent) return;

    setError("");
    setWarn("");
    setCepLoading(true);
    try {
      const data = await api<CepLookup>(`/clientes/cep/${digits}`);
      lastCepLookup.current = digits;
      setForm((prev) => ({
        ...prev,
        cep: data.cep || prev.cep,
        logradouro: data.logradouro || prev.logradouro,
        bairro: data.bairro || prev.bairro,
        cidade: data.cidade || prev.cidade,
        estado: data.estado || prev.estado,
        complemento: prev.complemento || data.complemento || "",
      }));
      setMsg("Endereço do CEP preenchido — confira o número");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Falha na consulta CEP";
      if (opts?.silent) {
        setWarn(`${message}. Preencha o endereço manualmente.`);
      } else {
        setError(message);
      }
    } finally {
      setCepLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    const digits = onlyDigits(form.documento);
    const documento =
      digits.length === 14
        ? formatCnpj(digits)
        : nullish(form.documento);

    const body = {
      nome: form.nome.trim(),
      nomeFantasia: nullish(form.nomeFantasia),
      tipo: form.tipo,
      documento,
      email: nullish(form.email),
      telefone: nullish(form.telefone),
      cep: nullish(form.cep),
      logradouro: nullish(form.logradouro),
      numero: nullish(form.numero),
      complemento: nullish(form.complemento),
      bairro: nullish(form.bairro),
      cidade: nullish(form.cidade),
      estado: nullish(form.estado)?.toUpperCase() || null,
    };
    try {
      if (editId) {
        await api(`/clientes/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        setMsg("Cadastro atualizado");
      } else {
        await api("/clientes", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setMsg("Cadastro criado");
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  async function toggleAtivo(c: Cliente) {
    setError("");
    try {
      await api(`/clientes/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativo: !c.ativo }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  async function toggleExpand(c: Cliente) {
    if (expandidoId === c.id) {
      setExpandidoId(null);
      return;
    }
    const id = c.id;
    setExpandidoId(id);
    if (relCache[id]) return;
    setLoadingRel(id);
    try {
      const rel = await api<Relacionamentos>(`/clientes/${id}/relacionamentos`);
      setRelCache((prev) => ({ ...prev, [id]: rel }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar histórico");
      setExpandidoId((cur) => (cur === id ? null : cur));
    } finally {
      setLoadingRel((cur) => (cur === id ? null : cur));
    }
  }

  function temHistorico(id: string) {
    const r = resumo[id];
    return !!r && r.comprados + r.vendidos > 0;
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Clientes / Fornecedores</h1>

      <form
        onSubmit={onSubmit}
        className="mt-4 space-y-3 rounded-xl border bg-white p-4"
      >
        <p className="text-sm font-medium text-slate-800">
          {editId ? "Editar cadastro" : "Novo cadastro"}
          {cnpjLoading ? (
            <span className="ml-2 font-normal text-slate-500">
              · consultando CNPJ…
            </span>
          ) : null}
        </p>

        <div className="grid gap-2 md:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Tipo
            </span>
            <select
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value })}
            >
              <option value="CLIENTE">CLIENTE</option>
              <option value="FORNECEDOR">FORNECEDOR</option>
              <option value="INTERNO">INTERNO</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              CNPJ / documento
            </span>
            <input
              placeholder="00.000.000/0000-00"
              className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
              value={form.documento}
              onChange={(e) => {
                const raw = e.target.value;
                const digits = onlyDigits(raw);
                const masked =
                  digits.length >= 3 &&
                  digits.length <= 14 &&
                  !/[a-zA-Z]/.test(raw)
                    ? formatCnpj(raw)
                    : raw;
                setForm({ ...form, documento: masked });
                if (digits.length === 14 && digits !== lastCnpjLookup.current) {
                  void buscarCnpj({ silent: true, documento: digits });
                }
              }}
              onBlur={() => {
                const d = onlyDigits(form.documento);
                if (d.length === 14) {
                  void buscarCnpj({ silent: true, documento: d });
                }
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const d = onlyDigits(form.documento);
                if (d.length === 14) {
                  void buscarCnpj({ silent: true, documento: d });
                }
              }}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Nome fantasia
            </span>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={form.nomeFantasia}
              onChange={(e) =>
                setForm({ ...form, nomeFantasia: e.target.value })
              }
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Razão social / nome *
            </span>
            <input
              required
              className="w-full rounded-lg border px-3 py-2"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </label>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              E-mail
            </span>
            <input
              type="email"
              className="w-full rounded-lg border px-3 py-2"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Telefone
            </span>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={form.telefone}
              onChange={(e) => setForm({ ...form, telefone: e.target.value })}
            />
          </label>
        </div>

        <div className="grid gap-2 md:grid-cols-[8rem_1fr_5rem]">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              CEP {cepLoading ? "· …" : ""}
            </span>
            <input
              placeholder="00000-000"
              className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
              value={form.cep}
              onChange={(e) => {
                const masked = formatCepInput(e.target.value);
                setForm({ ...form, cep: masked });
                const digits = onlyDigits(masked);
                if (digits.length === 8 && digits !== lastCepLookup.current) {
                  void buscarCep({ silent: true, cep: digits });
                }
              }}
              onBlur={() => {
                const d = onlyDigits(form.cep);
                if (d.length === 8) {
                  void buscarCep({ silent: true, cep: d });
                }
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const d = onlyDigits(form.cep);
                if (d.length === 8) {
                  void buscarCep({ silent: true, cep: d });
                }
              }}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Logradouro
            </span>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={form.logradouro}
              onChange={(e) => setForm({ ...form, logradouro: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Nº
            </span>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={form.numero}
              onChange={(e) => setForm({ ...form, numero: e.target.value })}
            />
          </label>
        </div>

        <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_4.5rem]">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Complemento
            </span>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={form.complemento}
              onChange={(e) =>
                setForm({ ...form, complemento: e.target.value })
              }
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Bairro
            </span>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={form.bairro}
              onChange={(e) => setForm({ ...form, bairro: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Cidade
            </span>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={form.cidade}
              onChange={(e) => setForm({ ...form, cidade: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              UF
            </span>
            <input
              maxLength={2}
              className="w-full rounded-lg border px-3 py-2 uppercase"
              value={form.estado}
              onChange={(e) =>
                setForm({ ...form, estado: e.target.value.toUpperCase() })
              }
            />
          </label>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {warn && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {warn}
          </p>
        )}
        {msg && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {msg}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-white"
          >
            {editId ? "Salvar alterações" : "Cadastrar"}
          </button>
          {editId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-lg border px-4 py-2"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="mt-6 flex flex-col gap-2 rounded-xl border bg-white p-4 sm:flex-row">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, CNPJ ou tipo…"
          className="flex-1 rounded-lg border px-3 py-2"
          autoComplete="off"
        />
        <select
          className="rounded-lg border px-3 py-2 sm:w-44"
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
        >
          <option value="">Todos os tipos</option>
          <option value="CLIENTE">CLIENTE</option>
          <option value="FORNECEDOR">FORNECEDOR</option>
          <option value="INTERNO">INTERNO</option>
        </select>
      </div>

      <ul className="mt-3 divide-y rounded-xl border bg-white">
        {filtrados.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-slate-500">
            {lista.length === 0
              ? "Nenhum cadastro ainda."
              : "Nenhum resultado para a busca."}
          </li>
        )}
        {filtrados.map((c) => {
          const r = resumo[c.id];
          const aberto = expandidoId === c.id;
          const rel = relCache[c.id];
          const hist = temHistorico(c.id);
          const outroAberto = expandidoId !== null && !aberto;
          return (
            <li
              key={c.id}
              className={
                aberto
                  ? "border-l-4 border-l-brand bg-brand/[0.07] text-sm shadow-[inset_0_0_0_1px_rgba(91,139,131,0.22)]"
                  : outroAberto
                    ? "text-sm opacity-45"
                    : "text-sm"
              }
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-start gap-2">
                  {hist ? (
                    <button
                      type="button"
                      onClick={() => void toggleExpand(c)}
                      className={
                        aberto
                          ? "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-brand/40 bg-brand/15 text-brand"
                          : "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 text-brand hover:bg-slate-50"
                      }
                      title={
                        aberto
                          ? "Recolher histórico de produtos"
                          : "Ver produtos do histórico"
                      }
                      aria-expanded={aberto}
                      aria-label={
                        aberto
                          ? "Recolher histórico"
                          : "Expandir histórico de produtos"
                      }
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className={`h-4 w-4 transition-transform ${aberto ? "rotate-90" : ""}`}
                      >
                        <path
                          fillRule="evenodd"
                          d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  ) : (
                    <span className="mt-0.5 inline-block h-7 w-7 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <span
                      className={
                        aberto ? "font-semibold text-slate-900" : "font-medium"
                      }
                    >
                      {c.nome}
                    </span>
                    <span className="ml-2 text-slate-500">
                      {c.tipo}
                      {c.documento ? ` · ${c.documento}` : ""} ·{" "}
                      {c.ativo ? "Ativo" : "Inativo"}
                    </span>
                    {(c.cidade || c.estado) && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {[c.cidade, c.estado].filter(Boolean).join(" / ")}
                        {c.email ? ` · ${c.email}` : ""}
                      </p>
                    )}
                    {hist && r && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {r.comprados > 0 && (
                          <span>
                            {r.comprados} comprado{r.comprados === 1 ? "" : "s"}
                          </span>
                        )}
                        {r.comprados > 0 && r.vendidos > 0 && " · "}
                        {r.vendidos > 0 && (
                          <span>
                            {r.vendidos} vendido{r.vendidos === 1 ? "" : "s"}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-3">
                  <button
                    type="button"
                    onClick={() => startEdit(c)}
                    className="text-brand hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleAtivo(c)}
                    className="text-brand hover:underline"
                  >
                    {c.ativo ? "Desativar" : "Ativar"}
                  </button>
                </div>
              </div>

              {aberto && (
                <div className="border-t border-brand/20 bg-white/70 px-4 py-4 pl-14">
                  {loadingRel === c.id && !rel && (
                    <p className="text-xs text-slate-400">Carregando…</p>
                  )}
                  {rel && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <RelacoesProdutos
                        titulo="Compramos deles (entrada)"
                        itens={rel.comprados}
                        vazio="Nenhuma compra registrada."
                      />
                      <RelacoesProdutos
                        titulo="Vendemos / enviamos (saída)"
                        itens={rel.vendidos}
                        vazio="Nenhuma venda/envio registrado."
                      />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {lista.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          Exibindo {filtrados.length} de {lista.length}
        </p>
      )}
    </>
  );
}

function RelacoesProdutos({
  titulo,
  itens,
  vazio,
}: {
  titulo: string;
  itens: ProdutoRel[];
  vazio: string;
}) {
  return (
    <div className="rounded-lg border border-brand/20 bg-white p-3 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-brand">
        {titulo}
      </h3>
      {itens.length === 0 ? (
        <p className="mt-1 text-xs text-slate-400">{vazio}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {itens.map((p) => (
            <li
              key={p.produtoId}
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs text-slate-700">
                  {p.codigo}
                </span>
                {p.controlaSerie || (p.series && p.series.length > 0) ? (
                  <span className="rounded bg-teal-50 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-800">
                    Série
                  </span>
                ) : null}
              </div>
              <div className="font-medium text-slate-900">{p.descricao}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {formatQty(p.quantidadeTotal)} {p.unidade} · {p.movimentos}{" "}
                mov. · últ. {formatData(p.ultimaData)}
              </div>
              {p.series && p.series.length > 0 ? (
                <div className="mt-1.5 border-t border-slate-200/80 pt-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Números de série ({p.series.length})
                  </p>
                  <p className="mt-0.5 break-words font-mono text-[11px] leading-relaxed text-teal-900">
                    {p.series.join(" · ")}
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
