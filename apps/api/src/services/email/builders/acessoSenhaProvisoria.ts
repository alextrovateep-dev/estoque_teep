import type { PreparedTransactionalEmail } from "../preparedMail";
import {
  renderEmailFromTemplate,
  resolveEmailTemplate,
} from "../emailTemplateStore";

export async function buildAcessoSenhaProvisoriaEmail(opts: {
  destinatarioNome: string;
  emailLogin: string;
  senhaProvisoria: string;
  appUrl: string;
  motivo: "cadastro" | "reset";
}): Promise<PreparedTransactionalEmail> {
  const titulo =
    opts.motivo === "cadastro"
      ? "Acesso ao TEEP Estoque"
      : "Nova senha provisória";
  const intro =
    opts.motivo === "cadastro"
      ? "Seu usuário foi criado no Sistema de Controle de Estoque TEEP."
      : "O administrador gerou uma nova senha provisória para a sua conta.";

  const def = await resolveEmailTemplate("ACESSO_SENHA_PROVISORIA");
  return renderEmailFromTemplate(def, {
    nome: opts.destinatarioNome,
    titulo,
    intro,
    email: opts.emailLogin,
    senha: opts.senhaProvisoria,
    appUrl: opts.appUrl,
  });
}
