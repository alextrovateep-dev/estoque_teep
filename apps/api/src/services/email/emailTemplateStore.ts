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
      preheader: "{{intro}}",
      placeholders: ACESSO_PLACEHOLDERS,
      bodyText: [
        "Olá {{nome}},",
        "",
        "{{intro}}",
        "",
        "E-mail de login: {{email}}",
        "Senha provisória: {{senha}}",
        "",
        "Entre aqui: {{appUrl}}",
        "",
        "Por segurança, no primeiro acesso pedimos que você troque esta senha. Não encaminhe este e-mail — ele contém sua senha temporária.",
        "",
        "Equipe TEEP Estoque",
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
      nome: "Maria Silva",
      titulo: "Bem-vindo ao TEEP Estoque",
      intro:
        "Criamos seu acesso ao controle de estoque da TEEP. Use os dados abaixo no primeiro login.",
      email: "maria.silva@teep.com.br",
      senha: "Tmp9xample",
      appUrl,
    };
  }
  if (type === "ESTOQUE_MINIMO") {
    return {
      nome: "Ana Operações",
      titulo: "Saldo baixo · DEMO-01",
      mensagem: [
        "O saldo de DEMO-01 — Sensor TEEP em PLN (Paulínia) está baixo.",
        "Saldo atual: 2\nMínimo cadastrado: 5",
        `Confira no sistema: ${appUrl}/dashboard`,
      ].join("\n\n"),
    };
  }
  if (type === "ESTOQUE_MAXIMO") {
    return {
      nome: "Ana Operações",
      titulo: "Saldo alto · DEMO-01",
      mensagem: [
        "O saldo de DEMO-01 — Sensor TEEP em PLN (Paulínia) ultrapassou o máximo.",
        "Saldo atual: 120\nMáximo cadastrado: 100",
        `Confira no sistema: ${appUrl}/dashboard`,
      ].join("\n\n"),
    };
  }
  if (type === "PRECO_AJUSTADO") {
    return {
      nome: "Ana Operações",
      titulo: "Preço atualizado · DEMO-01",
      mensagem: [
        "O preço de DEMO-01 — Sensor TEEP foi alterado.",
        "De R$ 150,00 para R$ 165,00 (+10%).",
        "Alteração feita por Carlos Admin.",
        `Ver produto: ${appUrl}/cadastros/produtos/00000000-0000-4000-8000-000000000001`,
      ].join("\n\n"),
    };
  }
  if (type === "TRANSFERENCIA_PENDENTE_APROVACAO") {
    return {
      nome: "Ana Operações",
      titulo: "Transferência aguardando aprovação · a1b2c3d4",
      mensagem: [
        "Há uma transferência (a1b2c3d4) esperando sua aprovação.",
        "De Paulínia para Taubaté · 2 item(ns).",
        "Solicitada por Carlos Admin.",
        `Aprovar ou rejeitar: ${appUrl}/transferencias/a1b2c3d4-0000-4000-8000-000000000001`,
      ].join("\n\n"),
    };
  }
  if (type === "TRANSFERENCIA_APROVADA") {
    return {
      nome: "Ana Operações",
      titulo: "Transferência aprovada · a1b2c3d4",
      mensagem: [
        "A transferência a1b2c3d4 foi aprovada por Maria Aprovadora.",
        "Rota: Paulínia → Taubaté.",
        `Acompanhe: ${appUrl}/transferencias/a1b2c3d4-0000-4000-8000-000000000001`,
      ].join("\n\n"),
    };
  }
  if (type === "TRANSFERENCIA_REJEITADA") {
    return {
      nome: "Ana Operações",
      titulo: "Transferência rejeitada · a1b2c3d4",
      mensagem: [
        "A transferência a1b2c3d4 foi rejeitada por Maria Aprovadora.",
        "Rota: Paulínia → Taubaté.",
        "Motivo: Quantidade divergente do pedido.",
        `Detalhes: ${appUrl}/transferencias/a1b2c3d4-0000-4000-8000-000000000001`,
      ].join("\n\n"),
    };
  }
  if (type === "DIVERGENCIA_TRANSFERENCIA") {
    return {
      nome: "Ana Operações",
      titulo: "Divergência na transferência · a1b2c3d4",
      mensagem: [
        "A conferência da transferência a1b2c3d4 encontrou diferença entre o enviado e o recebido.",
        "Rota: Paulínia → Taubaté.",
        "DEMO-01: enviado 10, recebido 8.",
        `Revise em: ${appUrl}/transferencias/a1b2c3d4-0000-4000-8000-000000000001`,
      ].join("\n\n"),
    };
  }
  if (type === "ALERTA_RETORNO_MOVIMENTACAO") {
    return {
      nome: "Financeiro",
      titulo: "Retorno pendente · DEMO-01",
      mensagem: [
        "Já se passaram 30 dias e ainda há quantidade em aberto do movimento de Empréstimo.",
        "Produto: DEMO-01 — Sensor TEEP",
        "Qtd saída: 2\nAinda em aberto: 2\nCliente: Cliente Demo\nEstoque: PLN (Paulínia)\nMovimento a1b2c3d4 em 01/07/2026",
        "Confira se o equipamento já voltou ou providencie o retorno.",
        `Ver movimento: ${appUrl}/movimentacoes/a1b2c3d4-0000-4000-8000-000000000001`,
      ].join("\n\n"),
    };
  }
  if (type === "RMA_ABERTO") {
    return {
      nome: "Ana Operações",
      titulo: "Novo RMA · b2c3d4e5",
      mensagem: [
        "Um novo RMA (b2c3d4e5) foi aberto para Cliente Demo LTDA.",
        "2 item(ns) · NF de entrada: 12345",
        "Aberto por Carlos Admin.",
        "Itens: DEMO-01 × 1; DEMO-02 × 1",
        `Abrir o processo: ${appUrl}/rma/b2c3d4e5-0000-4000-8000-000000000001`,
      ].join("\n\n"),
    };
  }
  if (type === "RMA_FINANCEIRO") {
    return {
      nome: "Ana Operações",
      titulo: "RMA — financeiro · b2c3d4e5",
      mensagem: [
        "Atualização financeira no RMA b2c3d4e5 (Cliente Demo LTDA).",
        "Há cobrança registrada neste RMA.\nValor: R$ 350,00 · NF de cobrança: 99887",
        `Ver processo: ${appUrl}/rma/b2c3d4e5-0000-4000-8000-000000000001`,
      ].join("\n\n"),
    };
  }
  if (type === "RMA_ENCERRADO") {
    return {
      nome: "Ana Operações",
      titulo: "RMA fechado · b2c3d4e5",
      mensagem: [
        "O RMA b2c3d4e5 de Cliente Demo LTDA foi fechado.",
        `Consultar: ${appUrl}/rma/b2c3d4e5-0000-4000-8000-000000000001`,
      ].join("\n\n"),
    };
  }
  if (type === "RMA_LAUDO") {
    return {
      nome: "Ana Operações",
      titulo: "Laudo disponível no RMA · b2c3d4e5",
      mensagem: [
        "Há diagnóstico(s) / laudo(s) no RMA b2c3d4e5 (Cliente Demo LTDA).",
        "• DEMO-01 — defeito confirmado\n• DEMO-02 — em análise",
        `Abrir o processo: ${appUrl}/rma/b2c3d4e5-0000-4000-8000-000000000001`,
      ].join("\n\n"),
    };
  }
  if (type === "PEDIDO_SEPARADO") {
    return {
      nome: "Ana Operações",
      titulo: "Pedido separado · 1042",
      mensagem: [
        "O pedido 1042 foi separado e o estoque já foi baixado.",
        "Cliente: Cliente Demo LTDA",
        "Estoque: PLN",
        `Ver pedido: ${appUrl}/pedidos/c3d4e5f6-0000-4000-8000-000000000001`,
      ].join("\n\n"),
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
