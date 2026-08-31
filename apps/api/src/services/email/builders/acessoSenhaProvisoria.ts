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
      ? "Bem-vindo ao TEEP Estoque"
      : "Nova senha provisória";
  const intro =
    opts.motivo === "cadastro"
      ? "Criamos seu acesso ao controle de estoque da TEEP. Use os dados abaixo no primeiro login."
      : "Um administrador gerou uma nova senha provisória para a sua conta. Entre com ela e defina uma senha nova em seguida.";

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
