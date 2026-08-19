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
    /** Ano e seq separados por hífen; o código do produto já perde traços internos. */
    formato: "{codigo}{ano2}-{seq4}",
    nome: "Ano-seqüência com hífen",
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

/** Tamanho da sequência (3–6), padrão 4. */
export function clampTamanhoSequencial(n?: number | null): number {
  return Math.min(6, Math.max(3, n ?? TAMANHO_SEQ_PADRAO));
}

/**
 * Só dígitos, no máximo `tamanho` caracteres (bloqueia 000023 quando tamanho=4).
 */
export function digitosSequenciaLimitados(
  raw: string,
  tamanhoSequencial?: number | null
): string {
  const tamanho = clampTamanhoSequencial(tamanhoSequencial);
  return (raw || "").replace(/\D/g, "").slice(0, tamanho);
}

/**
 * Sequência final para gravar: exatamente `tamanho` dígitos (zero à esquerda).
 * Vazio se não houver dígitos.
 */
export function sequenciaNormalizada(
  raw: string,
  tamanhoSequencial?: number | null
): string {
  const tamanho = clampTamanhoSequencial(tamanhoSequencial);
  const digits = digitosSequenciaLimitados(raw, tamanho);
  if (!digits) return "";
  return digits.padStart(tamanho, "0");
}

/** Valida se a sequência (já extraída) tem exatamente N dígitos. */
export function validarSequenciaSerieTamanho(
  sequencia: string,
  tamanhoSequencial?: number | null
): { ok: true } | { ok: false; motivo: string } {
  const tamanho = clampTamanhoSequencial(tamanhoSequencial);
  const s = (sequencia || "").trim();
  if (!s) {
    return { ok: false, motivo: "Informe a sequência" };
  }
  if (!/^\d+$/.test(s)) {
    return { ok: false, motivo: "A sequência deve conter só dígitos" };
  }
  if (s.length !== tamanho) {
    return {
      ok: false,
      motivo: `A sequência deve ter exatamente ${tamanho} dígito(s) (ex.: ${"0".repeat(Math.max(0, tamanho - 1))}1)`,
    };
  }
  return { ok: true };
}

/** Garante {seqN} alinhado ao tamanhoSequencial no template. */
export function formatoComTamanho(formato: string, tamanho: number): string {
  const t = clampTamanhoSequencial(tamanho);
  const base = (formato || FORMATO_SERIE_PADRAO).trim() || FORMATO_SERIE_PADRAO;
  if (/\{seq\d?\}/i.test(base)) {
    return base.replace(/\{seq\d?\}/gi, `{seq${t}}`);
  }
  return `${base}{seq${t}}`;
}

