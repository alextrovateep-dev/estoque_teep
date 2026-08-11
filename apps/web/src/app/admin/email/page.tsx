"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/api";

type TemplateRow = {
  type: string;
  label: string;
  customizado?: boolean;
};

type Placeholder = { key: string; descricao: string };

type TemplateDetail = {
  type: string;
  label: string;
  subject: string;
  bodyText: string;
  preheader: string | null;
  placeholders: Placeholder[];
  customizado: boolean;
  preview: { subject: string; html: string; text: string };
};

type FieldName = "subject" | "preheader" | "bodyText";

const CONTA_TYPES = new Set(["ACESSO_SENHA_PROVISORIA"]);

/** Rótulo da máscara no texto (sem {{chave}}). */
const MASK_LABEL: Record<string, string> = {
  nome: "Nome do destinatário",
  titulo: "Título do evento",
  mensagem: "Texto do alerta",
  intro: "Texto de contexto",
  email: "E-mail de login",
  senha: "Senha provisória",
  appUrl: "Link do sistema",
};

function maskLabel(p: Placeholder): string {
  return MASK_LABEL[p.key] || p.descricao;
}

function toMaskToken(label: string): string {
  return `«${label}»`;
}

function storageToFriendly(text: string, placeholders: Placeholder[]): string {
  let out = text;
  const ordered = [...placeholders].sort(
    (a, b) => b.key.length - a.key.length
  );
  for (const p of ordered) {
    const re = new RegExp(`\\{\\{\\s*${p.key}\\s*\\}\\}`, "gi");
    out = out.replace(re, toMaskToken(maskLabel(p)));
  }
  return out;
}

function friendlyToStorage(text: string, placeholders: Placeholder[]): string {
  let out = text;
  const ordered = [...placeholders].sort(
    (a, b) => maskLabel(b).length - maskLabel(a).length
  );
  for (const p of ordered) {
    out = out.split(toMaskToken(maskLabel(p))).join(`{{${p.key}}}`);
  }
  return out;
}

function groupOf(type: string): "conta" | "alerta" {
  return CONTA_TYPES.has(type) ? "conta" : "alerta";
}

