# Árvore de produto e baixa pela árvore

**Status:** SAÍDA / TRANSFERÊNCIA + página dedicada (revisado 2026-08-10).

## Ideia

A árvore define quais componentes formam um produto.  
A **baixa pela árvore** acontece quando esse produto **sai** de um estoque — nunca na entrada.

## Cadastro (UI)

- **Cadastros → Árvore de produto** (`/cadastros/arvore`) — só **Admin** e **Gerente**.
- Funções: listar árvores, criar/editar BOM (pai + componentes + qtd + Fantasma), simular produção.
- A simulação usa a árvore **já salva** (salve o rascunho antes de calcular).
- BOM é de **1 nível** (sem explosão recursiva).

## Regras de baixa

1. Flag `baixaPorArvore` só em tipos **Saída** ou **Transferência**.
2. Componentes **não fantasma** saem do estoque de origem (`qtd × árvore`).
3. **Fantasma** = só estrutura; não movimenta saldo.
4. Árvore precisa de ao menos **um** componente não-fantasma para lançar saída/transferência com árvore.
5. MVP: componentes que baixam estoque **sem** controle de série (validado no cadastro da BOM).
6. Tipo com árvore **não** exige aprovação.

### Saída com árvore

- Documento: saída do produto pai.
- Estoque: baixa só os componentes; **não** debita o pai.

### Transferência com árvore

| Estoque | Efeito |
|---------|--------|
| Origem | Baixa os componentes |
| Destino | Entra o produto pai (item único) |

## Simulação de produção

Informa quantidade do pai + estoque e retorna, por componente:

- necessário · disponível (saldo − reserva de transferência) · falta  
- preço · valor necessário · valor a comprar  

## API

- `GET /produtos/arvores`
- `GET /produtos/:id/componentes` (leitura; também usada no lançamento)
- `PUT /produtos/:id/componentes` (Admin/Gerente)
- `GET /produtos/:id/arvore/simulacao?quantidade=&filialId=`

Tipo sistema: **Baixa de componente (árvore)**.