function normalizarCodigoProduto(codigoProduto: string): string {
  // Traços do código do produto (ex.: TMP-202) não entram na série → TMP202…
  return (codigoProduto || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
}

/**
 * Parte fixa da série (antes do sequencial) para a UI:
 * operador digita só a sequência final.
 */
export function prefixoSerieProduto(opts: {
  codigoProduto: string;
  ano2?: number;
  tamanhoSequencial?: number;
  formato?: string | null;
  prefixoFixo?: string | null;
  sufixoFixo?: string | null;
}): string {
  const tamanho = clampTamanhoSequencial(opts.tamanhoSequencial);
  const codigo = normalizarCodigoProduto(opts.codigoProduto);
  const ano = String(opts.ano2 ?? anoDoisDigitos())
    .padStart(2, "0")
    .slice(-2);
  const prefixo = (opts.prefixoFixo || "").trim();
  const formatoRaw = (opts.formato || FORMATO_SERIE_PADRAO).trim();
  const formato = formatoComTamanho(
    formatoRaw || FORMATO_SERIE_PADRAO,
    tamanho
  );

  const semSeq = formato.replace(/\{seq\d?\}.*$/i, "");
  let out = semSeq
    .replace(/\{codigo\}/gi, codigo)
    .replace(/\{ano2\}/gi, ano)
    .replace(/\{prefixo\}/gi, prefixo)
    .replace(/\{sufixo\}/gi, "");

  if (!/\{prefixo\}/i.test(formato) && prefixo) out = `${prefixo}${out}`;
  return out;
}

export function clampAno2(n: number): number {
  if (!Number.isFinite(n)) return anoDoisDigitos();
  const i = Math.trunc(n);
  return ((i % 100) + 100) % 100;
}

function formatoSemSeq(opts: {
  codigoProduto: string;
  tamanhoSequencial?: number;
  formato?: string | null;
  prefixoFixo?: string | null;
}): string {
  const tamanho = clampTamanhoSequencial(opts.tamanhoSequencial);
  const codigo = normalizarCodigoProduto(opts.codigoProduto);
  const prefixo = (opts.prefixoFixo || "").trim();
  const formatoRaw = (opts.formato || FORMATO_SERIE_PADRAO).trim();
  const formato = formatoComTamanho(
    formatoRaw || FORMATO_SERIE_PADRAO,
    tamanho
  );
  const semSeq = formato.replace(/\{seq\d?\}.*$/i, "");
  let out = semSeq
    .replace(/\{codigo\}/gi, codigo)
    .replace(/\{prefixo\}/gi, prefixo)
    .replace(/\{sufixo\}/gi, "");
  if (!/\{prefixo\}/i.test(formato) && prefixo) out = `${prefixo}${out}`;
  return out;
}

/** Partes visuais: código (sem traço) | ano | resto antes da seq. */
export function partesPrefixoSerie(opts: {
  codigoProduto: string;
  tamanhoSequencial?: number;
  formato?: string | null;
  prefixoFixo?: string | null;
}): { antesAno: string; temAno: boolean; depoisAno: string } {
  const mold = formatoSemSeq(opts);
  const idx = mold.toLowerCase().indexOf("{ano2}");
  if (idx < 0) {
    return { antesAno: mold, temAno: false, depoisAno: "" };
  }
  return {
    antesAno: mold.slice(0, idx),
    temAno: true,
    depoisAno: mold.slice(idx + "{ano2}".length).replace(/\{ano2\}/gi, ""),
  };
}

export type InterpretacaoSerie = {
  ano2: number;
  sequencia: string;
  completa: string;
};

function anosCandidatos(atual: number): number[] {
  const a = clampAno2(atual);
  const out = [a];
  for (let i = 1; i <= 20; i++) out.push(clampAno2(a - i));
  out.push(clampAno2(a + 1));
  return out;
}

/**
 * Interpreta o que o operador digitou/colou/leu:
 * série completa, ano+seq, ou só sequencial.
 */
export function interpretarEntradaSerie(
  raw: string,
  opts: {
    codigoProduto: string;
    formato?: string | null;
    tamanhoSequencial?: number | null;
    prefixoFixo?: string | null;
    sufixoFixo?: string | null;
    ano2Atual?: number;
    finalizar?: boolean;
  }
): InterpretacaoSerie {
  const tamanho = clampTamanhoSequencial(opts.tamanhoSequencial);
  const anoPadrao = clampAno2(opts.ano2Atual ?? anoDoisDigitos());
  const trimmed = String(raw ?? "").trim();
  const sufixo = opts.sufixoFixo ?? null;
  const vazio = (): InterpretacaoSerie => ({
    ano2: anoPadrao,
    sequencia: "",
    completa: "",
  });
  if (!trimmed) return vazio();

  const compact = trimmed.toUpperCase().replace(/[\s-]/g, "");
  const pack = (ano2: number, sequenciaRaw: string): InterpretacaoSerie => {
    const sequencia = opts.finalizar
      ? sequenciaNormalizada(sequenciaRaw, tamanho)
      : sequenciaRaw;
    const prefixo = prefixoSerieProduto({
      codigoProduto: opts.codigoProduto,
      ano2,
      tamanhoSequencial: tamanho,
      formato: opts.formato,
      prefixoFixo: opts.prefixoFixo,
      sufixoFixo: opts.sufixoFixo,
    });
    const completa = sequencia
      ? serieCompletaDeSequencia(prefixo, sequencia, tamanho, sufixo, {
          finalizar: Boolean(opts.finalizar),
        })
      : "";
    return { ano2, sequencia, completa };
  };
  for (const ano2 of anosCandidatos(anoPadrao)) {
    const prefixo = prefixoSerieProduto({
      codigoProduto: opts.codigoProduto,
      ano2,
      tamanhoSequencial: tamanho,
      formato: opts.formato,
      prefixoFixo: opts.prefixoFixo,
      sufixoFixo: opts.sufixoFixo,
    });
    const prefU = prefixo.toUpperCase();
    const rawU = trimmed.toUpperCase();
    if (rawU.startsWith(prefU) || compact.startsWith(prefU.replace(/-/g, ""))) {
      const seq = sequenciaDeSerieCompleta(
        rawU.startsWith(prefU) ? trimmed : compact,
        prefixo,
        sufixo
      ).replace(/\D/g, "");
      return pack(ano2, seq.slice(0, tamanho));
    }
  }

  const codigo = normalizarCodigoProduto(opts.codigoProduto);
  if (codigo && compact.startsWith(codigo)) {
    const rest = compact.slice(codigo.length).replace(/\D/g, "");
    if (rest.length <= tamanho) {
      return pack(anoPadrao, rest);
    }
    if (rest.length >= tamanho + 2) {
      const ano2 = clampAno2(Number(rest.slice(0, 2)));
      return pack(ano2, rest.slice(2, 2 + tamanho));
    }
  }

  const onlyDigits = compact.replace(/\D/g, "");
  if (onlyDigits.length >= tamanho + 2) {
    const sequencia = onlyDigits.slice(-tamanho);
    const ano2 = clampAno2(Number(onlyDigits.slice(-tamanho - 2, -tamanho)));
    return pack(ano2, sequencia);
  }

  return pack(anoPadrao, digitosSequenciaLimitados(onlyDigits, tamanho));
}

/**
 * Junta prefixo + sequência digitada (+ sufixo opcional).
 * Enquanto digita (`finalizar=false`): no máx. N dígitos, sem pad.
 * Ao confirmar (`finalizar=true`): exatamente N dígitos com zero à esquerda.
 */
export function serieCompletaDeSequencia(
  prefixo: string,
  sequenciaDigitada: string,
  tamanhoSequencial?: number,
  sufixoFixo?: string | null,
  opts?: { finalizar?: boolean }
): string {
  const tamanho = clampTamanhoSequencial(tamanhoSequencial);
  const raw = (sequenciaDigitada || "").trim();
  if (!raw) return "";
  const pref = prefixo || "";
  const suf = (sufixoFixo || "").trim();
  if (pref && raw.toUpperCase().startsWith(pref.toUpperCase())) {
    const mid = raw.slice(pref.length);
    if (suf && mid.toUpperCase().endsWith(suf.toUpperCase())) {
      return raw.toUpperCase();
    }
    return `${raw.toUpperCase()}${suf && !mid.toUpperCase().endsWith(suf.toUpperCase()) ? suf : ""}`;
  }
  const digits = digitosSequenciaLimitados(raw, tamanho);
  if (!digits) return "";
  const seq = opts?.finalizar ? sequenciaNormalizada(digits, tamanho) : digits;
  return `${pref}${seq}${suf}`;
}

/** Extrai só a parte sequencial de uma série completa (para exibir no input). */
export function sequenciaDeSerieCompleta(
  serieCompleta: string,
  prefixo: string,
  sufixoFixo?: string | null
): string {
  const full = (serieCompleta || "").trim();
  const pref = prefixo || "";
  const suf = (sufixoFixo || "").trim();
  if (!full) return "";
  let mid = full;
  if (pref && mid.toUpperCase().startsWith(pref.toUpperCase())) {
    mid = mid.slice(pref.length);
  }
  if (suf && mid.toUpperCase().endsWith(suf.toUpperCase())) {
    mid = mid.slice(0, mid.length - suf.length);
  }
  return mid;
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
  const tamanho = clampTamanhoSequencial(opts.tamanhoSequencial);
  const codigo = normalizarCodigoProduto(opts.codigoProduto);
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
