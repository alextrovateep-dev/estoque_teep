# Senha provisória e primeiro acesso

**Status:** implementado.  
**Fluxo:** cadastro → e-mail com senha provisória → login → troca obrigatória. Admin pode resetar.

## Comportamento

| Ação | Resultado |
|------|-----------|
| Admin cadastra Gerente/Operador | Sistema gera senha provisória, grava `deveTrocarSenha=true`, envia e-mail `ACESSO_SENHA_PROVISORIA` |
| Usuário faz login | Recebe tokens, mas UI/API só permitem `/auth/trocar-senha` (e logout/me) |
| Tela `/trocar-senha` (1º acesso) | Só nova senha + confirmação — a provisória já foi validada no login |
| `POST /auth/trocar-senha` | Com `deveTrocarSenha`: `senhaAtual` opcional. Troca voluntária (perfil): exige senha atual |
| Admin → **Reset senha** | Nova provisória + e-mail + invalida refresh tokens |

E-mail de conta **não** depende do opt-in de alertas (sempre enviado). Sem SMTP, cai no log `[email:dev]`.

## API

- `POST /usuarios` — senha opcional; resposta inclui `senhaProvisoria` **uma vez** (cópia para o admin)
- `POST /usuarios/:id/senha-provisoria` — só Admin; não aplica a Admin
- `POST /auth/trocar-senha` — `{ senhaAtual, senhaNova, senhaNovaConfirmacao }`

## UI

- Admin → Usuários: sem campo de senha no cadastro; badge **Provisória**; botão Reset
- `/trocar-senha` após login com flag
- AppShell redireciona se `deveTrocarSenha`

Seed (admin/gerente/operador) permanece com `deveTrocarSenha=false` para homologação.
