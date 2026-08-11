# Impressão Zebra (ZD220) — backlog

**Status:** em espera / a retomar em breve.  
**Hoje:** o Estoque TEEP **gera e controla** números de série; a impressão de etiquetas fica no software/driver da impressora (Zebra Setup Utilities etc.).

Geração de séries (já no sistema): [geracao-numero-serie.md](./geracao-numero-serie.md).

---

## Escopo pretendido (quando entrar na fila)

Integração no app para etiquetas de nº de série, com base na **Zebra ZD220** (térmica, ~203 dpi, USB principal; TCP/IP opcional) e linguagem **ZPL**.

Direção técnica já discutida (a validar na retomada):

- Impressão **local na estação** (sistema pode estar na nuvem; não há impressão remota entre estoques)
- USB via Web Serial (Chrome/Edge + HTTPS) e/ou TCP porta 9100
- Templates ZPL (produto + série + código de barras; QR opcional)
- Gatilho a partir do lote gerado no Novo Lançamento / reimpressão

---

## Fora / cuidado

- Não confundir com a geração de série (já entregue).
- Spec antiga de API/`LogImpressao`/fases de semanas era **rascunho** — na retomada, redesenhar contra o código atual (multi-SKU, `SerieAlocacao`, etc.).

---

## Referências úteis

- [Manual ZD220](https://www.zebra.com/content/dam/zebra/manuals/printers/desktop/zd220-user-guide-pt.pdf)
- [Guia ZPL](https://www.zebra.com/content/dam/zebra/manuals/printers/common/programming/zpl-zbi2-pm-en.pdf)
- [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
