/** HTML do laudo de recebimento anexado ao PDF de orçamento RMA. */

export function escHtmlPdf(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type PerguntaLaudoPdf = {
  codigo: string;
  titulo: string;
  tipoCampo: string;
  valorTexto?: string | null;
  valorBool?: boolean | null;
  fotos: string[];
};

export function fotosChecklist(fotos: unknown): string[] {
  if (!Array.isArray(fotos)) return [];
  return fotos
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

export function formatarRespostaChecklistCampo(opts: {
  tipoCampo: string;
  valorTexto?: string | null;
  valorBool?: boolean | null;
}): string {
  const tipo = String(opts.tipoCampo || "").toUpperCase();
  if (tipo === "SIM_NAO") {
    if (opts.valorBool === true) return "Sim";
    if (opts.valorBool === false) return "Não";
    return "—";
  }
  if (tipo === "FOTO") {
    return "";
  }
  const t = (opts.valorTexto || "").trim();
  return t || "—";
}

export function mapPerguntasLaudo(exec: {
  template?: {
    itens?: Array<{
      id: string;
      codigo: string;
      titulo: string;
      tipoCampo: string;
      ordem?: number;
    }>;
  };
  respostas?: Array<{
    templateItemId: string;
    valorTexto?: string | null;
    valorBool?: boolean | null;
    fotos?: unknown;
  }>;
} | null | undefined): PerguntaLaudoPdf[] {
  const itens = [...(exec?.template?.itens || [])].sort(
    (a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)
  );
  const byId = new Map((exec?.respostas || []).map((r) => [r.templateItemId, r]));
  return itens.map((ti) => {
    const r = byId.get(ti.id);
    return {
      codigo: ti.codigo,
      titulo: ti.titulo,
      tipoCampo: ti.tipoCampo,
      valorTexto: r?.valorTexto ?? null,
      valorBool: r?.valorBool ?? null,
      fotos: fotosChecklist(r?.fotos),
    };
  });
}

function stampLaudo(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function htmlFotos(
  urls: string[],
  imageDataUri: (url: string) => string | null
): string {
  if (!urls.length) return "";
  const figs = urls
    .map((url) => {
      const uri = imageDataUri(url);
      if (uri) {
        return `<figure class="foto-frame"><img src="${uri}" alt="" /></figure>`;
      }
      return `<p class="muted">Foto anexada no sistema (não disponível neste PDF).</p>`;
    })
    .join("");
  return `<div class="fotos">${figs}</div>`;
}

export type ItemLaudoPdf = {
  codigoProduto: string;
  descricao: string;
  numeroSerie?: string | null;
  diagnostico?: {
    resumoProblema: string;
    observacaoTecnica?: string | null;
  } | null;
  preenchidoPorNome?: string | null;
  concluidoEm?: Date | string | null;
  perguntas: PerguntaLaudoPdf[];
};

export function htmlLaudoChecklist(
  itens: ItemLaudoPdf[],
  imageDataUri: (url: string) => string | null,
  opts: {
    titulo: string;
    subtitulo: string;
    /** Prefixo do meta: "Recebido por" | "Liberado por" */
    papelPor?: string;
    /** Se true, inclui bloco de diagnóstico (entrada). */
    incluirDiagnostico?: boolean;
    emptyChecklistMsg?: string;
  }
): string {
  if (!itens.length) return "";
  const papel = opts.papelPor || "Preenchido por";
  const emptyMsg =
    opts.emptyChecklistMsg || "Não há checklist registrado para este item.";
  const blocos = itens
    .map((it) => {
      const sn = it.numeroSerie
        ? ` · N/S ${escHtmlPdf(it.numeroSerie)}`
        : "";
      const meta = [
        it.preenchidoPorNome
          ? `${papel} ${escHtmlPdf(it.preenchidoPorNome)}`
          : "",
        stampLaudo(it.concluidoEm)
          ? `em ${escHtmlPdf(stampLaudo(it.concluidoEm))}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      const perguntasHtml = it.perguntas.length
        ? `<ol class="qs">${it.perguntas
            .map((q) => {
              const resp = formatarRespostaChecklistCampo(q);
              return `<li>
                <p class="q"><strong>${escHtmlPdf(q.codigo)}.</strong> ${escHtmlPdf(
                  q.titulo
                )}</p>
                ${
                  resp
                    ? `<p class="a">${escHtmlPdf(resp)}</p>`
                    : ""
                }
                ${htmlFotos(q.fotos, imageDataUri)}
              </li>`;
            })
            .join("")}</ol>`
        : `<p class="muted">${escHtmlPdf(emptyMsg)}</p>`;
      const diag =
        opts.incluirDiagnostico && it.diagnostico
          ? `<div class="diag">
            <p><strong>Diagnóstico:</strong> ${escHtmlPdf(
              it.diagnostico.resumoProblema
            )}</p>
            ${
              it.diagnostico.observacaoTecnica
                ? `<p><strong>Observação técnica:</strong> ${escHtmlPdf(
                    it.diagnostico.observacaoTecnica
                  )}</p>`
                : ""
            }
          </div>`
          : "";
      return `<section class="laudo-item">
        <h2>${escHtmlPdf(it.codigoProduto)}${sn}</h2>
        <p class="desc">${escHtmlPdf(it.descricao)}</p>
        ${meta ? `<p class="muted">${meta}</p>` : ""}
        ${diag}
        ${perguntasHtml}
      </section>`;
    })
    .join("");

  return `<section class="part-laudo">
    <h1>${escHtmlPdf(opts.titulo)}</h1>
    <p class="muted">${escHtmlPdf(opts.subtitulo)}</p>
    ${blocos}
  </section>`;
}

/** Laudo de entrada (recebimento + diagnóstico). */
export function htmlLaudoRecebimento(
  itens: ItemLaudoPdf[],
  imageDataUri: (url: string) => string | null
): string {
  return htmlLaudoChecklist(itens, imageDataUri, {
    titulo: "Laudo de recebimento",
    subtitulo:
      "Checklist, fotos e observações registrados na entrada do equipamento.",
    papelPor: "Recebido por",
    incluirDiagnostico: true,
    emptyChecklistMsg: "Não há checklist de recebimento para este item.",
  });
}

/** Laudo de saída (liberação). */
export function htmlLaudoLiberacao(
  itens: ItemLaudoPdf[],
  imageDataUri: (url: string) => string | null
): string {
  return htmlLaudoChecklist(itens, imageDataUri, {
    titulo: "Laudo de liberação",
    subtitulo:
      "Checklist e fotos registrados antes da devolução ou troca do equipamento.",
    papelPor: "Liberado por",
    incluirDiagnostico: false,
    emptyChecklistMsg: "Não há checklist de liberação para este item.",
  });
}
