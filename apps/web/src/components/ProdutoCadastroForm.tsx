"use client";

import { ImageLightbox } from "@/components/ImageLightbox";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { api, apiUpload } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assets";
import {
  formatMoneyField,
  formatMoneyPlain,
  normalizeMoneyInput,
} from "@/lib/money";
import {
  FORMATOS_SERIE_PRESETS,
  anoDoisDigitos,
  formatarNumeroSerie,
  labelFormatoSeriePreset,
  unidadeLabel,
} from "@teep/shared";
import Link from "next/link";
import { UnidadeMedidaSelect } from "@/components/UnidadeMedidaSelect";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Categoria = { id: string; nome: string; ativo: boolean };
type Produto = {
  id: string;
  codigo: string;
  descricao: string;
  precoUnitario: string | number;
  estoqueMinimo: number;
  estoqueMaximo: number;
  controlaSerie?: boolean;
  categoriaId?: string;
  unidade?: string;
  ativo: boolean;
  fotos?: string[] | unknown;
  categoria: Categoria;
  configuracaoSerie?: {
    formato: string;
    geracaoAutomatica: boolean;
    tamanhoSequencial: number;
    prefixoFixo?: string | null;
    sufixoFixo?: string | null;
    reiniciarAnual: boolean;
  } | null;
};

const emptyForm = {
  codigo: "",
  descricao: "",
  categoriaId: "",
  unidade: "PC",
  precoUnitario: "0,00",
  estoqueMinimo: "0",
  estoqueMaximo: "0",
  controlaSerie: false,
  geracaoAutomatica: true,
  formatoSerie: "{codigo}{ano2}{seq4}",
  tamanhoSequencial: "4",
  prefixoFixo: "",
  sufixoFixo: "",
  reiniciarAnual: true,
};

function asFotos(raw: unknown): string[] {
  return Array.isArray(raw) ? (raw as string[]) : [];
}

