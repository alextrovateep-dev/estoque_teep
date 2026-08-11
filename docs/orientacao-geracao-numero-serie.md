# Sistema de Geração de Números de Série

**Status (2026-08-05):** geração no **Novo Lançamento (ENTRADA)** via `POST /series/alocar` + confirmação na movimentação.  
Config de formato no **cadastro do produto** (`ConfiguracaoSerie`).  
**Desfazer geração** via `POST /series/alocar/desfazer` (reverte contador se for o topo e ainda não houve `UnidadeSerie`).  
Lote gerado é atômico: lançar todas as séries ou desfazer (parcial rejeitado). Entrada e desfazer serializam via `FOR UPDATE` na alocação.  
Não cria `UnidadeSerie` órfã — só reserva o sequencial; o estoque sobe no lançamento.  

**Escopo fechado neste MVP:** gerar serial + dar entrada no estoque.  
**Standby:** integração/impressão Zebra no sistema — etiquetas no software/driver da impressora.  
Fora deste escopo também: import CSV, `geraNumeroSerie` em tipo.

---

## 1. Visão Geral

Sistema para geração e gerenciamento de números de série em operações de estoque, com foco em:
- **Geração automática** seguindo padrão configurável
- **Entrada em massa** com interface otimizada
- **Validações rigorosas** de unicidade e formato
- **Reimpressão** de etiquetas e relatórios

## 2. Casos de Uso

### 2.1 Geração Automática (Novos Produtos)
**Cenário:** Recebimento de produtos novos que precisam de número de série
- Produto: `TMP4426` (controla série)
- Quantidade: 10 unidades
- Sistema gera: `TMP4426250001` a `TMP4426250010`

### 2.2 Entrada Manual (Produtos Existentes)
**Cenário:** Recebimento de produtos com série pré-existente
- Notebooks, equipamentos com série do fabricante
- Usuário digita: `SN123456XYZ`, `NB789012ABC`, etc.

### 2.3 RMA (Retorno/Devolução)
**Cenário:** Produto retorna para estoque
- Usar série existente (se conhecida)
- Ou gerar nova série (se produto for substituído)

## 3. Formato dos Números de Série

### 3.1 Padrão Automático
```
[CÓDIGO_PRODUTO][ANO_2DIGITOS][SEQUENCIAL_4DIGITOS]
```
**Exemplos:**
- `TMP4426250001` = TMP4426 + 25 + 0001
- `ABC123450001` = ABC1234 + 25 + 0001
- `PROD01250001` = PROD01 + 25 + 0001

### 3.2 Configuração por Produto
No cadastro do produto, configurar:

| Campo | Tipo | Descrição | Exemplo |
|-------|------|-----------|---------|
| `controlaSerie` | Boolean | Ativa controle por série | `true` |
| `formatoSerie` | String | Padrão de geração automática | `{codigo}{ano2}{seq4}` |
| `geracaoAutomatica` | Boolean | Gerar automaticamente em entradas | `true` |
| `tamanhoSequencial` | Number | Dígitos do sequencial (padrão: 4) | `4` |
| `prefixoFixo` | String | Prefixo opcional | `"SN-"` |
| `sufixoFixo` | String | Sufixo opcional | `""` |

### 3.3 Formatos Suportados
1. **Padrão:** `{codigo}{ano2}{seq4}` → `TMP4426250001`
2. **Com separadores:** `{codigo}-{ano2}-{seq4}` → `TMP4426-25-0001`
3. **Personalizado:** Configurável no cadastro

## 4. Fluxo de Trabalho

### 4.1 Novo Lançamento (Entrada com Série)
```
1. Selecionar tipo de movimentação
   → "Entrada com Geração de Série"
   → "Entrada RMA com Série"

2. Selecionar produto
   → Sistema detecta: produto.controlaSerie = true

3. Informar quantidade
   → Ex: 10 unidades

4. Sistema apresenta opções:
   a) Gerar automaticamente (se produto.geracaoAutomatica = true)
   b) Digitar manualmente (grid com N linhas)
   c) Importar de arquivo (CSV/Excel)

5. Validações em tempo real:
   - Formato (se automático)
   - Unicidade (não existe no banco)
   - Quantidade = N linhas preenchidas

6. Confirmação e processamento
   - Cria movimentação
   - Cria N registros de UnidadeSerie
   - Atualiza contador sequencial
   - Gera evento de auditoria
```

