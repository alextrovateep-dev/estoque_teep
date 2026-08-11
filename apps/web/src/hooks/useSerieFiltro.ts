"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

const MIN_LEN = 2;
const DEBOUNCE_MS = 350;

type Opts = {
  /** Path canônico após limpar query (ex.: /dashboard) */
  replacePath: string;
  /** Ler ?serie= / ?numeroSerie= na montagem */
  bootstrapFromUrl?: boolean;
  /** Chamado quando o filtro aplicado muda (ex.: resetar página) */
  onFiltroChange?: (serieFiltro: string) => void;
};

/**
 * Draft + filtro aplicado de nº de série (mín. 2 chars).
 * Aplica com debounce ao digitar; Enter aplica na hora.
 */
export function useSerieFiltro(opts: Opts) {
  const [serieQ, setSerieQ] = useState("");
  const [serieFiltro, setSerieFiltro] = useState("");
  const onFiltroChangeRef = useRef(opts.onFiltroChange);
  onFiltroChangeRef.current = opts.onFiltroChange;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitFiltro = useCallback((raw: string) => {
    const v = raw.trim();
    const next = v.length >= MIN_LEN ? v : "";
    setSerieFiltro((prev) => {
      if (prev === next) return prev;
      onFiltroChangeRef.current?.(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!opts.bootstrapFromUrl || typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const raw = (sp.get("serie") || sp.get("numeroSerie") || "").trim();
    if (!raw) return;
    setSerieQ(raw);
    commitFiltro(raw);
    window.history.replaceState({}, "", opts.replacePath);
    // só na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const serieAtiva = serieFiltro.trim().length >= MIN_LEN;

  const aplicarSerie = useCallback(
    (valor: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const v = valor.trim();
      setSerieQ(v);
      commitFiltro(v);
    },
    [commitFiltro]
  );

  const limparSerie = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setSerieQ("");
    commitFiltro("");
  }, [commitFiltro]);

  const onSerieChange = useCallback(
    (valor: string) => {
      setSerieQ(valor);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const trimmed = valor.trim();
      if (trimmed.length < MIN_LEN) {
        commitFiltro("");
        return;
      }
      debounceRef.current = setTimeout(() => {
        commitFiltro(valor);
        debounceRef.current = null;
      }, DEBOUNCE_MS);
    },
    [commitFiltro]
  );

  const onSerieKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        aplicarSerie(serieQ);
      }
    },
    [aplicarSerie, serieQ]
  );

  return {
    serieQ,
    serieFiltro,
    serieAtiva,
    minLen: MIN_LEN,
    aplicarSerie,
    limparSerie,
    onSerieChange,
    onSerieKeyDown,
    setSerieQ,
    setSerieFiltro,
  };
}
