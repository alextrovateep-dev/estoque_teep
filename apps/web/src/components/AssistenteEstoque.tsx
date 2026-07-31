"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, apiDownload, getStoredUser } from "@/lib/api";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import {
  MIC_MESSAGES,
  PREFLIGHT_MESSAGES,
  preflightMicrophoneForSpeech,
} from "@/lib/speechRecognitionBrowser";

type ChatDownload = {
  token: string;
  filename: string;
  label: string;
  format: "pdf" | "xlsx";
};

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  downloads?: ChatDownload[];
  actionLinks?: { href: string; label: string }[];
};

type ChatResponse = {
  reply: string;
  suggestedLinks?: { href: string; label: string }[];
  actionLinks?: { href: string; label: string }[];
  toolsUsed?: string[];
  downloads?: ChatDownload[];
};

type Status = {
  enabled: boolean;
  provider: string;
  model: string | null;
};

function storageKey(userId: string, filialId: string) {
  return `teep_assistente_${userId}_${filialId || "all"}`;
}

function appendTranscript(prev: string, text: string) {
  const chunk = text.trim();
  if (!chunk) return prev;
  if (!prev) return chunk;
  return prev.endsWith(" ") ? `${prev}${chunk}` : `${prev} ${chunk}`;
}

function composeInput(base: string, interim: string, recording: boolean) {
  if (!recording || !interim.trim()) return base;
  return appendTranscript(base, interim);
}

function historyForApi(turns: ChatTurn[]) {
  return turns.map(({ role, content }) => ({ role, content }));
}