export default function AdminEmailPage() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [type, setType] = useState("");
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [preheader, setPreheader] = useState("");
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [activeField, setActiveField] = useState<FieldName>("bodyText");

  const subjectRef = useRef<HTMLInputElement>(null);
  const preheaderRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFriendly = useRef({ subject: "", bodyText: "", preheader: "" });
  const placeholdersRef = useRef<Placeholder[]>([]);

  const placeholders = detail?.placeholders ?? [];
  placeholdersRef.current = placeholders;

  const applyDetail = useCallback((d: TemplateDetail) => {
    setDetail(d);
    const sub = storageToFriendly(d.subject, d.placeholders);
    const body = storageToFriendly(d.bodyText, d.placeholders);
    const pre = storageToFriendly(d.preheader || "", d.placeholders);
    setSubject(sub);
    setBodyText(body);
    setPreheader(pre);
    savedFriendly.current = { subject: sub, bodyText: body, preheader: pre };
  }, []);

  const reloadList = useCallback(async () => {
    const rows = await api<TemplateRow[]>("/admin/email/templates");
    setTemplates(rows);
    return rows;
  }, []);

  const loadDetail = useCallback(
    async (t: string) => {
      const d = await api<TemplateDetail>(`/admin/email/templates/${t}`);
      applyDetail(d);
      return d;
    },
    [applyDetail]
  );

  useEffect(() => {
    reloadList()
      .then((rows) => {
        if (rows[0]) setType(rows[0].type);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erro"));
  }, [reloadList]);

  useEffect(() => {
    if (!type) return;
    previewReqId.current += 1;
    setError("");
    setMsg("");
    void loadDetail(type).catch((e) =>
      setError(e instanceof Error ? e.message : "Erro")
    );
  }, [type, loadDetail]);

  const dirty =
    Boolean(detail) &&
    (subject !== savedFriendly.current.subject ||
      bodyText !== savedFriendly.current.bodyText ||
      preheader !== savedFriendly.current.preheader);

  const previewReqId = useRef(0);

  const refreshPreview = useCallback(
    async (draft: {
      subject: string;
      bodyText: string;
      preheader: string;
    }) => {
      if (!type) return;
      const ph = placeholdersRef.current;
      const reqId = ++previewReqId.current;
      setPreviewBusy(true);
      try {
        const preview = await api<{
          subject: string;
          html: string;
          text: string;
        }>(`/admin/email/templates/${type}/preview`, {
          method: "POST",
          body: JSON.stringify({
            subject: friendlyToStorage(draft.subject, ph),
            bodyText: friendlyToStorage(draft.bodyText, ph),
            preheader:
              friendlyToStorage(draft.preheader.trim(), ph) || null,
          }),
        });
        if (reqId !== previewReqId.current) return;
        setDetail((prev) => (prev ? { ...prev, preview } : prev));
      } catch (err) {
        if (reqId !== previewReqId.current) return;
        setError(err instanceof Error ? err.message : "Erro no preview");
      } finally {
        if (reqId === previewReqId.current) setPreviewBusy(false);
      }
    },
    [type]
  );

  useEffect(() => {
    if (!detail || !type) return;
    const unchanged =
      subject === savedFriendly.current.subject &&
      bodyText === savedFriendly.current.bodyText &&
      preheader === savedFriendly.current.preheader;
    if (unchanged) return;

    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      void refreshPreview({ subject, bodyText, preheader });
    }, 400);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [subject, bodyText, preheader, type, detail?.type, refreshPreview]);

  const grupos = useMemo(() => {
    const conta = templates.filter((t) => groupOf(t.type) === "conta");
    const alerta = templates.filter((t) => groupOf(t.type) === "alerta");
    return [
      { id: "conta", titulo: "Conta e acesso", itens: conta },
      { id: "alerta", titulo: "Alertas operacionais", itens: alerta },
    ] as const;
  }, [templates]);

  function selectTemplate(next: string) {
    if (next === type) return;
    if (
      dirty &&
      !confirm("Há alterações não salvas. Trocar de e-mail mesmo assim?")
    ) {
      return;
    }
    setMsg("");
    setType(next);
  }

  function insertMask(p: Placeholder) {
    const token = toMaskToken(maskLabel(p));
    const apply = (
      value: string,
      setValue: (v: string) => void,
      el: HTMLInputElement | HTMLTextAreaElement | null
    ) => {
      if (!el) {
        setValue(value + token);
        return;
      }
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const next = value.slice(0, start) + token + value.slice(end);
      setValue(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    };

    if (activeField === "subject") {
      apply(subject, setSubject, subjectRef.current);
    } else if (activeField === "preheader") {
      apply(preheader, setPreheader, preheaderRef.current);
    } else {
      apply(bodyText, setBodyText, bodyRef.current);
    }
  }

  function toApiPayload() {
    const ph = placeholdersRef.current;
    return {
      subject: friendlyToStorage(subject, ph),
      bodyText: friendlyToStorage(bodyText, ph),
      preheader: friendlyToStorage(preheader.trim(), ph) || null,
    };
  }

  async function saveTemplate() {
    if (!type) return;
    setSaving(true);
    setMsg("");
    setError("");
    try {
      const d = await api<TemplateDetail>(`/admin/email/templates/${type}`, {
        method: "PUT",
        body: JSON.stringify(toApiPayload()),
      });
      applyDetail(d);
      setMsg("Texto salvo. Os próximos envios já usam esta versão.");
      await reloadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await saveTemplate();
  }

  async function onReset() {
    if (!type) return;
    if (
      !confirm(
        "Voltar ao texto padrão de fábrica deste e-mail? Suas edições serão perdidas."
      )
    ) {
      return;
    }
    setSaving(true);
    setMsg("");
    setError("");
    try {
      const d = await api<TemplateDetail>(
        `/admin/email/templates/${type}/reset`,
        { method: "POST" }
      );
      applyDetail(d);
      setMsg("Texto padrão restaurado.");
      await reloadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao restaurar");
    } finally {
      setSaving(false);
    }
  }

  async function onTeste(e: FormEvent) {
    e.preventDefault();
    if (dirty) {
      setError("Salve as alterações antes de enviar o teste.");
      return;
    }
    setLoading(true);
    setMsg("");
    setError("");
    try {
      const r = await api<{ to: string; subject: string }>(
        `/admin/email/templates/${type}/teste`,
        {
          method: "POST",
          body: JSON.stringify({ to: to.trim() || undefined }),
        }
      );
      setMsg(`E-mail de teste enviado para ${r.to}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  const campoAtivoLabel =
    activeField === "subject"
      ? "Assunto"
      : activeField === "preheader"
        ? "Texto na caixa"
        : "Corpo";

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold text-slate-900">
            E-mails do sistema
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            Monte o texto em português. Os dados do evento o sistema preenche
            sozinho no envio — use as máscaras da lista. A prévia à direita
            atualiza com dados de exemplo.
          </p>
        </div>
        {detail && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || (!detail.customizado && !dirty)}
              onClick={() => void onReset()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Restaurar padrão
            </button>
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => void saveTemplate()}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        )}
      </header>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}
      {msg && (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {msg}
        </p>
      )}

      <section className="mt-6 space-y-4">
        {grupos.map((g) =>
          g.itens.length === 0 ? null : (
            <div key={g.id}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {g.titulo}
              </p>
              <div className="flex flex-wrap gap-2">
                {g.itens.map((t) => {
                  const selected = t.type === type;
                  return (
                    <button
                      key={t.type}
                      type="button"
                      onClick={() => selectTemplate(t.type)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        selected
                          ? "border-brand bg-brand/5 font-semibold text-brand ring-2 ring-brand/20"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      {t.label}
                      {t.customizado ? (
                        <span className="ml-1.5 text-[10px] font-medium text-amber-700">
                          · editado
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )
        )}
      </section>

      {detail && (
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
          <form onSubmit={onSave} className="space-y-4 lg:col-span-3">
            <div
              className={`space-y-4 rounded-xl border p-5 shadow-sm transition-colors ${
                dirty
                  ? "border-amber-300 bg-amber-50"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                  dirty
                    ? "border-amber-300 bg-amber-100/70"
                    : "border-slate-100 bg-slate-50"
                }`}
              >
                <div>
                  <h2
                    className={`text-sm font-semibold ${
                      dirty ? "text-amber-950" : "text-slate-900"
                    }`}
                  >
                    {dirty ? "Editando texto" : "Conteúdo"}
                  </h2>
                  <p
                    className={`mt-0.5 text-xs ${
                      dirty ? "text-amber-900/80" : "text-slate-500"
                    }`}
                  >
                    {detail.label}
                    {detail.customizado ? " · personalizado" : " · padrão"}
                    {dirty ? " · alterações não salvas" : ""}
                  </p>
                </div>
              </div>

              <label className="block">
                <span className="block text-sm font-medium text-slate-700">
                  Assunto do e-mail
                </span>
                <input
                  ref={subjectRef}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  onFocus={() => setActiveField("subject")}
                  required
                />
              </label>

              <label className="block">
                <span className="block text-sm font-medium text-slate-700">
                  Texto na caixa de entrada{" "}
                  <span className="font-normal text-slate-400">(opcional)</span>
                </span>
                <input
                  ref={preheaderRef}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  value={preheader}
                  onChange={(e) => setPreheader(e.target.value)}
                  onFocus={() => setActiveField("preheader")}
                  maxLength={200}
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Aparece junto do assunto na lista de e-mails, antes de abrir a
                  mensagem.
                </span>
              </label>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Corpo
                </label>
                <textarea
                  ref={bodyRef}
                  className="mt-1 min-h-[260px] w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  onFocus={() => setActiveField("bodyText")}
                  required
                />
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Linha em branco = novo parágrafo. Trechos entre « » o sistema
                  preenche automaticamente no envio.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Dados preenchidos pelo sistema
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Clique em <strong>Inserir</strong> para colocar no campo ativo
                  ({campoAtivoLabel}).
                </p>
                <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
                  {placeholders.map((p) => {
                    const label = maskLabel(p);
                    const hint =
                      p.descricao !== label ? p.descricao : null;
                    return (
                      <li
                        key={p.key}
                        className="flex items-center gap-3 px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800">
                            {label}
                          </p>
                          {hint && (
                            <p className="text-[11px] text-slate-500">
                              {hint}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => insertMask(p)}
                          className="shrink-0 rounded-lg border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/10"
                        >
                          Inserir
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </form>

          <div className="space-y-4 lg:col-span-2">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Prévia ao vivo
                  </h2>
                  {previewBusy && (
                    <span className="text-[11px] text-slate-400">
                      Atualizando…
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  Assunto:{" "}
                  <span className="font-medium text-slate-800">
                    {detail.preview.subject}
                  </span>
                </p>
              </div>
              <iframe
                title="Prévia do e-mail"
                className="h-[28rem] w-full bg-white"
                sandbox=""
                srcDoc={detail.preview.html}
              />
            </div>

            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-5">
              <div>
                <h2 className="text-sm font-semibold text-amber-950">
                  Prévia e teste
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-amber-950/90">
                  Salve e envie um teste para validar na sua caixa de entrada.
                  {dirty && (
                    <span className="mt-1 block font-medium">
                      Há mudanças não salvas — grave antes de testar.
                    </span>
                  )}
                </p>
              </div>
              <form onSubmit={onTeste} className="space-y-3">
                <label className="block text-sm">
                  <span className="font-medium text-amber-950">
                    E-mail para receber o teste
                  </span>
                  <input
                    className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="seu@email.com"
                    disabled={loading}
                  />
                  <span className="mt-1 block text-xs text-amber-900/70">
                    O assunto chega com o prefixo [TESTE]. Confira também a
                    pasta de spam.
                  </span>
                </label>
                <button
                  type="submit"
                  disabled={loading || !type || Boolean(dirty)}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {loading ? "Enviando…" : "Enviar teste"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