### 4.2 Interface do Usuário

#### Modal de Geração de Séries
```
┌─────────────────────────────────────────┐
│ Gerar Números de Série - TMP4426        │
├─────────────────────────────────────────┤
│ Produto: TMP4426 - Notebook Dell        │
│ Quantidade: 10                          │
│                                         │
│ [x] Gerar automaticamente               │
│ [ ] Digitar manualmente                 │
│ [ ] Importar de arquivo                 │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Nº  | Número de Série              │ │
│ ├─────────────────────────────────────┤ │
│ │ 1   │ TMP4426250001                │ │
│ │ 2   │ TMP4426250002                │ │
│ │ 3   │ TMP4426250003                │ │
│ │ ... │ ...                          │ │
│ │ 10  │ TMP4426250010                │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [ Validar ] [ Gerar Etiquetas ] [ Salvar ] │
└─────────────────────────────────────────┘
```

#### Grid de Edição Manual
- Cada linha editável
- Auto-complete para séries existentes
- Validação visual (verde=OK, vermelho=erro)
- Botão "Gerar" por linha

## 5. Banco de Dados

### 5.1 Novas Tabelas
```prisma
model ContadorSerie {
  id        String  @id @default(uuid()) @db.Uuid
  produtoId String  @map("produto_id") @db.Uuid
  ano       Int
  sequencial Int    @default(0)
  
  @@unique([produtoId, ano])
  @@index([produtoId])
  
  produto Produto @relation(fields: [produtoId], references: [id])
}

model ConfiguracaoSerie {
  id                String  @id @default(uuid()) @db.Uuid
  produtoId         String  @unique @map("produto_id") @db.Uuid
  formato           String  @default("{codigo}{ano2}{seq4}")
  geracaoAutomatica Boolean @default(true) @map("geracao_automatica")
  tamanhoSequencial Int     @default(4) @map("tamanho_sequencial")
  prefixoFixo       String? @map("prefixo_fixo") @db.VarChar(20)
  sufixoFixo        String? @map("sufixo_fixo") @db.VarChar(20)
  reiniciarAnual    Boolean @default(true) @map("reiniciar_anual")
  
  produto Produto @relation(fields: [produtoId], references: [id])
}
```

### 5.2 Modificações Existentes
```prisma
// Em TipoMovimentacao
model TipoMovimentacao {
  geraNumeroSerie Boolean @default(false) @map("gera_numero_serie")
}

// Em Produto (já existe)
model Produto {
  controlaSerie Boolean @default(false) @map("controla_serie")
}
```

## 6. API

### 6.1 Novos Endpoints
```
POST   /api/estoque/gerar-series       # Geração em lote
GET    /api/estoque/series/contador    # Consultar contador
PUT    /api/estoque/series/contador    # Ajustar contador
GET    /api/estoque/series/etiquetas   # Gerar PDF etiquetas
POST   /api/estoque/series/validar     # Validação em lote
GET    /api/produtos/:id/config-serie  # Configuração do produto
PUT    /api/produtos/:id/config-serie  # Atualizar configuração
```

### 6.2 Payload Exemplo
```json
{
  "produtoId": "uuid",
  "quantidade": 10,
  "modo": "AUTOMATICO", // ou "MANUAL"
  "series": [
    "TMP4426250001",
    "TMP4426250002",
    // ...
  ],
  "operacaoId": "uuid-opcional",
  "observacao": "Lote de entrada 2025-01"
}
```

## 7. Validações

### 7.1 No Frontend (Tempo Real)
- Formato conforme configuração do produto
- Unicidade (consulta AJAX para banco)
- Quantidade = número de linhas preenchidas
- Caracteres permitidos (evitar injeção)

### 7.2 No Backend (Processamento)
```typescript
async function validarSeries(series: string[], produtoId: string) {
  // 1. Formato (se automático)
  // 2. Unicidade no banco
  // 3. Não duplicadas no próprio lote
  // 4. Tamanho máximo (80 chars)
  // 5. Caracteres seguros
}
```

