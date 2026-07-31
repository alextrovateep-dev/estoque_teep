import { sendPreparedMailAsync } from "./EmailService";
import { buildAcessoSenhaProvisoriaEmail } from "./email/builders/acessoSenhaProvisoria";

function appUrl(): string {
  return (
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

/** E-mail de conta: sempre enfileirado (sem opt-in de alerta). */
export function enqueueSenhaProvisoriaEmail(opts: {
  nome: string;
  email: string;
  senhaProvisoria: string;
  motivo: "cadastro" | "reset";
}): void {
  void buildAcessoSenhaProvisoriaEmail({
    destinatarioNome: opts.nome,
    emailLogin: opts.email,
    senhaProvisoria: opts.senhaProvisoria,
    appUrl: appUrl(),
    motivo: opts.motivo,
  })
    .then((prepared) => sendPreparedMailAsync(opts.email, prepared))
    .catch((e) => {
      console.error("[acessoConta] falha ao montar e-mail de senha:", e);
    });
}
