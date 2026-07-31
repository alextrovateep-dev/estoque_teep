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
}): Promise<PreparedTransactionalEmail> {
  const def = await resolveEmailTemplate(opts.type);
  return renderEmailFromTemplate(def, {
    nome: opts.destinatarioNome,
    titulo: ALERTA_EVENTO_LABELS[opts.type],
    mensagem: opts.mensagem,
  });
}
