# Mapa de telas — Estoque TEEP

Índice das rotas do menu (`AppShell`) e docs relacionados.  
**Regra:** o código/UI é a verdade; este arquivo só orienta navegação na documentação.

Auth / 1º acesso: [senha-provisoria.md](./senha-provisoria.md) · `/login` · `/trocar-senha` · `/perfil`

---

## Visão

| Tela | Rota | Permissão | Doc |
|------|------|-----------|-----|
| Dashboard / Saldos (+ assistente) | `/dashboard` | `dashboard` · assistente: `assistente` | [assistente](./assistente-llm.md) |
| Relatórios | `/relatorios` | `relatorios` | Abaixo (§ Relatórios) |

## Operações

| Tela | Rota | Permissão | Doc |
|------|------|-----------|-----|
| Novo Lançamento | `/lancamentos/novo` | `lancamentos` | [lançamento / transf.](./lancamento.md) · [séries](./geracao-numero-serie.md) |
| Pedidos | `/pedidos` | `pedidos` | [pedidos eGestor](./pedidos-egestor.md) |
| Transferências | `/transferencias` | `transferencias` | idem (só conferência) |
| RMA | `/rma` | `rma` · financeiro: `rma_cobranca` | [RMA](./rma.md) |

## Controle

| Tela | Rota | Permissão | Doc |
|------|------|-----------|-----|
| Movimentações | `/movimentacoes` | `movimentacoes` | Histórico; filtro `?serie=` |
| Aprovações | `/aprovacoes` | `aprovacoes` | [lançamento](./lancamento.md) |
| Inventário | `/estoque/init` | `estoque_init` | Abaixo (§ Inventário) · [INSTALACAO](./INSTALACAO.md) §9 |

`/estoque/series` → redirect Dashboard/Movimentações (filtro série).  
`/transferencias/nova` → redirect Novo Lançamento.

## Cadastros

| Tela | Rota | Quem | Doc |
|------|------|------|-----|
| Produtos | `/cadastros/produtos` | `cadastros_produtos_*` | [upload](./upload-midia.md) · [série](./geracao-numero-serie.md) |
| Clientes / Fornecedores | `/cadastros/clientes` | `cadastros_clientes_*` | — (CRUD + CNPJ/CEP na API) |
| Árvore de produto | `/cadastros/arvore` | `cadastros_arvore_*` | [árvore](./arvore-produto.md) |
| Categorias | `/admin/categorias` | **Admin** | — |
| Estoques (filiais) | `/admin/filiais` | **Admin** | Locais de saldo; flag **acabados** para pedidos; seed demo: PLN/TBO/RMA/DESC |

## Administração (só Admin)

| Tela | Rota | Doc |
|------|------|-----|
| Usuários e Perfis | `/admin/usuarios` | [senha provisória](./senha-provisoria.md) · permissões em `PERMISSAO_KEYS` |
| Tipos de Movimentação | `/admin/tipos` | Código; estoque(s) fixos por natureza; flags: aprovação, retorno, termo, `baixaPorArvore`, cliente, RMA, **saída pedido eGestor**… |
| E-mails do sistema | `/admin/email` | [alertas / e-mail](./alertas-email.md) |

Sino no header: [alertas / e-mail](./alertas-email.md).

---

## Inventário (`/estoque/init`)

Define ou **reinicializa** saldos de um estoque (`POST /estoques/inicializacao`).

- Produtos com série: quantidade = N séries informadas.
- `confirmarReinit` obrigatório para sobrescrever carga existente.
- Uso típico: cutover / homologação — não é lançamento do dia a dia.

---

## Relatórios (`/relatorios`)

Abas (export PDF/XLSX via API):

| Aba | Conteúdo |
|-----|----------|
| Produtos | Catálogo filtrável |
| Estoque / saldos | Saldos por estoque + alertas min/máx |
| Árvore de produto | BOM / composição (export alinhado à árvore) |

Dashboard continua com saldos/KPIs do dia; Relatórios é a área de listagens + download.

---

## Cadastros — notas rápidas

- **Produto:** código único, preço, min/máx, `controlaSerie` + config de geração, fotos após existir id.
- **Cliente:** tipos CLIENTE / FORNECEDOR / AMBOS; lookup CNPJ/CEP na API.
- **Estoque (Filial):** sigla única; Operador exige ≥1 vínculo.
- **Tipo:** `codigo` único; `operacao` ENTRADA/SAIDA/TRANSFERENCIA; estoque(s) fixos no cadastro (lançamento só escolhe o tipo); tipos `sistema` limitados no PATCH.

Não há docs longos separados para cada CRUD — o comportamento está nas telas e em `packages/shared` / rotas `cadastros`.

---

## Ops / instalação

| Doc | Uso |
|-----|-----|
| [INSTALACAO.md](./INSTALACAO.md) | Instalar, homologar, backup, cutover |
| [backup](./recuperacao-backup.md) · [monitor](./monitoramento-basico.md) | Operação |

Backlog: [impressão Zebra](./backlog-impressao-zebra.md).
