import { AuthUser } from "../../middleware/auth";
import { AppError } from "../../middleware/error";
import { prisma } from "../../lib/prisma";
import {
  ChatMessage,
  getLlmConfig,
  getLlmProvider,
  isAssistenteEnabled,
  LlmToolDef,
} from "./llm";
import { buildSystemPrompt, suggestedLinksFor, navAllowlist } from "./systemPrompt";
import { executeTool, toolsForUser } from "./tools";
import { resolvePermissoes, PermissoesUsuario } from "@teep/shared";
import type { AssistenteExportFormat } from "./assistenteExportTokenStore";

export type AssistenteDownload = {
  token: string;
  filename: string;
  label: string;
  format: AssistenteExportFormat;
};

export type AssistenteActionLink = {
  href: string;
  label: string;
};

export type AssistenteChatResult = {
  reply: string;
  suggestedLinks: { href: string; label: string }[];
  actionLinks: AssistenteActionLink[];
  toolsUsed: string[];
  downloads: AssistenteDownload[];
};

const TOOL_RESULT_MAX_CHARS = 8000;

function parseArgs(
  raw: string
): { ok: true; args: unknown } | { ok: false; error: string } {
  try {
    if (!raw || !raw.trim()) return { ok: true, args: {} };
    return { ok: true, args: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      error: "Argumentos da tool inválidos (JSON malformado).",
    };
  }
}

/** Serializa resultado da tool; se passar do limite, marca truncado sem inventar dados. */
export function packToolContentForLlm(toolContent: unknown): string {
  const raw = JSON.stringify(toolContent);
  if (raw.length <= TOOL_RESULT_MAX_CHARS) return raw;

  const aviso =
    "Payload truncado por tamanho. NÃO invente itens ausentes; diga que a lista veio incompleta e, se fizer sentido, sugira filtro mais específico ou relatório.";

  if (
    toolContent &&
    typeof toolContent === "object" &&
    !Array.isArray(toolContent)
  ) {
    const marked = {
      ...(toolContent as Record<string, unknown>),
      truncado: true,
      aviso,
    };
    const s = JSON.stringify(marked);
    if (s.length <= TOOL_RESULT_MAX_CHARS) return s;
  }

  const envelope = { truncado: true as const, aviso, preview: "" };
  const overhead = JSON.stringify(envelope).length;
  const budget = Math.max(200, TOOL_RESULT_MAX_CHARS - overhead - 10);
  envelope.preview = raw.slice(0, budget);
  let out = JSON.stringify(envelope);
  while (out.length > TOOL_RESULT_MAX_CHARS && envelope.preview.length > 100) {
    envelope.preview = envelope.preview.slice(
      0,
      Math.floor(envelope.preview.length * 0.9)
    );
    out = JSON.stringify(envelope);
  }
  return out.slice(0, TOOL_RESULT_MAX_CHARS);
}

function collectDownload(toolResult: unknown, out: AssistenteDownload[]): void {
  if (!toolResult || typeof toolResult !== "object") return;
  const r = toolResult as Record<string, unknown>;
  if (r.ok !== true || typeof r.downloadToken !== "string") return;
  if (typeof r.filename !== "string" || typeof r.label !== "string") return;
  if (r.format !== "pdf" && r.format !== "xlsx") return;
  out.push({
    token: r.downloadToken,
    filename: r.filename,
    label: r.label,
    format: r.format,
  });
}

export function collectActionLink(
  toolResult: unknown,
  out: AssistenteActionLink[],
  allowedHrefs: Set<string>
): void {
  if (!toolResult || typeof toolResult !== "object") return;
  const r = toolResult as Record<string, unknown>;
  if (r.ok !== true) return;
  const link = r.actionLink;
  if (!link || typeof link !== "object") return;
  const a = link as Record<string, unknown>;
  if (typeof a.href !== "string" || typeof a.label !== "string") return;
  if (!a.href.startsWith("/")) return;
  const pathOnly = a.href.split("?")[0] || a.href;
  if (!isActionHrefAllowed(pathOnly, allowedHrefs)) return;
  if (out.some((x) => x.href === a.href)) return;
  out.push({ href: a.href, label: a.label });
}

