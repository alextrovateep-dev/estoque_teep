import { ALERTA_EVENTO_LABELS, type AlertaEvento } from "@teep/shared";
import type { PreparedTransactionalEmail } from "../preparedMail";
import {
  renderEmailFromTemplate,
  resolveEmailTemplate,
} from "../emailTemplateStore";

export async function buildAlertaEmail(opts: {
  type: AlertaEvento;
  destinatarioNome: string;
  mensagem: string;
  /** Assunto/H1 — incluir código do produto quando o alerta for de item específico */
  titulo?: string;
}): Promise<PreparedTransactionalEmail> {
  const def = await resolveEmailTemplate(opts.type);
  return renderEmailFromTemplate(def, {
    nome: opts.destinatarioNome,
    titulo: (opts.titulo?.trim() || ALERTA_EVENTO_LABELS[opts.type]).slice(
      0,
      180
    ),
    mensagem: opts.mensagem,
  });
}
