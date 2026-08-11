# Orientação — RMA

## Status

**MVP + Sem manutenção / Troca (Fases A–C) + defaults Fase D:** abertura (Entrada RMA), **Sem manutenção**, devolução/retorno (Saída RMA), **Troca**, links de histórico no detalhe, defaults de filiais via env (`RMA_FILIAL_*`) + `GET /rma/defaults`.

**Fora deste plano:** OS/etapas de manutenção, envio a fornecedor, relatórios gerenciais, troca com “aguardar recebimento”.

---

## Princípios

1. **Estoque = motor padrão** — transferência/lançamento entre filiais (`Filial`). Nada de “descarte paralelo”.
2. **RMA = processo de negócio** — decide o caminho do item; fecha com observação quando o caso com o cliente encerra.
3. **Fechar processo ≠ destino do item** — dá para trocar/descartar a série ruim e fechar o RMA depois (“substituído por SN xxx”).
4. **Estoques configuráveis** — `RMA`, `DESC`, `PLN`, `TBO` (ou outros) só existem se cadastrados em Admin → Estoques. Origem da peça boa e destino de preparação **não são fixos** no código.

Cadastro dos locais: Admin → **Estoques** (model `Filial`).

---

## Fluxo operacional acordado

```text
Cliente envia material
        │
        ▼
 Expedição / Entrada RMA  →  série no estoque RMA (item EM_ESTOQUE)
        │
        ▼
   Vai para manutenção? ──────────── Sim ──► (futuro: OS / etapas)
        │
       Não
        │
        ▼
  [Sem manutenção]  (decisão no processo)
        │
        ├── Retornar ao cliente
        │      └─ Saída RMA da mesma série (já existe)
        │
        └── Trocar
               ├─ 1) Transferência configurável:
               │      estoque origem (PLN | TBO | outro)
               │         → destino preparação (em geral RMA)
               │      série BOA
               ├─ 2) Saída RMA / expedição da série BOA ao cliente
               └─ 3) Transferência série RUIM: RMA → estoque descarte (DESC ou outro)
```

### Papel de cada peça na troca

| Peça | O que acontece |
|------|----------------|
| Série **ruim** (entrou no RMA) | Transferência padrão → estoque de descarte (ex. `DESC`) |
| Série **boa** (substituta) | Transferência padrão origem operacional → preparação (ex. `RMA`), depois sai para o cliente |

### Fechamento do processo

- Independente do descarte.
- Observação livre (ex.: “produto substituído pelo SN …”).
- Itens podem estar `DEVOLVIDO`, `DESCARTADO` ou mistos; processo `FECHADO` quando o caso com o cliente encerra.

---

## MVP já coberto

| Momento | Movimentação | Saldo |
|---------|--------------|-------|
| Cliente envia | **Entrada RMA** | Sobe no estoque RMA |
| Devolve mesma série | **Saída RMA** (UI: Devolução) | Desce do RMA |
| Cancelar | Estorno entradas (regras atuais) | — |
| Financeiro | Laudo, cobrança, NFs | — |

## O que este plano adiciona

| Momento | UI (decisão) | Motor de estoque |
|---------|--------------|------------------|
| Sem manutenção | Ação no item/processo | Só muda estado de decisão (sem mover saldo) |
| Retornar | Atalho (reusa devolução) | Saída RMA existente |
| Trocar — trazer boa | Formulário: origem, destino prep., série boa | **Transferência padrão** |
| Trocar — enviar ao cliente | Expedição / Saída | Saída RMA da série boa |
| Trocar — destino da ruim | Destino configurável (ex. DESC) | **Transferência padrão** RMA → destino |

---

## Plano de implementação (fases)

### Fase A — Modelo e estados (sem inventar estoque)

- Revisar status de **item** para caber a decisão:
  - Hoje: `ABERTO | EM_ESTOQUE | DEVOLVIDO | DESCARTADO | CANCELADO`
  - Incluir algo como `SEM_MANUTENCAO` (ou flag/decisão) após o botão, **antes** de retornar/trocar.
- Na troca, registrar vínculos:
  - série ruim → movimento de transferência para descarte (`movDescarteId` ou id da transferência)
  - série boa → série/movimentação de saída ao cliente
- **Não** hardcodar siglas `PLN`/`DESC` na regra de negócio: resolver por `filialId` escolhido (seed só sugere RMA/DESC).

### Fase B — API reusando transferência

- Endpoint(s) no `/rma/...` que **orquestram** (não duplicam saldo):
  1. `POST .../itens/:id/sem-manutencao`
  2. `POST .../itens/:id/retornar` → delega à devolução atual
  3. `POST .../itens/:id/trocar` com payload:
     - `origemFilialId`, `destinoPreparacaoFilialId` (default RMA se configurado)
     - `numeroSerieBoa` (ou `unidadeSerieId`)
     - `destinoDescarteFilialId` (default DESC se existir no cadastro)
- Internamente: chamar o **mesmo** serviço de transferência/movimentação usado no Novo Lançamento / transferências (respeitar série, saldo, conferência se aplicável).
- Preferência na 1ª entrega: transferência **crédito imediato** na preparação (evitar travar troca em “aguardar recebimento”), configurável depois.

### Fase C — UI no detalhe do RMA

- No item `EM_ESTOQUE`: botão **Sem manutenção**.
- Depois: **Retornar ao cliente** | **Trocar**.
- Fluxo **Trocar**: picker de estoque origem (PLN/TBO/…), série boa disponível, destino descarte; confirmar.
- **Histórico do item:** links Entrada / Saída / Transf. descarte (e série boa) → Movimentações ou Transferências.
- Fechar processo: observação (já existe / reforçar) sem exigir descarte.

### Fase D — Configuração leve (**implementado**)

- Defaults por instalação via env (opcional):
  - `RMA_FILIAL_PREPARACAO_ID` (estoque RMA)
  - `RMA_FILIAL_DESCARTE_ID` (estoque descarte)
  - `RMA_FILIAIS_ORIGEM_TROCA_IDS` (lista UUID separada por vírgula)
- `GET /rma/defaults` — resolve env → fallback sigla `RMA`/`DESC` → estoques operacionais.
- Sem defaults obrigatórios: usuário escolhe na hora; instalação sem DESC/RMA continua possível.
- UI de troca pré-preenche origem/descarte a partir dos defaults.

### Fora / depois

- Manutenção com OS e etapas
- Envio a fornecedor
- Relatórios
- Troca com transferência “aguardar recebimento” + conferência

---

## Critérios de aceite (Fases A–C)

1. Item em RMA marcado **Sem manutenção** sem alterar saldo.
2. **Retornar** continua baixando a mesma série do RMA (comportamento atual).
3. **Trocar**:
   - série boa sai do estoque origem e chega ao destino de preparação via transferência real;
   - série boa é expedida ao cliente;
   - série ruim vai ao estoque de descarte via transferência real;
   - saldos e `UnidadeSerie.filialId` batem com o Dashboard.
4. Processo pode ser **fechado** com observação após troca, sem botão mágico de estoque.
5. Instalação sem filial `DESC`/`RMA`: não quebra; troca exige estoques escolhidos/cadastrados.

---

## Telas / API (referência)

- UI: `/rma`, `/rma/novo`, `/rma/[id]`
- API: `/rma/*`
- Permissões: `rma`, `rma_cobranca`

## Financeiro (já no MVP)

- Anexo de **laudo** técnico
- **Cobrança** Sim/Não; se Sim: valor + nº NF cobrança (`rma_cobranca`)
- **NF entrada** e **NF saída** no histórico do processo
