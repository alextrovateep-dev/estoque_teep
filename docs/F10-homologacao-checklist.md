# F10 — Homologação / carga inicial

**DoD:** checklist ok (cadastros reais, init de saldos, smoke de lançamento; transferência se ≥2 filiais).

Use este documento na homologação antes do F11 (Hardening / Go-Live).

---

## Pré-requisitos técnicos

- [ ] `pnpm install` + `@teep/shared` build
- [ ] Postgres no ar (`pnpm --filter @teep/api db:pg` ou Compose)
- [ ] `pnpm db:migrate` + `pnpm db:seed`
- [ ] (Recomendado em homolog) `SEED_DEMO=1 pnpm db:seed` — 3 produtos + fornecedor demo **sem saldos**
- [ ] API `:4000` e Web `:3000` no ar (`pnpm dev`)
- [ ] Login admin: `admin@teep.com.br` / `Admin@123`

### Usuários de smoke (seed)

| E-mail | Perfil | Senha padrão | Filial |
|--------|--------|--------------|--------|
| `admin@teep.com.br` | ADMIN | `Admin@123` | PLN |
| `gerente@teep.com.br` | GERENTE | `Oper@123` | PLN |
| `operador@teep.com.br` | OPERADOR | `Oper@123` | PLN |
| `operador.tbo@teep.com.br` | OPERADOR | `Oper@123` | TBO |

---

## 1. Cadastros reais (RF20)

Revisar códigos e nomes com o time operacional (não aceitar “lixo” de teste em go-live).

- [ ] Filiais ativas corretas (Go-Live A: 1; Go-Live B: ≥2 — seed traz PLN + TBO)
- [ ] Categorias adequadas ao mix TEEP
- [ ] Produtos cadastrados (código único, unidade, preço, mín/máx se aplicável)
- [ ] Produtos que exigem rastreio: flag **Controla número de série** (só ativar com saldo zero ou séries alinhadas no inventário)
- [ ] Clientes / fornecedores necessários aos tipos Compra e Venda
- [ ] Usuários reais (Admin / Gerente / Operador) com filial do Operador
- [ ] Preferências de alerta (F9) nos usuários que devem receber e-mail/toast

**Critério:** lista de códigos revisada; sem duplicata; produto inativo não aparece em lançamento.

---

## 2. Inicialização de saldos

- [ ] Tela `/estoque/init` — filial de cutover
- [ ] Saldos iniciais conferidos com inventário físico / planilha oficial
- [ ] Produtos com série: informar N séries no inventário (1 série = 1 unidade)
- [ ] Confirmar reinicialização só quando intencional (`confirmarReinit`)
- [ ] Se Go-Live B: repetir init na 2ª filial (ou planejar transferência após carga na origem)

**Critério:** dashboard / saldos batem com a carga acordada.

---

## 3. Smoke operacional (manual ou script)

### Automatizado (recomendado)

```bash
# API rodando
pnpm smoke:f10
```

- [ ] Script exit 0 (health → login → produto → init → compra/venda → saldo → transferência PLN→TBO)

### Manual (UI)

- [ ] Novo lançamento: **Compra** (com fornecedor) → status CONCLUIDO → saldo sobe
- [ ] Novo lançamento: **Venda / Entrega** → saldo desce
- [ ] Dashboard reflete movimentos do dia
- [ ] (Opcional) Operador lança tipo com `requerAprovacao` → PENDENTE → Gerente aprova em `/aprovacoes`
- [ ] (Go-Live B) Novo Lançamento → tipo Transferência PLN→TBO (aguardar recebimento) → conferir em Transferências → status RECEBIDO
- [ ] (Go-Live B) Novo Lançamento → transferência com crédito imediato → destino já com saldo; status RECEBIDO
- [ ] (Go-Live B / F9) Conferência com divergência → justificativa + toast/e-mail se preferências ligadas
- [ ] **Séries:** produto com `controlaSerie` → entrada com 3 séries → transferência (checklist na conferência) → saída → retorno (séries da saída)
- [ ] **Séries:** busca em `/estoque/series` localiza unidade + histórico

**Critério:** nenhum saldo negativo indevido; ledger bate com tela de movimentações.

---

## 4. Go-Live A vs B

| Gate | Filiais ativas no cutover | Obrigatório além de F0–F7 + F10 |
|------|---------------------------|--------------------------------|
| **A** | 1 | F11 |
| **B** | ≥2 | F8 (transferências) + F11; F9 recomendado |

- [ ] Time definiu gate **A** ou **B** para esta carga
- [ ] Staging + HTTPS + backup conforme [`docs/F11-hardening-golive.md`](./F11-hardening-golive.md)
- [ ] Se B: smoke de transferência OK

---

## 5. Assinatura

| Campo | Valor |
|-------|--------|
| Ambiente | ex.: local / staging |
| Data | |
| Responsável | |
| Gate | A / B |
| Smoke `pnpm smoke:f10` | OK / NOK |
| Observações | |

**Homologação F10:** ☐ Aprovada ☐ Reprovada (voltar cadastros / init / correções)