/** Exact allowlist match, or /rma|/transferencias/<uuid> when the list href is allowed. */
function isActionHrefAllowed(pathOnly: string, allowedHrefs: Set<string>): boolean {
  if (allowedHrefs.has(pathOnly)) return true;
  const uuid =
    "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (
    allowedHrefs.has("/rma") &&
    new RegExp(`^/rma/${uuid}$`, "i").test(pathOnly)
  ) {
    return true;
  }
  if (
    allowedHrefs.has("/transferencias") &&
    new RegExp(`^/transferencias/${uuid}$`, "i").test(pathOnly)
  ) {
    return true;
  }
  return false;
}

/** Remove actionLink do payload enviado ao LLM quando a ACL não liberou o botão. */
export function redactActionLinkForLlm(
  toolResult: unknown,
  collected: AssistenteActionLink[]
): unknown {
  if (!toolResult || typeof toolResult !== "object") return toolResult;
  const r = toolResult as Record<string, unknown>;
  const link = r.actionLink;
  if (!link || typeof link !== "object") return toolResult;
  const href = (link as Record<string, unknown>).href;
  if (typeof href !== "string") return toolResult;
  if (collected.some((x) => x.href === href)) return toolResult;
  const { actionLink: _a, ...rest } = r;
  return {
    ...rest,
    ok: false,
    error:
      typeof rest.error === "string"
        ? rest.error
        : "Atalho de transferência indisponível: usuário sem acesso a Novo Lançamento.",
    mensagem:
      "Não há botão de atalho. Explique que falta permissão de Novo Lançamento (Admin).",
  };
}