export function AssistenteEstoque({
  filialId = "",
}: {
  filialId?: string;
}) {
  const user = useMemo(() => getStoredUser(), []);
  const [status, setStatus] = useState<Status | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [links, setLinks] = useState<{ href: string; label: string }[]>([]);
  const [downloadingToken, setDownloadingToken] = useState<string | null>(null);
  const chatListRef = useRef<HTMLDivElement>(null);

  const onFinalTranscript = useCallback((text: string) => {
    setInput((prev) => appendTranscript(prev, text));
  }, []);

  const onSpeechError = useCallback((message: string) => {
    if (message) setError(message);
  }, []);

  const {
    isRecording,
    toggle: toggleSpeech,
    stop: stopSpeech,
    supportsSpeech,
    interimText,
  } = useSpeechRecognition({
    onFinalTranscript,
    onError: onSpeechError,
  });

  useEffect(() => {
    api<Status>("/assistente/status")
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, provider: "—", model: null }));
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = sessionStorage.getItem(storageKey(user.id, filialId));
      if (raw) {
        const parsed = JSON.parse(raw) as ChatTurn[];
        if (Array.isArray(parsed)) {
          setTurns(
            parsed.slice(-20).map((t) => ({
              role: t.role,
              content: t.content,
              // Tokens de download expiram — não restaurar
            }))
          );
        }
      } else {
        setTurns([]);
      }
    } catch {
      setTurns([]);
    }
  }, [user?.id, filialId]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      sessionStorage.setItem(
        storageKey(user.id, filialId),
        JSON.stringify(
          turns.slice(-20).map(({ role, content }) => ({ role, content }))
        )
      );
    } catch {
      /* ignore */
    }
  }, [turns, user?.id, filialId]);

  useEffect(() => {
    if (busy && isRecording) stopSpeech();
  }, [busy, isRecording, stopSpeech]);

  useEffect(() => {
    const el = chatListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  async function downloadExport(d: ChatDownload) {
    setError("");
    setDownloadingToken(d.token);
    try {
      const { blob, filename } = await apiDownload(
        `/assistente/export/${encodeURIComponent(d.token)}`,
        { fallbackFilename: d.filename }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Falha ao baixar o arquivo (pode ter expirado)"
      );
    } finally {
      setDownloadingToken(null);
    }
  }

  async function send(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    if (status && !status.enabled) {
      setError("Assistente desligado (ASSISTENTE_LLM_ENABLED).");
      return;
    }
    if (isRecording) stopSpeech();
    setError("");
    setBusy(true);
    const nextTurns = [...turns, { role: "user" as const, content: text }];
    setTurns(nextTurns);
    setInput("");
    try {
      const r = await api<ChatResponse>("/assistente/chat", {
        method: "POST",
        body: JSON.stringify({
          message: text,
          history: historyForApi(nextTurns.slice(0, -1).slice(-10)),
          filialId: filialId || null,
        }),
      });
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: r.reply,
          downloads: r.downloads?.length ? r.downloads : undefined,
          actionLinks: r.actionLinks?.length ? r.actionLinks : undefined,
        },
      ]);
      setLinks(r.suggestedLinks || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha no assistente";
      setError(msg);
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Não consegui responder: ${msg}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Inclui interim visível; stop promove o restante no estado
    const composed = composeInput(input, interimText, isRecording);
    void send(composed);
  }

  async function onMicClick() {
    setError("");
    if (!supportsSpeech) {
      setError(MIC_MESSAGES.unsupported);
      return;
    }
    if (isRecording) {
      stopSpeech();
      return;
    }
    try {
      const preflight = await preflightMicrophoneForSpeech();
      if (!preflight.ok) {
        setError(PREFLIGHT_MESSAGES[preflight.reason]);
        return;
      }
      const started = await toggleSpeech();
      if (!started) {
        setError(MIC_MESSAGES.startFailed);
      }
    } catch {
      setError(MIC_MESSAGES.startFailed);
    }
  }

  const enabled = status?.enabled === true;
  const displayValue = composeInput(input, interimText, isRecording);
  const canSend =
    !busy && enabled && composeInput(input, interimText, isRecording).trim().length > 0;

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
          <span
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-brand"
            aria-hidden
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4 animate-teep-spark"
            >
              <path d="M12 2.5c.25 0 .46.16.54.4l1.2 3.55c.38 1.13 1.27 2.02 2.4 2.4l3.55 1.2a.56.56 0 0 1 0 1.07l-3.55 1.2c-1.13.38-2.02 1.27-2.4 2.4l-1.2 3.55a.56.56 0 0 1-1.07 0l-1.2-3.55a3.84 3.84 0 0 0-2.4-2.4l-3.55-1.2a.56.56 0 0 1 0-1.07l3.55-1.2a3.84 3.84 0 0 0 2.4-2.4l1.2-3.55A.56.56 0 0 1 12 2.5Z" />
              <path
                d="M18.5 3.2c.12 0 .22.07.26.18l.45 1.25c.14.4.45.71.85.85l1.25.45a.27.27 0 0 1 0 .52l-1.25.45c-.4.14-.71.45-.85.85l-.45 1.25a.27.27 0 0 1-.52 0l-.45-1.25a1.6 1.6 0 0 0-.85-.85l-1.25-.45a.27.27 0 0 1 0-.52l1.25-.45c.4-.14.71-.45.85-.85l.45-1.25a.27.27 0 0 1 .26-.18Z"
                opacity="0.85"
              />
            </svg>
          </span>
          Assistente de estoque
        </h2>
        {turns.length > 0 && (
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-800"
            onClick={() => {
              if (isRecording) stopSpeech();
              setTurns([]);
              setLinks([]);
              setError("");
            }}
          >
            Limpar conversa
          </button>
        )}
      </div>

      {!enabled && (
        <p className="px-4 py-3 text-sm text-amber-700">
          Assistente desligado. Defina{" "}
          <code className="text-xs">ASSISTENTE_LLM_ENABLED=1</code> e a chave do
          provider na API.
        </p>
      )}

      <div
        ref={chatListRef}
        className="mt-3 max-h-72 space-y-2 overflow-y-auto px-4"
      >
        {turns.map((t, i) => (
          <div key={`${t.role}-${i}`}>
            <div
              className={
                t.role === "user"
                  ? "ml-8 rounded-lg bg-brand/10 px-3 py-2 text-sm text-slate-800"
                  : "mr-8 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap"
              }
            >
              {t.content}
            </div>
            {t.role === "assistant" && t.downloads && t.downloads.length > 0 && (
              <div className="mr-8 mt-1.5 flex flex-wrap gap-2">
                {t.downloads.map((d) => (
                  <button
                    key={d.token}
                    type="button"
                    disabled={downloadingToken === d.token}
                    onClick={() => void downloadExport(d)}
                    className="rounded-lg border border-brand/30 bg-white px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-light disabled:opacity-50"
                  >
                    {downloadingToken === d.token ? "Baixando…" : d.label}
                  </button>
                ))}
              </div>
            )}
            {t.role === "assistant" &&
              t.actionLinks &&
              t.actionLinks.length > 0 && (
                <div className="mr-8 mt-1.5 flex flex-wrap gap-2">
                  {t.actionLinks.map((a) => (
                    <Link
                      key={a.href}
                      href={a.href}
                      className="rounded-lg border border-amber-300/80 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
                    >
                      {a.label}
                    </Link>
                  ))}
                </div>
              )}
          </div>
        ))}
        {busy && (
          <p className="text-xs text-slate-400">Consultando estoque…</p>
        )}
      </div>

      {links.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg border border-brand/30 px-2 py-1 text-xs text-brand hover:bg-brand-light"
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}

      {error && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-2">
          <p className="text-xs text-red-600">{error}</p>
          {(error === MIC_MESSAGES.needsReload ||
            error === MIC_MESSAGES.denied) && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"
            >
              Recarregar página
            </button>
          )}
        </div>
      )}

      {isRecording && (
        <p className="px-4 pt-2 text-xs font-medium text-red-600" aria-live="polite">
          Ouvindo… fale e toque em Parar quando terminar
        </p>
      )}

      <form
        onSubmit={onSubmit}
        className="mt-3 flex items-end gap-2 border-t border-slate-100 p-4"
      >
        <textarea
          value={displayValue}
          onChange={(e) => {
            if (isRecording) return;
            setInput(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) {
                void send(
                  composeInput(input, interimText, isRecording)
                );
              }
            }
          }}
          disabled={busy || !enabled}
          readOnly={isRecording}
          rows={2}
          placeholder="Pergunte sobre o estoque… ou use o microfone"
          className="min-h-[3.25rem] min-w-0 flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm leading-snug outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
          aria-label="Mensagem para o assistente"
        />
        <button
          type="button"
          onClick={() => void onMicClick()}
          disabled={busy || !enabled}
          title={
            !supportsSpeech
              ? "Ditado indisponível neste navegador"
              : isRecording
                ? "Parar ditado"
                : "Ditado por voz (pt-BR)"
          }
          aria-label={isRecording ? "Parar ditado" : "Ditado por voz"}
          aria-pressed={isRecording}
          className={
            isRecording
              ? "inline-flex h-[3.25rem] shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 text-red-600 hover:bg-red-100 disabled:opacity-40"
              : "inline-flex h-[3.25rem] shrink-0 items-center justify-center rounded-lg border border-slate-200 px-3 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          }
        >
          {isRecording ? (
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-sm bg-red-500" />
              Parar
            </span>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-5 w-5"
              aria-hidden
            >
              <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z" />
              <path d="M17 11a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.07A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z" />
            </svg>
          )}
        </button>
        <button
          type="submit"
          disabled={!canSend}
          className="h-[3.25rem] shrink-0 rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          Enviar
        </button>
      </form>
    </section>
  );
}
