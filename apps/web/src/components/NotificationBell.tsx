"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { api, ensureAccessToken } from "@/lib/api";
import { formatNotificacaoDisplay } from "@/lib/notificationDisplay";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Notificacao = {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  lida: boolean;
  criadoEm: string;
  meta?: Record<string, unknown> | null;
};

type ToastItem = {
  id: string;
  titulo: string;
  preview: string;
  href: string | null;
};

/** Sino + inbox estilo marketplace + toasts Socket. */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{
        data: Notificacao[];
        naoLidas: number;
      }>("/notificacoes?take=20");
      setItems(r.data);
      setNaoLidas(r.naoLidas);
    } catch {
      /* sessão / rede */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  useEffect(() => {
    let socket: Socket | null = io(API_URL, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: (cb) => {
        void ensureAccessToken().then((token) => {
          if (!token) {
            cb(new Error("Não autenticado"));
            return;
          }
          cb({ token });
        });
      },
    });

    socket.on(
      "alerta",
      (payload: {
        id?: string;
        titulo?: string;
        mensagem: string;
        meta?: Record<string, unknown>;
      }) => {
        const id =
          payload.id ||
          `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const disp = formatNotificacaoDisplay({
          titulo: payload.titulo || "Alerta",
          mensagem: payload.mensagem,
          meta: payload.meta,
        });
        setToasts((prev) => {
          if (prev.some((t) => t.id === id)) return prev;
          return [
            ...prev,
            {
              id,
              titulo: payload.titulo || "Alerta",
              preview: disp.previewShort,
              href: disp.href,
            },
          ];
        });
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 8000);
        void load();
      }
    );

    socket.on("connect_error", (err) => {
      if (!/autentic|token|Não autenticado/i.test(err.message)) return;
      void ensureAccessToken().then((token) => {
        if (!token) socket?.disconnect();
      });
    });

    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, [load]);

  async function marcarUma(id: string) {
    try {
      await api(`/notificacoes/${id}/lida`, { method: "PATCH", body: "{}" });
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, lida: true } : n))
      );
      setNaoLidas((c) => Math.max(0, c - 1));
    } catch {
      /* ignore */
    }
  }

  async function marcarTodas() {
    setLoading(true);
    try {
      await api("/notificacoes/marcar-todas-lidas", {
        method: "POST",
        body: "{}",
      });
      await load();
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  async function abrirNotificacao(n: Notificacao) {
    const disp = formatNotificacaoDisplay(n);
    if (!n.lida) await marcarUma(n.id);
    setOpen(false);
    if (disp.href) {
      router.push(disp.href);
    }
  }

  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            if (!open) void load();
          }}
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
          aria-label={
            naoLidas > 0
              ? `Notificações (${naoLidas} não lidas)`
              : "Notificações"
          }
          aria-expanded={open}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-5 w-5"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9"
            />
          </svg>
          {naoLidas > 0 && (
            <span
              className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white"
              aria-hidden
            >
              {naoLidas > 9 ? "9+" : naoLidas}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 z-50 mt-2 w-[min(100vw-1.5rem,24rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-3 py-2.5">
              <div>
                <span className="text-sm font-semibold text-slate-900">
                  Notificações
                </span>
                {naoLidas > 0 && (
                  <span className="ml-2 text-xs text-slate-500">
                    {naoLidas} não lida{naoLidas === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={loading || naoLidas === 0}
                onClick={() => void marcarTodas()}
                className="text-xs font-medium text-brand hover:underline disabled:opacity-40"
              >
                Marcar todas como lidas
              </button>
            </div>
            <ul className="max-h-[28rem] overflow-y-auto">
              {items.length === 0 && (
                <li className="px-4 py-10 text-center">
                  <p className="text-sm font-medium text-slate-600">
                    Tudo em dia
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Você não tem notificações por aqui.
                  </p>
                </li>
              )}
              {items.map((n) => {
                const disp = formatNotificacaoDisplay(n);
                const clickable = Boolean(disp.href);
                return (
                  <li key={n.id} className="border-b border-slate-100 last:border-0">
                    <button
                      type="button"
                      onClick={() => void abrirNotificacao(n)}
                      className={`flex w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50 ${
                        n.lida ? "bg-white" : "bg-sky-50/70"
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                          n.lida ? "bg-transparent" : "bg-brand"
                        }`}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={`text-sm leading-snug ${
                              n.lida
                                ? "font-medium text-slate-700"
                                : "font-semibold text-slate-900"
                            } ${clickable ? "text-brand hover:underline" : ""}`}
                          >
                            {n.titulo}
                          </span>
                          <time
                            className="shrink-0 text-[10px] text-slate-400"
                            title={new Date(n.criadoEm).toLocaleString("pt-BR")}
                          >
                            {disp.relativeTime}
                          </time>
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {disp.previewLines.slice(0, 2).map((line, idx) => (
                            <p
                              key={idx}
                              className="truncate text-xs text-slate-600"
                            >
                              {line}
                            </p>
                          ))}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {clickable && (
                            <span className="text-[11px] font-medium text-brand">
                              Ver detalhes →
                            </span>
                          )}
                          {!n.lida && (
                            <span
                              role="button"
                              tabIndex={0}
                              className="text-[11px] text-slate-500 underline hover:text-slate-800"
                              onClick={(e) => {
                                e.stopPropagation();
                                void marcarUma(n.id);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void marcarUma(n.id);
                                }
                              }}
                            >
                              Marcar como lida
                            </span>
                          )}
                          {n.lida && (
                            <span className="text-[10px] text-slate-400">
                              Lida
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {toasts.length > 0 && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(100vw-2rem,22rem)] flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg"
              role="status"
            >
              <div className="text-sm font-semibold text-slate-900">
                {t.titulo}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                {t.preview}
              </p>
              <div className="mt-2 flex items-center gap-3">
                {t.href && (
                  <button
                    type="button"
                    className="text-xs font-medium text-brand hover:underline"
                    onClick={() => {
                      setToasts((prev) => prev.filter((x) => x.id !== t.id));
                      router.push(t.href!);
                    }}
                  >
                    Abrir
                  </button>
                )}
                <button
                  type="button"
                  className="text-xs text-slate-500 hover:text-slate-800"
                  onClick={() =>
                    setToasts((prev) => prev.filter((x) => x.id !== t.id))
                  }
                >
                  Fechar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
