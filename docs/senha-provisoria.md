# Senha provisória, 1º acesso e perfil

**Status:** implementado.  
**Telas:** `/login` · `/trocar-senha` · `/perfil` · Admin → Usuários.

---

## Fluxo (cadastro → uso normal)

```text
Admin cria Gerente/Operador
  → deveTrocarSenha=true, perfilCompleto=false
  → e-mail ACESSO_SENHA_PROVISORIA (+ senhaProvisoria na resposta HTTP, uma vez)
  → login com provisória
  → /trocar-senha (só senha nova; provisória já validada no login)
  → se perfil incompleto: passo “Finalize seu cadastro” (ou /perfil?completar=1)
  → home do perfil
```

| Etapa | Comportamento no sistema |
|-------|---------------------------|
| Cadastro (UI) | Sem campo de senha; API gera provisória (API ainda aceita `senha` opcional no schema) |
| E-mail | Sempre enfileirado (não depende de opt-in de alertas). Sem SMTP → log `[email:dev]` |
| Com `deveTrocarSenha` | JWT válido, mas API só libera em `/auth`: `GET /me`, `POST /trocar-senha`, `POST /logout`. Outro path → `403` `MUST_CHANGE_PASSWORD` |
| UI gate | `AppShell` manda para `/trocar-senha`; depois, se `perfilCompleto === false`, para `/perfil?completar=1` |
| Troca obrigatória | Body: `{ senhaNova, senhaNovaConfirmacao }` — **sem** `senhaAtual` |
| Troca no perfil | Exige `senhaAtual` + nova (regras fortes) |
| Reset (Admin) | `POST /usuarios/:id/senha-provisoria` — **não** aplica a perfil ADMIN; invalida refresh tokens; e-mail + senha na resposta |

**Senha forte** (`packages/shared`): mín. 8 chars, 1 maiúscula, 1 número. Nova senha ≠ atual.

**Seed:** admin/gerente/operador ficam com `deveTrocarSenha=false` e `perfilCompleto=true` (homologação sem wizard).

---

## API

| Método | Path | Quem |
|--------|------|------|
| `POST` | `/usuarios` | Admin — cria Gerente/Operador; resposta inclui `senhaProvisoria` |
| `POST` | `/usuarios/:id/senha-provisoria` | Admin — reset; bloqueado para Admin |
| `POST` | `/auth/login` | Público |
| `POST` | `/auth/trocar-senha` | Autenticado |
| `GET` | `/auth/me` | Autenticado |
| `PATCH` | `/auth/me` (perfil) | Autenticado — dados pessoais; com `perfilCompleto: true` no wizard |

Não dá para criar outro Admin por `POST /usuarios`.

---

## UI

- **Admin → Usuários:** formulário sem senha; após create, painel “anote a senha provisória”; lista com badge **Provisória**; botão reset
- **`/trocar-senha`:** passo 1 senha → passo 2 perfil (se incompleto)
- **`/perfil`:** edição de dados + troca voluntária de senha; `?completar=1` no 1º acesso
- Avatar: upload separado (ver [upload-midia.md](./upload-midia.md))

---

## O que este doc **não** cobre

- Políticas de JWT / refresh (middleware padrão)
- Preferências de alerta por usuário (ver [alertas-email.md](./alertas-email.md))