export async function runAssistenteChat(input: {
  user: AuthUser;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  filialId?: string | null;
}): Promise<AssistenteChatResult> {
  if (!isAssistenteEnabled()) {
    throw new AppError(503, "Assistente de estoque desligado");
  }

  const message = input.message.trim();
  if (!message) throw new AppError(400, "Mensagem obrigatória");

  let filialSigla: string | null = null;
  if (input.user.perfil === "OPERADOR") {
    const ids =
      input.user.filialIds?.length > 0
        ? input.user.filialIds
        : input.user.filialId
          ? [input.user.filialId]
          : [];
    if (ids.length > 0) {
      const filiais = await prisma.filial.findMany({
        where: { id: { in: ids } },
        select: { sigla: true },
        orderBy: { sigla: "asc" },
      });
      filialSigla = filiais.map((f) => f.sigla).join(", ") || null;
    }
  } else if (input.filialId) {
    const f = await prisma.filial.findUnique({
      where: { id: input.filialId },
      select: { sigla: true },
    });
    filialSigla = f?.sigla ?? null;
  }

  const row = await prisma.usuario.findUnique({
    where: { id: input.user.id },
    select: { permissoes: true, perfil: true },
  });
  const permissoes: PermissoesUsuario = resolvePermissoes(
    (row?.perfil as typeof input.user.perfil) || input.user.perfil,
    (row?.permissoes as Record<string, boolean>) || null
  );
  const perfilEfetivo =
    (row?.perfil as typeof input.user.perfil) || input.user.perfil;

  const system = buildSystemPrompt({
    user: { ...input.user, perfil: perfilEfetivo },
    filialSigla,
    permissoes,
  });

  const history = (input.history || [])
    .filter((h) => h.content?.trim())
    .slice(-10)
    .map((h) => ({
      role: h.role,
      content: h.content.slice(0, 2000),
    }));

  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: message.slice(0, 2000) },
  ];

  const tools: LlmToolDef[] = toolsForUser(perfilEfetivo, permissoes).map(
    (t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    })
  );

  const cfg = getLlmConfig();
  const provider = getLlmProvider();
  const toolsUsed: string[] = [];
  const downloads: AssistenteDownload[] = [];
  const actionLinks: AssistenteActionLink[] = [];
  const allowedActionHrefs = new Set(
    navAllowlist(perfilEfetivo, permissoes).map((l) => l.href)
  );
  const started = Date.now();

  for (let round = 0; round < cfg.maxRounds; round++) {
    const roundStart = Date.now();
    const result = await provider.chatWithTools({
      system,
      messages,
      tools,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    });

    console.log(
      JSON.stringify({
        event: "assistente_llm_round",
        provider: provider.name,
        model: cfg.model,
        round,
        toolCalls: result.toolCalls.map((t) => t.name),
        latencyMs: Date.now() - roundStart,
        tokens: result.usage,
        userId: input.user.id,
      })
    );

    if (!result.toolCalls.length) {
      const reply =
        result.content?.trim() ||
        "Não consegui montar uma resposta. Tente reformular a pergunta.";
      console.log(
        JSON.stringify({
          event: "assistente_llm_done",
          provider: provider.name,
          toolsUsed,
          latencyMs: Date.now() - started,
          userId: input.user.id,
        })
      );
      return {
        reply,
        suggestedLinks: suggestedLinksFor(
          perfilEfetivo,
          toolsUsed,
          permissoes
        ),
        actionLinks,
        toolsUsed,
        downloads,
      };
    }

    messages.push({
      role: "assistant",
      content: result.content || "",
      toolCalls: result.toolCalls,
    });

    for (const tc of result.toolCalls) {
      toolsUsed.push(tc.name);
      const parsed = parseArgs(tc.arguments);
      let toolResult: unknown;
      if (!parsed.ok) {
        toolResult = { ok: false, error: parsed.error };
      } else {
        try {
          toolResult = await executeTool(tc.name, parsed.args, {
            user: input.user,
            filialHint: input.filialId,
            permissoes,
          });
        } catch (e) {
          toolResult = {
            error: e instanceof Error ? e.message : "Falha na tool",
          };
        }
      }
      collectDownload(toolResult, downloads);
      collectActionLink(toolResult, actionLinks, allowedActionHrefs);
      console.log(
        JSON.stringify({
          event: "assistente_tool",
          tool: tc.name,
          args: parsed.ok ? parsed.args : { parseError: true },
          userId: input.user.id,
        })
      );
      // Não envia o token bruto ao LLM (já está em downloads[] para a UI)
      let toolContent = redactActionLinkForLlm(toolResult, actionLinks);
      if (
        toolContent &&
        typeof toolContent === "object" &&
        "downloadToken" in toolContent
      ) {
        const { downloadToken: _t, ...rest } = toolContent as Record<
          string,
          unknown
        >;
        toolContent = {
          ...rest,
          downloadReady: true,
          mensagem:
            typeof rest.mensagem === "string"
              ? rest.mensagem
              : "Arquivo gerado. Avise o usuário para clicar no botão de download abaixo.",
        };
      }
      messages.push({
        role: "tool",
        toolCallId: tc.id,
        toolName: tc.name,
        content: packToolContentForLlm(toolContent),
      });
    }
  }

  // Última chance: responder com o que já veio das tools (sem novas tools)
  messages.push({
    role: "user",
    content:
      "Com base só no que as tools retornaram, responda a pergunta original em tom natural e direto (como colega de estoque). Não invente números nem itens. Não peça mais dados se já tiver o suficiente.",
  });
  try {
    const final = await provider.chatWithTools({
      system,
      messages,
      tools: [],
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    });
    const reply = final.content?.trim();
    if (reply) {
      return {
        reply,
        suggestedLinks: suggestedLinksFor(
          perfilEfetivo,
          toolsUsed,
          permissoes
        ),
        actionLinks,
        toolsUsed,
        downloads,
      };
    }
  } catch (e) {
    console.error("[assistente] falha na síntese final", e);
  }

  return {
    reply:
      toolsUsed.length > 0
        ? "Consultei o estoque, mas não consegui montar a resposta final. Tente de novo ou pergunte de outra forma."
        : "Não consegui consultar os dados. Tente novamente em instantes.",
    suggestedLinks: suggestedLinksFor(
      perfilEfetivo,
      toolsUsed,
      permissoes
    ),
    actionLinks,
    toolsUsed,
    downloads,
  };
}

export function getAssistenteStatus() {
  const cfg = getLlmConfig();
  return {
    enabled: isAssistenteEnabled(),
    provider: cfg.provider,
    model: isAssistenteEnabled() ? cfg.model : null,
  };
}
