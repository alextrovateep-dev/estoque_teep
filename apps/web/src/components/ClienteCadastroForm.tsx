"use client";

import { api } from "@/lib/api";
import {
  formatCepInput,
  formatCnpj,
  onlyDigits,
} from "@/lib/documento";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

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
  responsavelComercialId?: string | null;
  responsavelComercial?: { id: string; nome: string; email?: string } | null;
};

type UsuarioOpt = { id: string; nome: string; email?: string; ativo?: boolean };

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
  responsavelComercialId: "",
};

function nullish(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

export function ClienteCadastroForm({
  clienteId,
  readOnly = false,
}: {
  clienteId?: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const editId = clienteId || null;
  const [form, setForm] = useState(emptyForm);
  const [usuarios, setUsuarios] = useState<UsuarioOpt[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [warn, setWarn] = useState("");
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [loading, setLoading] = useState(Boolean(editId));
  const [loadFailed, setLoadFailed] = useState(false);
  const lastCnpjLookup = useRef("");
  const lastCepLookup = useRef("");

  useEffect(() => {
    api<UsuarioOpt[]>("/usuarios")
      .then((list) =>
        setUsuarios(list.filter((u) => u.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")))
      )
      .catch(() => {
        /* Admin-only: Gerente usa lista RMA */
        return api<UsuarioOpt[]>("/rma/usuarios-destinatarios").then((list) =>
          setUsuarios(
            list.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
          )
        );
      })
      .catch(() => {
        /* select comercial fica vazio */
      });
  }, []);

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setError("");
    api<Cliente>(`/clientes/${editId}`)
      .then((c) => {
        if (cancelled) return;
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
          responsavelComercialId:
            c.responsavelComercialId || c.responsavelComercial?.id || "",
        });
        lastCnpjLookup.current = onlyDigits(c.documento || "");
        lastCepLookup.current = onlyDigits(c.cep || "");
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadFailed(true);
        setError(e instanceof Error ? e.message : "Cadastro não encontrado");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editId]);

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
    if (readOnly) return;
    setError("");
    setMsg("");
    const digits = onlyDigits(form.documento);
    const documento =
      digits.length === 14 ? formatCnpj(digits) : nullish(form.documento);

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
      responsavelComercialId: form.responsavelComercialId || null,
    };
    try {
      if (editId) {
        await api(`/clientes/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        router.push("/cadastros/clientes?ok=atualizado");
      } else {
        await api("/clientes", {
          method: "POST",
          body: JSON.stringify(body),
        });
        router.push("/cadastros/clientes?ok=criado");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  if (loading) {
    return <p className="mt-4 text-sm text-slate-500">Carregando…</p>;
  }

  if (loadFailed) {
    return (
      <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold">Editar cadastro</h1>
          <Link
            href="/cadastros/clientes"
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
          >
            Voltar à lista
          </Link>
        </div>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error || "Cadastro não encontrado"}
        </p>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {editId
              ? readOnly
                ? "Cadastro"
                : "Editar cadastro"
              : "Novo cadastro"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {readOnly
              ? "Somente visualização — sem permissão para alterar cadastros."
              : "Cliente, fornecedor ou interno."}
            {!readOnly && cnpjLoading ? " · consultando CNPJ…" : ""}
          </p>
        </div>
        <Link
          href="/cadastros/clientes"
          className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
        >
          Voltar à lista
        </Link>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-4 space-y-3 rounded-xl border bg-white p-4"
      >
        <fieldset disabled={readOnly} className="min-w-0 space-y-3 border-0 p-0">
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

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Responsável comercial (RMA)
          </span>
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm"
            value={form.responsavelComercialId}
            onChange={(e) =>
              setForm({ ...form, responsavelComercialId: e.target.value })
            }
          >
            <option value="">— nenhum —</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
                {u.email ? ` · ${u.email}` : ""}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-[11px] text-slate-500">
            Pré-preenche o comercial na abertura de RMA deste cliente.
          </span>
        </label>

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
        </fieldset>

        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <button
              type="submit"
              className="rounded-lg bg-brand px-4 py-2 text-white"
            >
              {editId ? "Salvar alterações" : "Cadastrar"}
            </button>
          )}
          <Link
            href="/cadastros/clientes"
            className="rounded-lg border px-4 py-2"
          >
            {readOnly ? "Voltar" : "Cancelar"}
          </Link>
        </div>
      </form>
    </>
  );
}
