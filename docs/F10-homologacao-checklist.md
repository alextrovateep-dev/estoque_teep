# F10 — Homologação / carga inicial

**DoD:** cadastros reais revisados, init de saldos conferido, smoke de lançamento OK; transferência se ≥2 estoques (Go-Live B).

Use **antes** do cutover: [F11-hardening-golive.md](./F11-hardening-golive.md).  
Stack em servidor: [INSTALACAO.md](./INSTALACAO.md). Este F10 também vale em **dev** (`pnpm`) para validar o fluxo.

**Regra de seed (código):** tipos e categorias sempre; **estoques PLN/TBO/RMA/DESC + usuários gerente/operador + produtos demo só com `SEED_DEMO=1`**. Sem demo, o admin nasce **sem** estoque — cadastre em Admin → Estoques.

---

## Pré-requisitos

### Dev (pnpm)

- [ ] `pnpm install` + `pnpm --filter @teep/shared build`
- [ ] Postgres no ar (`pnpm --filter @teep/api db:pg` ou Compose dev)
- [ ] `pnpm --filter @teep/api db:generate` + `db:migrate`
- [ ] **Homolog / smoke F10:**  
  `SEED_DEMO=1 pnpm --filter @teep/api db:seed`  
  (ou `SEED_DEMO=1` no `apps/api/.env` ao rodar o seed)
- [ ] API `:4000` e Web `:3000` (`pnpm dev`)

### Staging / prod (Docker)

- [ ] Stack no ar via INSTALACAO; admin do seed com senha já definida
- [ ] Se for testar transferência PLN→TBO: estoques e usuários de homolog precisam existir (seed demo **ou** cadastro manual equivalente)
- [ ] Smoke apontando para a API: `API_URL=https://api.… pnpm smoke:f10`

### Credenciais (seed)

| E-mail | Perfil | Senha padrão | Estoque (SEED_DEMO=1) |
|--------|--------|--------------|------------------------|
| `SEED_ADMIN_EMAIL` (padrão `admin@teep.com.br`) | ADMIN | `SEED_ADMIN_PASSWORD` (padrão `Admin@123`) | PLN (+ RMA) |
| `gerente@teep.com.br` | GERENTE | `SEED_OPS_PASSWORD` (padrão `Oper@123`) | PLN (+ RMA) |
| `operador@teep.com.br` | OPERADOR | idem | PLN (+ RMA) |
| `operador.tbo@teep.com.br` | OPERADOR | idem | TBO (+ RMA) |

Com `SEED_DEMO=1` o seed também cria estoques **RMA** e **DESC** (úteis para RMA; fora do smoke F10).

Produtos demo (3) + fornecedor demo: mesmos `SEED_DEMO=1` — **sem saldos** (saldo via `/estoque/init`).

---

## 1. Cadastros reais

Revisar códigos/nomes com o time (não levar “lixo” de teste ao go-live).

- [ ] Estoques ativos corretos (Go-Live A: 1; Go-Live B: ≥2 — demo traz PLN + TBO)
- [ ] Categorias adequadas ao mix
- [ ] Produtos (código único, unidade, preço, mín/máx se aplicável)
- [ ] Rastreio: flag **Controla número de série** só com saldo zero ou inventário alinhado
- [ ] Clientes / fornecedores para Compra e Venda
- [ ] Usuários reais (Admin / Gerente / Operador) com estoque do Operador
- [ ] Preferências de alerta (sino / e-mail) nos usuários que devem receber

**Critério:** códigos revisados; sem duplicata; produto inativo não aparece em lançamento.

---

## 2. Inicialização de saldos

- [ ] Tela `/estoque/init` — estoque de cutover
- [ ] Saldos iniciais conferidos com inventário / planilha
- [ ] Produtos com série: N séries no inventário (1 série = 1 unidade)
- [ ] Reinicialização só quando intencional (`confirmarReinit`)
- [ ] Go-Live B: init na 2ª filial **ou** carga na origem + transferência

**Critério:** Dashboard / saldos batem com a carga acordada.

---

## 3. Smoke operacional

### Automatizado (núcleo F10)

```bash
# API no ar; seed com SEED_DEMO=1 (precisa PLN; TBO para transferência)
pnpm smoke:f10
# staging/prod:
API_URL=https://api.estoque.teep.com.br pnpm smoke:f10
```

O script (`apps/api/scripts/smoke-f10.ts`) valida, em ordem:

1. `/health` → login admin  
2. Filiais (exige **PLN**; se houver **TBO**, testa transferência)  
3. Cria produto + fornecedor  
4. Init PLN = 50 → Compra +10 → Venda −5 → saldo **55**  
5. Dashboard  
6. Se TBO: transferência via `POST /movimentacoes` (`AGUARDAR_RECEBIMENTO`) → conferir → TBO = 8  

- [ ] Exit 0

### Extra (opcional)

```bash
pnpm smoke:extra
```

Cobre transferência com crédito **IMEDIATO** e checagens de papel (precisa PLN/TBO + produto).

Outros scripts em `apps/api/scripts/smoke-*.ts` (série, RMA, montagem, multi-lançamento, etc.) **não** estão no `pnpm smoke:f10` — use sob demanda na homologação da feature.

### Manual (UI)

- [ ] Novo lançamento: **Compra** (fornecedor) → CONCLUIDO → saldo sobe
- [ ] Novo lançamento: **Venda / Entrega** → saldo desce
- [ ] Dashboard reflete movimentos do dia
- [ ] (Opcional) Operador + tipo `requerAprovacao` → PENDENTE → Gerente em `/aprovacoes`
- [ ] (Go-Live B) Transferência **aguardar recebimento** → Transferências → RECEBIDO
- [ ] (Go-Live B) Transferência **crédito imediato** → destino com saldo; RECEBIDO
- [ ] (Go-Live B) Conferência com divergência → justificativa + alerta se preferências ligadas
- [ ] **Séries:** entrada com N séries → transferência (checklist) → saída → retorno
- [ ] **Séries:** filtro em **Movimentações** e/ou Dashboard (`?serie=`); `/estoque/series` só redireciona

**Critério:** sem saldo negativo indevido; ledger alinhado à tela de movimentações.

---

## 4. Go-Live A vs B

| Gate | Estoques ativos no cutover | Além do núcleo |
|------|----------------------------|----------------|
| **A** | 1 | Hardening F11 |
| **B** | ≥2 | Transferências (Novo Lançamento + conferência) + F11; alertas recomendados |

- [ ] Time definiu gate **A** ou **B**
- [ ] Staging + HTTPS + backup: [F11](./F11-hardening-golive.md) / [INSTALACAO](./INSTALACAO.md)
- [ ] Se B: smoke com TBO OK (ou fluxo manual equivalente)

---

## 5. Assinatura

| Campo | Valor |
|-------|--------|
| Ambiente | local / staging / … |
| Data | |
| Responsável | |
| Gate | A / B |
| `SEED_DEMO=1` (ou cadastros equivalentes) | Sim / Não |
| Smoke `pnpm smoke:f10` | OK / NOK |
| Observações | |

**Homologação F10:** ☐ Aprovada ☐ Reprovada
