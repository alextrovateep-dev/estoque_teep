import { escapeHtml } from "./recipientUtils";

const BRAND = "#5B8B83";

export function transactionalLayout(opts: {
  titulo: string;
  corpoHtml: string;
  preheader?: string;
}): string {
  const front = process.env.FRONTEND_URL || "http://localhost:3000";
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
          <p style="margin:24px 0 0;font-size:13px;color:#64748b;">
            Acesse o sistema: <a href="${escapeHtml(front)}" style="color:${BRAND};">${escapeHtml(front)}</a>
          </p>
        </td></tr>
        <tr><td style="padding:12px 24px;background:#f8fafc;font-size:12px;color:#94a3b8;">
          Mensagem transacional · ${escapeHtml(support)}
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