export function ProdutoCadastroForm({
  produtoId,
  readOnly = false,
}: {
  produtoId?: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const editId = produtoId || null;
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [fotos, setFotos] = useState<string[]>([]);
  /** Fotos escolhidas no “Novo produto” (upload só depois do POST). */
  const [pendingFotos, setPendingFotos] = useState<
    Array<{ key: string; file: File; preview: string }>
  >([]);
  const pendingFotosRef = useRef(pendingFotos);
  pendingFotosRef.current = pendingFotos;
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Após criar produto: opções cadastrar outro ou ir ao dashboard. */
  const [posCriacaoOpen, setPosCriacaoOpen] = useState(false);
  const [fotoLightbox, setFotoLightbox] = useState<{
    images: string[];
    initialIndex: number;
  } | null>(null);

  useBodyScrollLock(posCriacaoOpen);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setError("");

    async function boot() {
      try {
        const cats = await api<Categoria[]>("/categorias");
        if (cancelled) return;
        setCategorias(cats);

        if (!editId) {
          setForm(emptyForm);
          setFotos([]);
          return;
        }

        const p = await api<Produto>(`/produtos/${editId}`);
        if (cancelled) return;
        const cfg = p.configuracaoSerie;
        setForm({
          codigo: p.codigo,
          descricao: p.descricao,
          categoriaId: p.categoriaId || p.categoria?.id || "",
          unidade: p.unidade || "UN",
          precoUnitario: formatMoneyPlain(p.precoUnitario),
          estoqueMinimo: String(p.estoqueMinimo ?? 0),
          estoqueMaximo: String(p.estoqueMaximo ?? 0),
          controlaSerie: Boolean(p.controlaSerie),
          geracaoAutomatica: cfg?.geracaoAutomatica ?? true,
          formatoSerie: cfg?.formato || "{codigo}{ano2}{seq4}",
          tamanhoSequencial: String(cfg?.tamanhoSequencial ?? 4),
          prefixoFixo: cfg?.prefixoFixo || "",
          sufixoFixo: cfg?.sufixoFixo || "",
          reiniciarAnual: cfg?.reiniciarAnual ?? true,
        });
        setFotos(asFotos(p.fotos));

        if (typeof window !== "undefined") {
          const ok = new URLSearchParams(window.location.search).get("ok");
          if (ok === "criado") {
            setMsg(
              "Produto cadastrado. A árvore fica em Cadastros → Árvore de produto."
            );
            window.history.replaceState(
              {},
              "",
              `/cadastros/produtos/${editId}`
            );
          }
        }
      } catch (e) {
        if (cancelled) return;
        if (editId) {
          setLoadFailed(true);
          setError(e instanceof Error ? e.message : "Produto não encontrado");
        } else {
          setError(e instanceof Error ? e.message : "Erro ao carregar");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [editId]);

  useEffect(() => {
    return () => {
      for (const p of pendingFotosRef.current) URL.revokeObjectURL(p.preview);
    };
  }, []);

  const optsExemploSerie = useMemo(
    () => ({
      tamanhoSequencial: Number(form.tamanhoSequencial) || 4,
      prefixoFixo: form.prefixoFixo || null,
      sufixoFixo: form.sufixoFixo || null,
      ano2: anoDoisDigitos(),
      sequencial: 1,
    }),
    [form.tamanhoSequencial, form.prefixoFixo, form.sufixoFixo]
  );

  const exemploSerieAtual = useMemo(() => {
    if (!form.controlaSerie) return "";
    try {
      return formatarNumeroSerie({
        codigoProduto: form.codigo.trim() || "COD",
        formato: form.formatoSerie,
        ...optsExemploSerie,
      });
    } catch {
      return "";
    }
  }, [form.controlaSerie, form.codigo, form.formatoSerie, optsExemploSerie]);

  async function uploadFotoParaProduto(produtoId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("context", "produto");
    fd.append("produtoId", produtoId);
    const r = await apiUpload<{ url: string }>("/upload", fd);
    return r.url;
  }

  async function persistFotos(next: string[], produtoId = editId) {
    if (!produtoId) return;
    await api(`/produtos/${produtoId}`, {
      method: "PATCH",
      body: JSON.stringify({ fotos: next }),
    });
    setFotos(next);
  }

  async function onAddFoto(file: File | null) {
    if (!file || readOnly) return;
    setError("");
    if (!editId) {
      const preview = URL.createObjectURL(file);
      setPendingFotos((prev) => [
        ...prev,
        { key: `${Date.now()}-${file.name}-${prev.length}`, file, preview },
      ]);
      return;
    }
    setUploading(true);
    try {
      const url = await uploadFotoParaProduto(editId, file);
      await persistFotos([...fotos, url]);
      setMsg("Foto adicionada");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  }

  async function onRemoveFoto(id: string) {
    if (readOnly) return;
    setError("");
    if (!editId) {
      setPendingFotos((prev) => {
        const item = prev.find((p) => p.key === id);
        if (item) URL.revokeObjectURL(item.preview);
        return prev.filter((p) => p.key !== id);
      });
      return;
    }
    try {
      await persistFotos(fotos.filter((f) => f !== id));
      setMsg("Foto removida");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  async function onMoveFoto(index: number, dir: -1 | 1) {
    if (readOnly) return;
    const target = index + dir;
    if (!editId) {
      if (target < 0 || target >= pendingFotos.length) return;
      setPendingFotos((prev) => {
        const next = [...prev];
        const [item] = next.splice(index, 1);
        next.splice(target, 0, item);
        return next;
      });
      return;
    }
    if (target < 0 || target >= fotos.length) return;
    const next = [...fotos];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setError("");
    try {
      await persistFotos(next);
      setMsg(target === 0 || index === 0 ? "Capa atualizada" : "Ordem atualizada");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (readOnly || saving || posCriacaoOpen) return;
    setError("");
    setMsg("");
    const body: Record<string, unknown> = {
      codigo: form.codigo.trim(),
      descricao: form.descricao.trim(),
      categoriaId: form.categoriaId,
      precoUnitario: normalizeMoneyInput(form.precoUnitario),
      estoqueMinimo: Number(form.estoqueMinimo),
      estoqueMaximo: Number(form.estoqueMaximo),
      controlaSerie: form.controlaSerie,
      unidade: form.unidade,
    };
    if (form.controlaSerie) {
      body.configuracaoSerie = {
        formato: form.formatoSerie.trim() || "{codigo}{ano2}{seq4}",
        geracaoAutomatica: form.geracaoAutomatica,
        tamanhoSequencial: Math.min(
          6,
          Math.max(3, Number(form.tamanhoSequencial) || 4)
        ),
        prefixoFixo: form.prefixoFixo.trim() || null,
        sufixoFixo: form.sufixoFixo.trim() || null,
        reiniciarAnual: form.reiniciarAnual,
      };
    }
    setSaving(true);
    try {
      if (editId) {
        await api(`/produtos/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        router.push("/cadastros/produtos?ok=atualizado");
      } else {
        setUploading(pendingFotos.length > 0);
        const created = await api<Produto>("/produtos", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (pendingFotos.length > 0) {
          const urls: string[] = [];
          for (const p of pendingFotos) {
            urls.push(await uploadFotoParaProduto(created.id, p.file));
          }
          await persistFotos(urls, created.id);
          for (const p of pendingFotos) URL.revokeObjectURL(p.preview);
          setPendingFotos([]);
        }
        setPosCriacaoOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setUploading(false);
      setSaving(false);
    }
  }

  function cadastrarOutroProduto() {
    for (const p of pendingFotos) URL.revokeObjectURL(p.preview);
    setPendingFotos([]);
    setFotos([]);
    setForm(emptyForm);
    setError("");
    setMsg("");
    setPosCriacaoOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loading) {
    return <p className="mt-4 text-sm text-slate-500">Carregando…</p>;
  }

  if (loadFailed) {
    return (
      <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold">Editar produto</h1>
          <Link
            href="/cadastros/produtos"
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
          >
            Voltar à lista
          </Link>
        </div>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error || "Produto não encontrado"}
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
                ? "Produto"
                : "Editar produto"
              : "Novo produto"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {readOnly
              ? "Somente visualização — sem permissão para alterar cadastros."
              : editId
                ? "Fotos e configuração de série. Estoque mín./máx. = 0 desliga o alerta."
                : "Cadastre o item, adicione fotos se quiser e, se tiver número de série físico, ative o rastreio."}
          </p>
        </div>
        <Link
          href="/cadastros/produtos"
          className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
        >
          Voltar à lista
        </Link>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-5 space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <fieldset
          disabled={readOnly || saving || posCriacaoOpen}
          className="min-w-0 space-y-5 border-0 p-0"
        >
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Categoria
            </span>
            <select
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
              value={form.categoriaId}
              onChange={(e) =>
                setForm({ ...form, categoriaId: e.target.value })
              }
            >
              <option value="">Selecione…</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Código
            </span>
            <input
              required
              autoComplete="off"
              placeholder="Ex.: TEEP-123"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
              value={form.codigo}
              onChange={(e) => setForm({ ...form, codigo: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Descrição
            </span>
            <input
              required
              autoComplete="off"
              placeholder="Nome do produto"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Unidade de medida
            </span>
            <UnidadeMedidaSelect
              value={form.unidade}
              onChange={(unidade) => setForm({ ...form, unidade })}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Padrão PC (componente). Use UN para produto acabado. Preço é por{" "}
              {form.unidade} ({unidadeLabel(form.unidade)}).
            </span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Preço unitário (R$)
            </span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 tabular-nums outline-none focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
              value={form.precoUnitario}
              onChange={(e) =>
                setForm({ ...form, precoUnitario: e.target.value })
              }
              onBlur={() =>
                setForm((f) => ({
                  ...f,
                  precoUnitario: formatMoneyField(f.precoUnitario),
                }))
              }
            />
            <span className="mt-1 block text-xs text-slate-500">
              Valor por 1 {form.unidade} — use vírgula para centavos
            </span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Estoque máximo
            </span>
            <input
              type="number"
              min={0}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
              value={form.estoqueMaximo}
              onChange={(e) =>
                setForm({ ...form, estoqueMaximo: e.target.value })
              }
            />
            <span className="mt-1 block text-xs text-slate-500">
              0 = sem alerta de máximo
            </span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Estoque mínimo
            </span>
            <input
              type="number"
              min={0}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
              value={form.estoqueMinimo}
              onChange={(e) =>
                setForm({ ...form, estoqueMinimo: e.target.value })
              }
            />
            <span className="mt-1 block text-xs text-slate-500">
              0 = sem alerta de mínimo
            </span>
          </label>
        </div>

        <div
          className={`rounded-lg border p-4 ${
            form.controlaSerie
              ? "border-teal-200 bg-teal-50/60"
              : "border-slate-200 bg-slate-50"
          }`}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-800 focus:ring-teal-700"
              checked={form.controlaSerie}
              onChange={(e) =>
                setForm({ ...form, controlaSerie: e.target.checked })
              }
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">
                Exige número de série nos lançamentos
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-600">
                Na entrada você pode gerar séries pelo formato abaixo ou digitar
                o código físico. Em saída/transferência o sistema valida a série
                no estoque correto.
              </span>
            </span>
          </label>

          {form.controlaSerie ? (
            <div className="mt-4 space-y-3 border-t border-teal-100 pt-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-teal-800"
                  checked={form.geracaoAutomatica}
                  onChange={(e) =>
                    setForm({ ...form, geracaoAutomatica: e.target.checked })
                  }
                />
                Permitir geração automática no Novo Lançamento
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">
                    Formato
                  </span>
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-teal-700"
                    value={
                      form.formatoSerie === "{codigo}{ano2}-{seq4}" ||
                      form.formatoSerie === "{codigo}-{ano2}-{seq4}" ||
                      /^\{codigo\}\{ano2\}-\{seq\d\}$/.test(form.formatoSerie)
                        ? "{codigo}{ano2}-{seq4}"
                        : form.formatoSerie === "{codigo}{ano2}{seq4}" ||
                            /^\{codigo\}\{ano2\}\{seq\d\}$/.test(
                              form.formatoSerie
                            )
                          ? "{codigo}{ano2}{seq4}"
                          : "__custom__"
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__custom__") return;
                      setForm({ ...form, formatoSerie: v });
                    }}
                  >
                    {FORMATOS_SERIE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.formato}>
                        {labelFormatoSeriePreset(
                          preset,
                          form.codigo,
                          optsExemploSerie
                        )}
                      </option>
                    ))}
                    <option value="__custom__" disabled>
                      Personalizado (edite abaixo)
                    </option>
                  </select>
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-teal-700"
                    value={form.formatoSerie}
                    onChange={(e) =>
                      setForm({ ...form, formatoSerie: e.target.value })
                    }
                    placeholder="{codigo}{ano2}{seq4}"
                  />
                  {exemploSerieAtual ? (
                    <span className="mt-1 block text-xs text-slate-600">
                      Exemplo:{" "}
                      <span className="font-mono font-medium text-teal-900">
                        {exemploSerieAtual}
                      </span>
                    </span>
                  ) : null}
                  <span className="mt-1 block text-xs text-slate-500">
                    Placeholders: {"{codigo}"} {"{ano2}"} {"{seq4}"} {"{prefixo}"}{" "}
                    {"{sufixo}"}. Traços no código do produto são ignorados na
                    série (TMP-202 → TMP202…). No lançamento digita-se só a
                    sequência; o prefixo (código sem traço + ano) fica fixo.
                  </span>
                </label>

                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">
                    Dígitos do sequencial
                  </span>
                  <input
                    type="number"
                    min={3}
                    max={6}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-teal-700"
                    value={form.tamanhoSequencial}
                    onChange={(e) =>
                      setForm({ ...form, tamanhoSequencial: e.target.value })
                    }
                  />
                </label>

                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">
                    Prefixo fixo
                  </span>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-teal-700"
                    value={form.prefixoFixo}
                    onChange={(e) =>
                      setForm({ ...form, prefixoFixo: e.target.value })
                    }
                    placeholder="opcional, ex. SN-"
                  />
                </label>

                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">
                    Sufixo fixo
                  </span>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-teal-700"
                    value={form.sufixoFixo}
                    onChange={(e) =>
                      setForm({ ...form, sufixoFixo: e.target.value })
                    }
                    placeholder="opcional"
                  />
                </label>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-teal-800"
                  checked={form.reiniciarAnual}
                  onChange={(e) =>
                    setForm({ ...form, reiniciarAnual: e.target.checked })
                  }
                />
                Reiniciar sequencial a cada ano
              </label>
            </div>
          ) : null}
        </div>

        {editId && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-800">
              Árvore de produto
            </p>
            <p className="mt-1 text-xs text-slate-500">
              A composição (BOM), edição e simulação de produção ficam na página
              dedicada — acesso Gerente e Admin.
            </p>
            <Link
              href="/cadastros/arvore"
              className="mt-3 inline-flex rounded-lg border border-brand/30 bg-white px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5"
            >
              Abrir Árvore de produto
            </Link>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-slate-800">
                Fotos do produto
              </p>
              {!editId && !readOnly && (
                <p className="mt-0.5 text-xs text-slate-500">
                  As fotos são enviadas ao cadastrar o produto.
                </p>
              )}
            </div>
            {!readOnly && (
              <label className="cursor-pointer rounded-lg border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
                {uploading ? "Enviando…" : "Adicionar foto"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    void onAddFoto(e.target.files?.[0] || null);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {editId && fotos.length === 0 && (
                <p className="text-xs text-slate-500">Nenhuma foto ainda.</p>
              )}
              {!editId && pendingFotos.length === 0 && (
                <p className="text-xs text-slate-500">Nenhuma foto ainda.</p>
              )}
              {editId
                ? fotos.map((f, i) => (
                    <div key={f} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          const images = fotos
                            .map((x) => resolveAssetUrl(x))
                            .filter((u): u is string => Boolean(u));
                          if (images.length === 0) return;
                          setFotoLightbox({ images, initialIndex: i });
                        }}
                        className="block cursor-zoom-in rounded-lg ring-1 ring-slate-200 transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-brand/40"
                        title="Ampliar foto"
                        aria-label={`Ampliar foto ${i + 1}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={resolveAssetUrl(f)!}
                          alt=""
                          className="h-20 w-20 rounded-lg object-cover"
                        />
                      </button>
                      {i === 0 && (
                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                          Capa
                        </span>
                      )}
                      {!readOnly && (
                        <>
                          <div className="absolute -left-1 top-1/2 flex -translate-y-1/2 flex-col gap-0.5">
                            <button
                              type="button"
                              className="rounded bg-white px-1 text-[10px] shadow disabled:opacity-30"
                              disabled={i === 0}
                              onClick={() => void onMoveFoto(i, -1)}
                              title="Mover para cima (capa = 1ª)"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="rounded bg-white px-1 text-[10px] shadow disabled:opacity-30"
                              disabled={i === fotos.length - 1}
                              onClick={() => void onMoveFoto(i, 1)}
                              title="Mover para baixo"
                            >
                              ↓
                            </button>
                          </div>
                          <button
                            type="button"
                            className="absolute -right-1 -top-1 rounded-full bg-white px-1.5 text-xs text-red-600 shadow"
                            onClick={() => void onRemoveFoto(f)}
                            title="Remover"
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>
                  ))
                : pendingFotos.map((p, i) => (
                    <div key={p.key} className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setFotoLightbox({
                            images: pendingFotos.map((x) => x.preview),
                            initialIndex: i,
                          })
                        }
                        className="block cursor-zoom-in rounded-lg ring-1 ring-slate-200 transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-brand/40"
                        title="Ampliar foto"
                        aria-label={`Ampliar foto ${i + 1}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.preview}
                          alt=""
                          className="h-20 w-20 rounded-lg object-cover"
                        />
                      </button>
                      {i === 0 && (
                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                          Capa
                        </span>
                      )}
                      <div className="absolute -left-1 top-1/2 flex -translate-y-1/2 flex-col gap-0.5">
                        <button
                          type="button"
                          className="rounded bg-white px-1 text-[10px] shadow disabled:opacity-30"
                          disabled={i === 0}
                          onClick={() => void onMoveFoto(i, -1)}
                          title="Mover para cima (capa = 1ª)"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="rounded bg-white px-1 text-[10px] shadow disabled:opacity-30"
                          disabled={i === pendingFotos.length - 1}
                          onClick={() => void onMoveFoto(i, 1)}
                          title="Mover para baixo"
                        >
                          ↓
                        </button>
                      </div>
                      <button
                        type="button"
                        className="absolute -right-1 -top-1 rounded-full bg-white px-1.5 text-xs text-red-600 shadow"
                        onClick={() => void onRemoveFoto(p.key)}
                        title="Remover"
                      >
                        ×
                      </button>
                    </div>
                  ))}
            </div>
          {(editId ? fotos.length > 1 : pendingFotos.length > 1) && (
            <p className="mt-2 text-xs text-slate-500">
              A 1ª foto é a capa. Use ↑↓ para reordenar.
            </p>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {msg && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {msg}
          </p>
        )}
        </fieldset>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {!readOnly && (
            <button
              type="submit"
              disabled={saving || posCriacaoOpen}
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving
                ? "Salvando…"
                : editId
                  ? "Salvar alterações"
                  : "Cadastrar produto"}
            </button>
          )}
          <Link
            href="/cadastros/produtos"
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm"
          >
            {readOnly ? "Voltar" : "Cancelar"}
          </Link>
        </div>
      </form>

      {posCriacaoOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-criacao-titulo"
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2
              id="pos-criacao-titulo"
              className="text-lg font-semibold text-slate-900"
            >
              Produto cadastrado
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              O que deseja fazer agora?
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                autoFocus
                onClick={cadastrarOutroProduto}
                className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white"
              >
                Cadastrar outro
              </button>
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-800 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      <ImageLightbox
        open={fotoLightbox !== null}
        onClose={() => setFotoLightbox(null)}
        images={fotoLightbox?.images ?? []}
        initialIndex={fotoLightbox?.initialIndex ?? 0}
        title={form.descricao.trim() || form.codigo.trim() || "Produto"}
        subtitle={form.codigo.trim() || undefined}
      />
    </>
  );
}
