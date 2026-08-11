import { ALERTA_EVENTO_LABELS } from "@teep/shared";
import { prisma } from "../../lib/prisma";
import {
  ALERTA_EMAIL_TYPES,
  CONTA_EMAIL_TYPES,
  EMAIL_TYPES,
  type EmailType,
} from "./emailTypes";
import type { PreparedTransactionalEmail } from "./preparedMail";
import { escapeHtml } from "./recipientUtils";
import { transactionalLayout } from "./transactionalLayout";

export type EmailTemplateDef = {
  type: EmailType;
  label: string;
  subject: string;
  bodyText: string;
  preheader?: string;
  /** Placeholders documentados para a UI admin */
  placeholders: Array<{ key: string; descricao: string }>;
};

const ALERTA_PLACEHOLDERS = [
  { key: "nome", descricao: "Nome do destinatário" },
  { key: "titulo", descricao: "Título do evento (ex.: Estoque mínimo · COD-123)" },
  { key: "mensagem", descricao: "Texto do alerta gerado pelo sistema" },
];

const ACESSO_PLACEHOLDERS = [
  { key: "nome", descricao: "Nome do destinatário" },
  { key: "titulo", descricao: "Título do e-mail" },
  { key: "intro", descricao: "Frase de contexto (cadastro ou reset)" },
  { key: "email", descricao: "E-mail de login" },
  { key: "senha", descricao: "Senha provisória" },
  { key: "appUrl", descricao: "URL do sistema" },
];

/** Defaults de fábrica (quando não há override no banco). */
export function defaultEmailTemplate(type: EmailType): EmailTemplateDef {
  if (type === "ACESSO_SENHA_PROVISORIA") {
    return {
      type,
      label: "Acesso — senha provisória",
      subject: "[TEEP] {{titulo}}",
      preheader: "Senha provisória para acesso ao TEEP Estoque",
      placeholders: ACESSO_PLACEHOLDERS,
      bodyText: [
        "Olá {{nome}},",
        "",
        "{{intro}}",
        "",
        "E-mail de acesso: {{email}}",
        "Senha provisória: {{senha}}",
        "",
        "Acesse: {{appUrl}}",
        "",
        "No primeiro login você será obrigado a trocar esta senha.",
        "",
        "— Sistema TEEP Estoque",
      ].join("\n"),
    };
  }
  return {
    type,
    label: ALERTA_EVENTO_LABELS[type],
    subject: "[TEEP] {{titulo}}",
    preheader: undefined,
    placeholders: ALERTA_PLACEHOLDERS,
    bodyText: [
      "Olá {{nome}},",
      "",
      "{{mensagem}}",
      "",
      "— Sistema TEEP Estoque",
    ].join("\n"),
  };
}

export function listEmailTemplateDefs(): EmailTemplateDef[] {
  return EMAIL_TYPES.map((t) => defaultEmailTemplate(t));
}

function applyVars(
  template: string,
  vars: Record<string, string>,
  htmlEscape: boolean
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = vars[key] ?? "";
    return htmlEscape ? escapeHtml(v) : v;
  });
}

function bodyTextToHtml(escapedBody: string): string {
  const blocks = escapedBody.split(/\n\n+/).filter((b) => b.trim());
  return blocks
    .map((block) => {
      const withBr = block.trim().replace(/\n/g, "<br/>");
      return `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">${withBr}</p>`;
    })
    .join("");
}

export function renderEmailFromTemplate(
  def: Pick<EmailTemplateDef, "type" | "subject" | "bodyText" | "preheader">,
  vars: Record<string, string>
): PreparedTransactionalEmail {
  const subject = applyVars(def.subject, vars, false).trim();
  const text = applyVars(def.bodyText, vars, false);
  const titulo =
    vars.titulo?.trim() ||
    (ALERTA_EMAIL_TYPES.includes(def.type as (typeof ALERTA_EMAIL_TYPES)[number])
      ? ALERTA_EVENTO_LABELS[def.type as keyof typeof ALERTA_EVENTO_LABELS]
      : "TEEP Estoque");
  const preheaderRaw =
    def.preheader?.trim() ||
    vars.mensagem?.slice(0, 120) ||
    vars.intro?.slice(0, 120) ||
    "";
  const html = transactionalLayout({
    titulo,
    preheader: preheaderRaw ? applyVars(preheaderRaw, vars, false) : undefined,
    corpoHtml: bodyTextToHtml(applyVars(def.bodyText, vars, true)),
  });
  return { type: def.type, subject, text, html };
}

