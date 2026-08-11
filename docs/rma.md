# RMA — processo e estoque

**Status:** implementado (abertura, financeiro, sem manutenção, devolução, troca, defaults, cancelamento).  
**Telas:** `/rma` · `/rma/novo` · `/rma/[id]`  
**Permissões:** `rma` · `rma_cobranca` (financeiro)

---

## Princípios

1. **Estoque = motor padrão** — transferência/lançamento entre filiais (`Filial`). Sem “descarte paralelo”.
2. **RMA = processo** — decide o caminho do item; encerra quando o caso com o cliente fecha.
3. **Fechar ≠ destino do item** — dá para trocar/descartar a série e fechar depois (obs. livre).
4. **Estoques configuráveis** — `RMA`, `DESC`, operacionais etc. só existem se cadastrados (Admin → Estoques). Defaults opcionais via env.

---

## Status

| Entidade | Valores |
|----------|---------|
| **Processo** | `ABERTO` · `FECHADO` · `CANCELADO` |
| **Item** | `ABERTO` · `EM_ESTOQUE` · `SEM_MANUTENCAO` · `DEVOLVIDO` · `DESCARTADO` · `CANCELADO` |

Fechamento automático do processo quando não restam itens em `ABERTO` / `EM_ESTOQUE` / `SEM_MANUTENCAO` (ex.: após devolução/troca de todos).

---

## Fluxo operacional

```text
Cliente envia material
        │
        ▼
 Abrir RMA (Entrada RMA)  →  item EM_ESTOQUE no estoque RMA
        │
        ▼
 [Sem manutenção]  (só estado; saldo igual)
        │
        ├── Devolver (mesma série)  →  Saída RMA → DEVOLVIDO
        │
        └── Trocar
               ├─ Transferência IMEDIATA: origem operacional → preparação (ex. RMA) — série BOA
               ├─ Saída RMA da série BOA ao cliente
               └─ Transferência: RMA → descarte (ex. DESC) — série RUIM → DESCARTADO
```

Tipos seed: **Entrada RMA** / **Saída RMA** (saída RMA **não** usa fluxo `ehRetornoDe` de demo/comodato).

---

## O que o sistema faz hoje

| Ação | Estoque / efeito |
|------|------------------|
| Abrir processo | Entrada RMA → série no estoque RMA; item `EM_ESTOQUE` |
| Sem manutenção | `EM_ESTOQUE` → `SEM_MANUTENCAO` (sem mover saldo) |
| Devolver | Saída RMA da mesma série → `DEVOLVIDO` |
| Trocar | Só a partir de `SEM_MANUTENCAO`; orquestra 2 transferências (crédito **IMEDIATO**) + saída da boa; ruim → descarte |
| Financeiro | Laudo, cobrança Sim/Não, NFs (`rma_cobranca`) |
| Anexos | `LAUDO` · `NF_ENTRADA` · `NF_SAIDA` · `NF_COBRANCA` · `OUTRO` |
| Cancelar | Cancela processo/itens pendentes (regras do serviço) |
| Defaults | `GET /rma/defaults` — env → sigla RMA/DESC → lista operacional |

### Env (opcional)

- `RMA_FILIAL_PREPARACAO_ID`
- `RMA_FILIAL_DESCARTE_ID`
- `RMA_FILIAIS_ORIGEM_TROCA_IDS` (UUIDs separados por vírgula)

Passados no `docker-compose.prod.yml` quando definidos no `.env.production`.

Alertas in-app: `RMA_ABERTO` · `RMA_FINANCEIRO` · `RMA_ENCERRADO` (ver [alertas-email](./alertas-email.md)).

---

## API

| Método | Path |
|--------|------|
| `GET` | `/rma` · `/rma/defaults` · `/rma/:id` |
| `POST` | `/rma` (abrir) |
| `PATCH` | `/rma/:id/financeiro` |
| `POST` | `/rma/:id/anexos` · `/devolver` · `/sem-manutencao` · `/trocar` · `/cancelar` |

Smoke: `apps/api/scripts/smoke-rma-troca.ts`.

---

## Backlog (ainda fora)

- OS / etapas de manutenção  
- Envio a fornecedor  
- Relatórios gerenciais de RMA  
- Troca com transferência “aguardar recebimento” + conferência  

---

## Homologação rápida

1. `SEED_DEMO=1` (estoques RMA/DESC) ou cadastro manual equivalente.  
2. Abrir RMA com série → Sem manutenção → Devolver **ou** Trocar.  
3. Conferir saldos / `UnidadeSerie` e processo `FECHADO` quando não restar item aberto.