### 7.3 Regras de Negócio
1. **Série única por produto** (não global)
2. **Ano corrente** para geração automática
3. **Sequencial incremental** (não permite "pular")
4. **Auditoria completa** (quem, quando, como)
5. **Imutabilidade** após criação (exceto por estorno)

## 8. Reimpressão e Relatórios

### 8.1 Etiquetas
- **Formato:** PDF com grid de etiquetas
- **Layout:** Configurável (tamanho, informações)
- **Conteúdo:** Código, série, produto, data
- **Opções:** Imprimir todas ou selecionadas

### 8.2 Relatórios
- **Séries geradas por período**
- **Séries em estoque/transito/saidas**
- **Controle de sequenciais**
- **Auditoria de alterações**

### 8.3 API de Etiquetas
```
GET /api/relatorios/series/etiquetas
Query params:
  - produtoId
  - series[] (array)
  - formato (A4, TERMICA, etc.)
  - layout (PADRAO, COMPACTO, DETALHADO)
```

## 9. Considerações Técnicas

### 9.1 Performance
- **Geração em lote:** Usar transaction única
- **Validação:** Cache de séries existentes
- **Contador:** Atomic increment (evitar race condition)
- **Index:** `UnidadeSerie(numeroSerie, produtoId)` único

### 9.2 Segurança
- **Validação server-side** (não confiar apenas no frontend)
- **Log de auditoria** para todas as operações
- **Permissões:** Apenas usuários autorizados
- **Rate limiting** para evitar abuso

### 9.3 Backup/Recuperação
- **ContadorSerie** incluído no backup
- **Procedimento** para recuperar sequencial
- **Verificação** de consistência pós-restore

## 10. Fluxos Especiais

### 10.1 RMA com Série Existente
```
1. Consultar série do produto (se conhecida)
2. Se encontrada: usar série existente
3. Se não encontrada: opção gerar nova
4. Registrar motivo (substituição, etc.)
```

### 10.2 Correção de Sequencial
```
Cenário: Contador "perdeu" números
Solução: Endpoint administrativo
PUT /api/admin/series/ajustar-contador
{
  "produtoId": "uuid",
  "ano": 2025,
  "novoSequencial": 100
}
```

### 10.3 Importação em Massa
- **Formato CSV:** `codigo_produto;numero_serie`
- **Validação batch** antes de importar
- **Rollback completo** em caso de erro
- **Relatório** de importação

## 11. Migração e Rollout

### 11.1 Fase 1: Cadastro e Configuração
- Adicionar campos no cadastro de produto
- Tela de configuração de formato
- Backend: modelos e migrações

### 11.2 Fase 2: Geração Básica
- Modal de geração simples
- Endpoint básico de geração
- Validações mínimas

### 11.3 Fase 3: Funcionalidades Completas
- Grid avançado de edição
- Importação/exportação
- Etiquetas e relatórios
- Auditoria completa

### 11.4 Fase 4: Otimizações
- Cache de validação
- Performance em lote grande
- Dashboard de monitoramento

## 12. Checklist de Implementação

### 12.1 Backend
- [ ] Migrações do banco de dados
- [ ] Modelos Prisma (ContadorSerie, ConfiguracaoSerie)
- [ ] Endpoints da API
- [ ] Serviço de geração/validação
- [ ] Integração com movimentações existentes
- [ ] Auditoria e logs

### 12.2 Frontend
- [ ] Componente Modal de geração
- [ ] Grid editável de séries
- [ ] Integração com Novo Lançamento
- [ ] Validações em tempo real
- [ ] Tela de configuração do produto
- [ ] Relatórios e etiquetas

### 12.3 Testes
- [ ] Testes unitários (formatação, validação)
- [ ] Testes de integração (API)
- [ ] Testes de carga (lotes grandes)
- [ ] Testes de usabilidade

## 13. Referências

### 13.1 Códigos Existentes
- `UnidadeSerie` model (controle de série)
- `Movimentacao` service (processamento)
- `Produto` cadastro (flag controlaSerie)

### 13.2 Documentação Relacionada
- [F13 — Upload de Mídia](../orientacao-upload-midia.md)
- [F15 — Lançamento Unificado](../orientacao-lancamento-unificado-f15.md)
- [RMA — Processos de Devolução](../orientacao-rma-fase2.md)

---

**Nota:** Esta documentação deve ser revisada após cada fase de implementação e antes do rollout em produção.