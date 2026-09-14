import { escapeHtml } from "./recipientUtils";

const BRAND = "#5B8B83";

/** Botão CTA compatível com clientes de e-mail (tabela + link). */
export function emailCtaButton(href: string, label: string): string {
  const safeHref = escapeHtml(href.trim());
  const safeLabel = escapeHtml(label.trim() || "Abrir");
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:16px 0 8px;">
  <tr>
    <td align="left" style="border-radius:6px;background:${BRAND};">
      <a href="${safeHref}" target="_blank" style="display:inline-block;padding:12px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
        ${safeLabel}
      </a>
    </td>
  </tr>
</table>`;
}

/**
 * Linha no formato "Rótulo: https://..." → botão.
 * Aceita http(s); ignora linhas com mais de um URL ou sem label útil.
 */
export function parseEmailCtaLine(
  line: string
): { label: string; href: string } | null {
  const trimmed = line.trim();
  const m = trimmed.match(/^(.+?):\s*(https?:\/\/\S+)\s*$/i);
  if (!m) return null;
  const label = m[1]!.trim();
  const href = m[2]!.trim();
  if (!label || label.length > 80) return null;
  if (/\shttps?:\/\//i.test(trimmed.slice(0, trimmed.lastIndexOf(href)))) {
    return null;
  }
  return { label, href };
}

/**
 * Converte corpo em texto (já com vars aplicadas) em HTML.
 * Parágrafos separados por linha em branco; linhas "rótulo: URL" viram botão.
 */
export function bodyTextToHtml(rawBody: string): string {
  const blocks = rawBody.split(/\n\n+/).filter((b) => b.trim());
  return blocks
    .map((block) => {
      const lines = block.trim().split(/\n/);
      if (lines.length === 1) {
        const cta = parseEmailCtaLine(lines[0]!);
        if (cta) return emailCtaButton(cta.href, cta.label);
      }

      const rendered: string[] = [];
      let textBuf: string[] = [];
      const flushText = () => {
        if (textBuf.length === 0) return;
        const withBr = textBuf
          .map((l) => escapeHtml(l))
          .join("<br/>");
        rendered.push(
          `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">${withBr}</p>`
        );
        textBuf = [];
      };

      for (const line of lines) {
        const cta = parseEmailCtaLine(line);
        if (cta) {
          flushText();
          rendered.push(emailCtaButton(cta.href, cta.label));
        } else {
          textBuf.push(line);
        }
      }
      flushText();
      return rendered.join("");
    })
    .join("");
}

export function transactionalLayout(opts: {
  titulo: string;
  corpoHtml: string;
  preheader?: string;
}): string {
  const support = process.env.EMAIL_SUPPORT || "suporte@teep.com.br";
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(opts.titulo)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  ${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(opts.preheader)}</div>` : ""}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:${BRAND};padding:16px 24px;color:#fff;font-size:18px;font-weight:600;">TEEP Estoque</td></tr>
        <tr><td style="padding:24px;">
          <h1 style="margin:0 0 12px;font-size:18px;color:#0f172a;">${escapeHtml(opts.titulo)}</h1>
          ${opts.corpoHtml}
        </td></tr>
        <tr><td style="padding:12px 24px;background:#f8fafc;font-size:12px;color:#94a3b8;">
          ${escapeHtml(support)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">${escapeHtml(text)}</p>`;
}
