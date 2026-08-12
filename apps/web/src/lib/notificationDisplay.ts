/**
 * Formatação de notificações no estilo inbox (ML/OLX):
 * preview curto, href navegável, sem URL crua no corpo.
 */

const HREF_ALLOW =
  /^\/(rma|transferencias|movimentacoes|lancamentos|estoque|produtos|cadastros|aprovacoes|relatorios)(\/|$|\?)/i;

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export type NotificacaoDisplayInput = {
  titulo: string;
  mensagem: string;
  tipo?: string;
  meta?: unknown;
  criadoEm?: string;
};

export type NotificacaoDisplay = {
  /** Rota interna para o assunto (null = sem destino) */
  href: string | null;
  /** Linhas curtas para o corpo (sem links absolutos) */
  previewLines: string[];
  /** Resumo em uma linha (toast) */
  previewShort: string;
  /** Relativo: "há 5 min", "ontem", etc. */
  relativeTime: string;
};

function asRecord(meta: unknown): Record<string, unknown> {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  return {};
}

function sanitizeHref(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;

  try {
    if (/^https?:\/\//i.test(t)) {
      const u = new URL(t);
      const path = `${u.pathname}${u.search}`;
      return HREF_ALLOW.test(path) ? path : null;
    }
  } catch {
    return null;
  }

  const path = t.startsWith("/") ? t : `/${t}`;
  return HREF_ALLOW.test(path) ? path : null;
}

function hrefFromMensagem(mensagem: string): string | null {
  const abs = mensagem.match(
    new RegExp(`https?:\\/\\/[^\\s]+\\/(rma|transferencias)\\/${UUID}`, "i")
  );
  if (abs?.[0]) return sanitizeHref(abs[0]);

  const rel = mensagem.match(
    new RegExp(`\\/(rma|transferencias)\\/${UUID}`, "i")
  );
  if (rel?.[0]) return sanitizeHref(rel[0]);

  return null;
}

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^abrir no sistema/i.test(t)) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^produtos\s*\/\s*s[eé]ries?:?\s*$/i.test(t)) return true;
  return false;
}

function cleanLine(line: string): string {
  return line
    .replace(/^\s*[-•]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Interpreta título + mensagem + meta para exibição no sino / toast.
 */
export function formatNotificacaoDisplay(
  input: NotificacaoDisplayInput,
  now = new Date()
): NotificacaoDisplay {
  const meta = asRecord(input.meta);
  const href =
    sanitizeHref(
      typeof meta.href === "string" ? meta.href : null
    ) || hrefFromMensagem(input.mensagem || "");

  const lines = (input.mensagem || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((l) => !isNoiseLine(l));

  // Evita repetir o título no preview
  const tituloNorm = (input.titulo || "").trim().toLowerCase();
  const previewLines = lines
    .filter((l) => l.toLowerCase() !== tituloNorm)
    .slice(0, 3);

  const previewShort =
    previewLines[0] ||
    (input.titulo ? String(input.titulo) : "Nova notificação");

  return {
    href,
    previewLines:
      previewLines.length > 0
        ? previewLines
        : [previewShort].filter(Boolean),
    previewShort,
    relativeTime: formatRelativeTime(input.criadoEm, now),
  };
}

export function formatRelativeTime(
  iso: string | undefined,
  now = new Date()
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const diffSec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (diffSec < 45) return "agora";
  if (diffSec < 3600) {
    const m = Math.max(1, Math.floor(diffSec / 60));
    return `há ${m} min`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return h === 1 ? "há 1 hora" : `há ${h} horas`;
  }
  if (diffSec < 86400 * 2) return "ontem";
  if (diffSec < 86400 * 7) {
    const dias = Math.floor(diffSec / 86400);
    return `há ${dias} dias`;
  }
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}