/** Carrega override do banco (ou default). */
export async function resolveEmailTemplate(
  type: EmailType
): Promise<EmailTemplateDef> {
  const base = defaultEmailTemplate(type);
  const row = await prisma.emailTemplate.findUnique({ where: { type } });
  if (!row) return base;
  return {
    ...base,
    subject: row.subject,
    bodyText: row.bodyText,
    preheader: row.preheader ?? undefined,
  };
}

export async function saveEmailTemplate(
  type: EmailType,
  data: { subject: string; bodyText: string; preheader?: string | null }
): Promise<EmailTemplateDef> {
  const base = defaultEmailTemplate(type);
  const subject = data.subject.trim();
  const bodyText = data.bodyText.trim();
  if (!subject) throw new Error("Assunto obrigatório");
  if (!bodyText) throw new Error("Corpo obrigatório");
  if (subject.length > 200) throw new Error("Assunto muito longo");

  await prisma.emailTemplate.upsert({
    where: { type },
    create: {
      type,
      subject,
      bodyText,
      preheader: data.preheader?.trim() || null,
    },
    update: {
      subject,
      bodyText,
      preheader: data.preheader?.trim() || null,
    },
  });

  return {
    ...base,
    subject,
    bodyText,
    preheader: data.preheader?.trim() || undefined,
  };
}

export async function resetEmailTemplate(
  type: EmailType
): Promise<EmailTemplateDef> {
  await prisma.emailTemplate.deleteMany({ where: { type } });
  return defaultEmailTemplate(type);
}

/** Sample vars para preview/teste admin. */
export function sampleVarsFor(type: EmailType): Record<string, string> {
  const appUrl =
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN ||
    "http://localhost:3000";
  if (type === "ACESSO_SENHA_PROVISORIA") {
    return {
      nome: "Usuário Teste",
      titulo: "Acesso ao TEEP Estoque",
      intro:
        "Seu usuário foi criado no Sistema de Controle de Estoque TEEP.",
      email: "usuario@teep.com.br",
      senha: "Tmp9xample",
      appUrl,
    };
  }
  if (
    type === "DIVERGENCIA_TRANSFERENCIA" ||
    type === "TRANSFERENCIA_PENDENTE_APROVACAO" ||
    type === "TRANSFERENCIA_APROVADA" ||
    type === "TRANSFERENCIA_REJEITADA" ||
    type === "RMA_ABERTO" ||
    type === "RMA_FINANCEIRO" ||
    type === "RMA_ENCERRADO" ||
    type === "ALERTA_RETORNO_MOVIMENTACAO"
  ) {
    return {
      nome: "Usuário Teste",
      titulo: ALERTA_EVENTO_LABELS[type],
      mensagem: `Mensagem de exemplo para o evento ${type}.`,
    };
  }
  return {
    nome: "Usuário Teste",
    titulo: `${ALERTA_EVENTO_LABELS[type]} · DEMO-PROD-01`,
    mensagem: `Mensagem de exemplo para o evento ${type} (produto DEMO-PROD-01).`,
  };
}

export async function getEmailSampleAsync(
  type: EmailType
): Promise<PreparedTransactionalEmail> {
  const def = await resolveEmailTemplate(type);
  return renderEmailFromTemplate(def, sampleVarsFor(type));
}

/** Lista tipos para UI (defaults + se há override). */
export async function listEmailTemplatesForAdmin() {
  const overrides = await prisma.emailTemplate.findMany({
    select: { type: true, atualizadoEm: true },
  });
  const map = new Map(overrides.map((o) => [o.type, o.atualizadoEm]));
  return [...ALERTA_EMAIL_TYPES, ...CONTA_EMAIL_TYPES].map((type) => {
    const def = defaultEmailTemplate(type);
    return {
      type,
      label: def.label,
      customizado: map.has(type),
      atualizadoEm: map.get(type)?.toISOString() ?? null,
    };
  });
}
