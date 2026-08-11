/**
 * Formatação / alocação de números de série (padrão {codigo}{ano2}{seqN}).
 * Não cria UnidadeSerie — só reserva o sequencial; a unidade nasce na movimentação.
 */

export const FORMATO_SERIE_PADRAO = "{codigo}{ano2}{seq4}";
export const TAMANHO_SEQ_PADRAO = 4;
export const MAX_SERIES_POR_LOTE = 500;

export const FORMATOS_SERIE_PRESETS = [
  {
    id: "compacto",
    formato: "{codigo}{ano2}{seq4}",
    nome: "Compacto",
  },
  {
    id: "tracejado",
    formato: "{codigo}-{ano2}-{seq4}",
    nome: "Com hífens",
  },
] as const;

/** Rótulo do preset com exemplo usando o código do produto (ou COD). */
export function labelFormatoSeriePreset(
  preset: (typeof FORMATOS_SERIE_PRESETS)[number],
  codigoProduto: string,
  opts?: {
    tamanhoSequencial?: number;
    prefixoFixo?: string | null;
    sufixoFixo?: string | null;
    ano2?: number;
    sequencial?: number;
  }
): string {
  const exemplo = formatarNumeroSerie({
    codigoProduto: (codigoProduto || "").trim() || "COD",
    ano2: opts?.ano2 ?? anoDoisDigitos(),
    sequencial: opts?.sequencial ?? 1,
    tamanhoSequencial: opts?.tamanhoSequencial,
    formato: preset.formato,
    prefixoFixo: opts?.prefixoFixo,
    sufixoFixo: opts?.sufixoFixo,
  });
  return `${preset.nome} (${exemplo})`;
}

export function anoDoisDigitos(d = new Date()): number {
  return d.getFullYear() % 100;
}

/** Garante {seqN} alinhado ao tamanhoSequencial no template. */
export function formatoComTamanho(formato: string, tamanho: number): string {
  const t = Math.min(6, Math.max(3, tamanho));
  const base = (formato || FORMATO_SERIE_PADRAO).trim() || FORMATO_SERIE_PADRAO;
  if (/\{seq\d?\}/i.test(base)) {
    return base.replace(/\{seq\d?\}/gi, `{seq${t}}`);
  }
  return `${base}{seq${t}}`;
}

export function formatarNumeroSerie(opts: {
  codigoProduto: string;
  ano2: number;
  sequencial: number;
  tamanhoSequencial?: number;
  formato?: string | null;
  prefixoFixo?: string | null;
  sufixoFixo?: string | null;
}): string {
  const tamanho = Math.min(
    6,
    Math.max(3, opts.tamanhoSequencial ?? TAMANHO_SEQ_PADRAO)
  );
  const codigo = (opts.codigoProduto || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const ano = String(opts.ano2).padStart(2, "0").slice(-2);
  const seqPad = (t: number) => String(opts.sequencial).padStart(t, "0");
  const prefixo = (opts.prefixoFixo || "").trim();
  const sufixo = (opts.sufixoFixo || "").trim();
  const formatoRaw = (opts.formato || FORMATO_SERIE_PADRAO).trim();
  const formato = formatoComTamanho(
    formatoRaw || FORMATO_SERIE_PADRAO,
    tamanho
  );

  let out = formato
    .replace(/\{codigo\}/gi, codigo)
    .replace(/\{ano2\}/gi, ano)
    .replace(/\{seq(\d)\}/gi, (_, d: string) => seqPad(Number(d)))
    .replace(/\{seq\}/gi, seqPad(tamanho))
    .replace(/\{prefixo\}/gi, prefixo)
    .replace(/\{sufixo\}/gi, sufixo);

  if (!/\{prefixo\}/i.test(formato) && prefixo) out = `${prefixo}${out}`;
  if (!/\{sufixo\}/i.test(formato) && sufixo) out = `${out}${sufixo}`;
  return out;
}

export function gerarSequenciaSeries(opts: {
  codigoProduto: string;
  ano2: number;
  sequencialInicial: number;
  quantidade: number;
  tamanhoSequencial?: number;
  formato?: string | null;
  prefixoFixo?: string | null;
  sufixoFixo?: string | null;
}): string[] {
  const qtd = opts.quantidade;
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > MAX_SERIES_POR_LOTE) {
    throw new Error(
      `Quantidade deve ser inteiro entre 1 e ${MAX_SERIES_POR_LOTE}`
    );
  }
  const out: string[] = [];
  for (let i = 0; i < qtd; i++) {
    out.push(
      formatarNumeroSerie({
        codigoProduto: opts.codigoProduto,
        ano2: opts.ano2,
        sequencial: opts.sequencialInicial + i,
        tamanhoSequencial: opts.tamanhoSequencial,
        formato: opts.formato,
        prefixoFixo: opts.prefixoFixo,
        sufixoFixo: opts.sufixoFixo,
      })
    );
  }
  return out;
}
