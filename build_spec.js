const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak, LevelFormat,
  TableOfContents, ExternalHyperlink
} = require('docx');
const fs = require('fs');

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  dark:      "1F3864",
  blue:      "2F5496",
  lightBlue: "DEEAF1",
  green:     "E2EFDA",
  greenDark: "375623",
  red:       "FCE4D6",
  yellow:    "FFF2CC",
  gray:      "F2F2F2",
  grayDark:  "595959",
  white:     "FFFFFF",
  black:     "000000",
};

// ── Border helpers ────────────────────────────────────────────────────────────
const bdr = (color = "CCCCCC") => ({ style: BorderStyle.SINGLE, size: 1, color });
const allBorders = (color = "CCCCCC") => ({ top: bdr(color), bottom: bdr(color), left: bdr(color), right: bdr(color) });
const noBorders = () => {
  const nb = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return { top: nb, bottom: nb, left: nb, right: nb };
};

// ── Text helpers ──────────────────────────────────────────────────────────────
const run = (text, opts = {}) => new TextRun({ text, font: "Arial", size: 20, ...opts });
const bold = (text, opts = {}) => run(text, { bold: true, ...opts });
const mono = (text) => new TextRun({ text, font: "Courier New", size: 18 });

const para = (children, opts = {}) => new Paragraph({
  children: Array.isArray(children) ? children : [children],
  spacing: { before: 60, after: 60 },
  ...opts
});
const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [new TextRun({ text, font: "Arial", bold: true, size: 28, color: C.white })],
  shading: { fill: C.dark, type: ShadingType.CLEAR },
  spacing: { before: 360, after: 120 },
  indent: { left: 120, right: 120 },
});
const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  children: [new TextRun({ text, font: "Arial", bold: true, size: 24, color: C.white })],
  shading: { fill: C.blue, type: ShadingType.CLEAR },
  spacing: { before: 280, after: 100 },
  indent: { left: 80, right: 80 },
});
const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  children: [new TextRun({ text, font: "Arial", bold: true, size: 22, color: C.dark })],
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.blue, space: 1 } },
  spacing: { before: 200, after: 80 },
});
const bullet = (text, level = 0) => new Paragraph({
  numbering: { reference: "bullets", level },
  children: [run(text)],
  spacing: { before: 40, after: 40 },
});
const numbered = (text, level = 0) => new Paragraph({
  numbering: { reference: "numbers", level },
  children: [run(text)],
  spacing: { before: 40, after: 40 },
});
const spacer = (lines = 1) => new Paragraph({
  children: [run("")],
  spacing: { before: 0, after: lines * 80 },
});
const note = (text, color = C.yellow) => new Paragraph({
  children: [bold("ℹ  ", { color: C.blue }), run(text, { italics: true })],
  shading: { fill: color, type: ShadingType.CLEAR },
  spacing: { before: 80, after: 80 },
  indent: { left: 200, right: 200 },
  border: { left: { style: BorderStyle.SINGLE, size: 12, color: C.blue, space: 4 } },
});

// ── Table helpers ─────────────────────────────────────────────────────────────
const PAGE_W = 9026; // A4 with 1" margins in DXA

const hdrCell = (text, w, color = C.dark) => new TableCell({
  borders: allBorders(C.blue),
  width: { size: w, type: WidthType.DXA },
  shading: { fill: color, type: ShadingType.CLEAR },
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({
    children: [bold(text, { color: C.white, size: 18 })],
    alignment: AlignmentType.CENTER,
  })],
  verticalAlign: VerticalAlign.CENTER,
});
const dataCell = (content, w, opts = {}) => {
  const { bg = C.white, center = false, bold: isBold = false, color = C.black, shadeColor = null } = opts;
  return new TableCell({
    borders: allBorders(),
    width: { size: w, type: WidthType.DXA },
    shading: { fill: shadeColor || bg, type: ShadingType.CLEAR },
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text: content, font: "Arial", size: 18, bold: isBold, color })],
    })],
    verticalAlign: VerticalAlign.CENTER,
  });
};
const dataRow = (cells, bg = C.white) => new TableRow({ children: cells });

// ── CODE BLOCK table ─────────────────────────────────────────────────────────
const codeBlock = (lines) => new Table({
  width: { size: PAGE_W, type: WidthType.DXA },
  columnWidths: [PAGE_W],
  rows: [new TableRow({
    children: [new TableCell({
      borders: allBorders("2F5496"),
      width: { size: PAGE_W, type: WidthType.DXA },
      shading: { fill: "1E1E1E", type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 200, right: 200 },
      children: lines.map(l => new Paragraph({
        children: [new TextRun({ text: l, font: "Courier New", size: 16, color: "D4D4D4" })],
        spacing: { before: 0, after: 0 },
      })),
    })]
  })]
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT CONTENT
// ─────────────────────────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
      ]},
      { reference: "numbers", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.LOWER_LETTER, text: "%2.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
      ]},
    ]
  },
  styles: {
    default: { document: { run: { font: "Arial", size: 20, color: "2D2D2D" } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: C.white },
        paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: C.white },
        paragraph: { spacing: { before: 280, after: 100 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "Arial", color: C.dark },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1134, bottom: 1440, left: 1134 },
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [
            bold("TEEP  —  Sistema de Controle de Estoque", { color: C.blue, size: 16 }),
            run("          Especificação Técnica e Funcional", { color: C.grayDark, size: 16 }),
          ],
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.blue, space: 2 } },
          spacing: { after: 0 },
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          children: [
            run("v1.0  |  Confidencial  |  Página ", { size: 16, color: C.grayDark }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Arial", color: C.grayDark }),
            run("  de  ", { size: 16, color: C.grayDark }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, font: "Arial", color: C.grayDark }),
          ],
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.blue, space: 2 } },
          alignment: AlignmentType.RIGHT,
        })]
      })
    },
    children: [

      // ── CAPA ───────────────────────────────────────────────────────────────
      new Paragraph({
        children: [run("")],
        spacing: { before: 0, after: 2000 },
      }),
      new Paragraph({
        children: [bold("SISTEMA DE CONTROLE DE ESTOQUE", { size: 52, color: C.dark })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 200 },
      }),
      new Paragraph({
        children: [bold("TEEP", { size: 80, color: C.blue })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 400 },
      }),
      new Paragraph({
        children: [run("Especificação Técnica e Funcional", { size: 28, color: C.grayDark })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 160 },
      }),
      new Paragraph({
        children: [run("Versão 1.0  |  Junho 2026", { size: 22, color: C.grayDark, italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 800 },
      }),

      // Info box na capa
      new Table({
        width: { size: PAGE_W, type: WidthType.DXA },
        columnWidths: [2252, 6774],
        rows: [
          dataRow([dataCell("Projeto",       2252, { bg: C.dark,      center: true, bold: true, color: C.white }),
                   dataCell("Sistema Controladora de Estoque TEEP", 6774, { bg: C.lightBlue })]),
          dataRow([dataCell("Ambiente",      2252, { bg: C.dark,      center: true, bold: true, color: C.white }),
                   dataCell("Web (Dockerizado) + Mobile (Capacitor)", 6774)]),
          dataRow([dataCell("Arquitetura",   2252, { bg: C.dark,      center: true, bold: true, color: C.white }),
                   dataCell("Full-Stack TypeScript · Next.js 16 · Express · Prisma · PostgreSQL", 6774, { bg: C.lightBlue })]),
          dataRow([dataCell("Foco",          2252, { bg: C.dark,      center: true, bold: true, color: C.white }),
                   dataCell("Multiusuário · +20 usuários simultâneos · Auditável · Multifilial", 6774)]),
          dataRow([dataCell("Status",        2252, { bg: C.dark,      center: true, bold: true, color: C.white }),
                   dataCell("Especificação aprovada para desenvolvimento", 6774, { bg: C.green })]),
        ]
      }),

      new Paragraph({ children: [new PageBreak()], spacing: { before: 0, after: 0 } }),

      // ── SUMÁRIO ────────────────────────────────────────────────────────────
      new Paragraph({
        children: [bold("SUMÁRIO", { size: 28, color: C.dark })],
        alignment: AlignmentType.CENTER,
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.blue, space: 4 } },
        spacing: { before: 0, after: 200 },
      }),
      new TableOfContents("Sumário", {
        hyperlink: true,
        headingStyleRange: "1-3",
      }),
      new Paragraph({ children: [new PageBreak()], spacing: { before: 0, after: 0 } }),

      // ══════════════════════════════════════════════════════════════════════
      // 1. OBJETIVO
      // ══════════════════════════════════════════════════════════════════════
      h1("1. Objetivo do Sistema"),
      para([run("Substituir o controle de estoque atualmente realizado em planilhas por um sistema web "), bold("multiusuário"), run(", centralizado, seguro e auditável. O sistema gerenciará o cadastro de itens, o saldo atual por filial (Paulínia, Timbó e demais) e registrará todo o histórico de entradas e saídas de forma "), bold("imutável"), run(" ao longo da linha do tempo.")]),
      spacer(),
      note("Este documento consolida o escopo técnico completo. Com ele, o desenvolvedor conseguirá rodar as migrations do Prisma, estruturar as rotas no Express e construir os componentes no Next.js de forma totalmente alinhada às necessidades operacionais."),

      // ══════════════════════════════════════════════════════════════════════
      // 2. REQUISITOS E REGRAS DE NEGÓCIO
      // ══════════════════════════════════════════════════════════════════════
      h1("2. Requisitos e Regras de Negócio"),

      // 2.1 Segurança
      h2("2.1  Módulo de Segurança e Acesso"),
      h3("Perfis de Usuário"),
      para([run("O sistema contará com três perfis fixos de acesso:")]),
      spacer(),
      new Table({
        width: { size: PAGE_W, type: WidthType.DXA },
        columnWidths: [1800, 2000, 5226],
        rows: [
          dataRow([hdrCell("Perfil", 1800), hdrCell("Nível", 2000), hdrCell("Permissões", 5226)]),
          dataRow([dataCell("ADMIN",     1800, { bg: C.red,   bold: true, center: true }),
                   dataCell("Máximo",   2000, { center: true }),
                   dataCell("Acesso total: configurações, exclusões lógicas, relatórios consolidados e gestão de usuários.", 5226)]),
          dataRow([dataCell("GERENTE",   1800, { bg: C.yellow, bold: true, center: true }),
                   dataCell("Avançado", 2000, { center: true }),
                   dataCell("Aprova inventários, edita cadastros e visualiza relatórios de todas as filiais.", 5226, { bg: C.gray })]),
          dataRow([dataCell("OPERADOR",  1800, { bg: C.green,  bold: true, center: true }),
                   dataCell("Restrito", 2000, { center: true }),
                   dataCell("Lançamento de movimentações e consulta de saldo apenas na filial à qual está alocado.", 5226)]),
        ]
      }),
      spacer(),
      h3("Exclusão Lógica"),
      para([run("Nenhum usuário, produto, cliente ou categoria será deletado fisicamente do banco. Será utilizado o campo "), mono("ativo: false"), run(" para desativação, preservando integridade total do histórico fiscal e de auditoria.")]),

      // 2.2 Movimentações
      h2("2.2  Módulo de Movimentações (Linha do Tempo)"),

      h3("Imutabilidade dos Registros"),
      para([run("Registros na tabela de movimentações "), bold("nunca são editados ou deletados"), run(". Erros de lançamento devem ser corrigidos por meio de um lançamento de "), bold("estorno"), run(", garantindo rastreabilidade total.")]),

      h3("Campo E/S Automatizado"),
      para([run("O operador seleciona apenas o "), bold("Tipo de Movimentação"), run(" (ex: Compra, Montagem, Venda). O sistema identifica automaticamente se o tipo é "), bold("ENTRADA"), run(" ou "), bold("SAÍDA"), run(" e processa o cálculo por meio de uma única coluna de quantidade.")]),
      spacer(),
      new Table({
        width: { size: PAGE_W, type: WidthType.DXA },
        columnWidths: [2263, 1500, 5263],
        rows: [
          dataRow([hdrCell("Tipo de Movimentação", 2263), hdrCell("Operação", 1500), hdrCell("Descrição", 5263)]),
          dataRow([dataCell("Compra",                      2263), dataCell("ENTRADA", 1500, { bg: C.green, bold: true, center: true }), dataCell("Recebimento de fornecedor", 5263, { bg: C.gray })]),
          dataRow([dataCell("Inventário / Saldo Inicial",  2263), dataCell("ENTRADA", 1500, { bg: C.green, bold: true, center: true }), dataCell("Contagem física ou abertura de saldo", 5263)]),
          dataRow([dataCell("Devolução de Cliente",        2263), dataCell("ENTRADA", 1500, { bg: C.green, bold: true, center: true }), dataCell("Item retornado por cliente", 5263, { bg: C.gray })]),
          dataRow([dataCell("Transferência Recebida",      2263), dataCell("ENTRADA", 1500, { bg: C.green, bold: true, center: true }), dataCell("Recebimento confirmado de outra filial", 5263)]),
          dataRow([dataCell("Ajuste Positivo",             2263), dataCell("ENTRADA", 1500, { bg: C.green, bold: true, center: true }), dataCell("Correção de saldo para mais", 5263, { bg: C.gray })]),
          dataRow([dataCell("Venda / Entrega",             2263), dataCell("SAÍDA",   1500, { bg: C.red,   bold: true, center: true }), dataCell("Saída para cliente externo", 5263)]),
          dataRow([dataCell("Montagem / Produção",         2263), dataCell("SAÍDA",   1500, { bg: C.red,   bold: true, center: true }), dataCell("Consumo em montagem de produto", 5263, { bg: C.gray })]),
          dataRow([dataCell("Transferência Enviada",       2263), dataCell("SAÍDA",   1500, { bg: C.red,   bold: true, center: true }), dataCell("Envio para outra filial (gera status Em Trânsito)", 5263)]),
          dataRow([dataCell("Perda / Avaria",              2263), dataCell("SAÍDA",   1500, { bg: C.red,   bold: true, center: true }), dataCell("Item danificado ou perdido", 5263, { bg: C.gray })]),
          dataRow([dataCell("Ajuste Negativo",             2263), dataCell("SAÍDA",   1500, { bg: C.red,   bold: true, center: true }), dataCell("Correção de saldo para menos", 5263)]),
        ]
      }),
      spacer(),

      h3("Preço do Momento"),
      para([run("A tabela de movimentações armazena o preço unitário praticado no "), bold("momento exato"), run(" da ação. Se o preço mestre no cadastro do produto for alterado futuramente, o histórico do passado permanece intacto e correto para fins contábeis e fiscais.")]),

      // 2.3 Saldo e Filiais
      h2("2.3  Controle de Saldo e Filiais"),

      h3("Saldo por Filial"),
      para([run("O saldo de cada produto é controlado individualmente por filial (Paulínia, Timbó, etc.). A visão consolidada estará disponível apenas para perfis ADMIN e GERENTE.")]),

      h3("Fluxo de Transferência — Status Em Trânsito"),
      para([run("Mercadorias transferidas entre filiais seguem o fluxo abaixo:")]),
      numbered("Operador da origem lança uma "), 
      ...[
        "Saída por Transferência → o saldo da filial de origem é debitado imediatamente.",
        "A carga fica com status EM TRÂNSITO — não soma no destino ainda.",
        "Operador da filial destino realiza a conferência física da carga.",
        "Ao confirmar o recebimento, é gerada a Entrada por Transferência → o saldo do destino é creditado.",
        "Divergências (sobras ou faltas) geram campo obrigatório de justificativa e alerta automático para o Gerente.",
      ].map(t => numbered(t)),

      spacer(),
      h3("Estoque Mínimo e Alertas"),
      para([run("O sistema emitirá alertas automáticos quando o saldo de um item atingir o limite crítico configurado no cadastro do produto. Os alertas são exibidos em tela (toast) e podem ser enviados por e-mail para o setor de compras.")]),

      // ══════════════════════════════════════════════════════════════════════
      // 3. DICIONÁRIO DE DADOS
      // ══════════════════════════════════════════════════════════════════════
      h1("3. Dicionário de Dados e Schema (Prisma)"),

      h2("3.1  Tabelas Principais"),
      spacer(),

      // tabela de entidades
      new Table({
        width: { size: PAGE_W, type: WidthType.DXA },
        columnWidths: [2000, 3000, 4026],
        rows: [
          dataRow([hdrCell("Entidade / Tabela", 2000), hdrCell("Finalidade", 3000), hdrCell("Campos-chave", 4026)]),
          dataRow([dataCell("usuarios",          2000, { bold: true }), dataCell("Quem opera o sistema",                           3000, { bg: C.gray }), dataCell("id, nome, email, senhaHash, perfil, ativo",                  4026, { bg: C.gray })]),
          dataRow([dataCell("categorias",        2000, { bold: true }), dataCell("Organização dos produtos",                       3000),                dataCell("id, nome, descricao, ativo",                               4026)]),
          dataRow([dataCell("produtos",          2000, { bold: true }), dataCell("Catálogo mestre de itens",                       3000, { bg: C.gray }), dataCell("id, codigo, descricao, categoriaId, precoUnitario, estoqueMinimo", 4026, { bg: C.gray })]),
          dataRow([dataCell("clientes",          2000, { bold: true }), dataCell("Clientes, fornecedores e filiais externas",      3000),                dataCell("id, nome, documento, tipo (CLIENTE / FORNECEDOR / INTERNO)", 4026)]),
          dataRow([dataCell("estoques",          2000, { bold: true }), dataCell("Saldo atual por produto × filial",               3000, { bg: C.gray }), dataCell("id, produtoId, filial, saldoAtual — atualizado por trigger", 4026, { bg: C.gray })]),
          dataRow([dataCell("tipos_movimentacao",2000, { bold: true }), dataCell("Mestre de tipos de operação",                   3000),                dataCell("id, nome, operacao (ENTRADA | SAÍDA)",                     4026)]),
          dataRow([dataCell("movimentacoes",     2000, { bold: true }), dataCell("Histórico imutável — linha do tempo",            3000, { bg: C.gray }), dataCell("id, produtoId, tipoId, usuarioId, clienteId, filial, quantidade, precoUnitario", 4026, { bg: C.gray })]),
        ]
      }),

      spacer(),
      h2("3.2  Schema Prisma"),
      codeBlock([
        'datasource db {',
        '  provider = "postgresql"',
        '  url      = env("DATABASE_URL")',
        '}',
        '',
        'generator client {',
        '  provider = "prisma-client-js"',
        '}',
        '',
        '// USUÁRIOS',
        'model Usuario {',
        '  id            String         @id @default(uuid()) @db.Uuid',
        '  nome          String         @db.VarChar(100)',
        '  email         String         @unique @db.VarChar(100)',
        '  senhaHash     String         @map("senha_hash") @db.VarChar(255)',
        '  perfil        String         @db.VarChar(30)  // ADMIN | GERENTE | OPERADOR',
        '  ativo         Boolean        @default(true)',
        '  criadoEm      DateTime       @default(now()) @map("criado_em") @db.Timestamptz',
        '  movimentacoes Movimentacao[]',
        '  @@map("usuarios")',
        '}',
        '',
        '// PRODUTOS',
        'model Produto {',
        '  id            String         @id @default(uuid()) @db.Uuid',
        '  codigo        String         @unique @db.VarChar(50)',
        '  descricao     String         @db.VarChar(150)',
        '  categoriaId   String         @map("categoria_id") @db.Uuid',
        '  precoUnitario Decimal        @default(0.00) @map("preco_unitario") @db.Decimal(10,2)',
        '  estoqueMinimo Int            @default(0) @map("estoque_minimo")',
        '  ativo         Boolean        @default(true)',
        '  categoria     Categoria      @relation(fields: [categoriaId], references: [id])',
        '  estoques      Estoque[]',
        '  movimentacoes Movimentacao[]',
        '  @@map("produtos")',
        '}',
        '',
        '// MOVIMENTAÇÕES (histórico imutável)',
        'model Movimentacao {',
        '  id            String           @id @default(uuid()) @db.Uuid',
        '  produtoId     String           @map("produto_id") @db.Uuid',
        '  tipoId        String           @map("tipo_id") @db.Uuid',
        '  usuarioId     String           @map("usuario_id") @db.Uuid',
        '  clienteId     String?          @map("cliente_id") @db.Uuid',
        '  filial        String           @db.VarChar(50)',
        '  quantidade    Decimal          @db.Decimal(12,4)',
        '  precoUnitario Decimal          @map("preco_unitario") @db.Decimal(10,2)',
        '  observacao    String?          @db.Text',
        '  dataMovimento DateTime         @default(now()) @map("data_movimento") @db.Timestamptz',
        '  produto       Produto          @relation(...)',
        '  tipo          TipoMovimentacao @relation(...)',
        '  usuario       Usuario          @relation(...)',
        '  cliente       Cliente?         @relation(...)',
        '  @@index([produtoId])',
        '  @@index([dataMovimento])',
        '  @@index([filial])',
        '  @@map("movimentacoes")',
        '}',
      ]),

      // ══════════════════════════════════════════════════════════════════════
      // 4. ARQUITETURA TECNOLÓGICA
      // ══════════════════════════════════════════════════════════════════════
      h1("4. Arquitetura Tecnológica (Tech Stack)"),

      spacer(),
      new Table({
        width: { size: PAGE_W, type: WidthType.DXA },
        columnWidths: [1800, 2500, 4726],
        rows: [
          dataRow([hdrCell("Camada", 1800), hdrCell("Tecnologia", 2500), hdrCell("Observações", 4726)]),
          dataRow([dataCell("Frontend",      1800, { bold: true }), dataCell("Next.js 16 + React + Tailwind CSS + TypeScript", 2500, { bg: C.gray }), dataCell("SSR/SSG + componentes reativos com SWR ou React Query", 4726, { bg: C.gray })]),
          dataRow([dataCell("Backend",       1800, { bold: true }), dataCell("Node.js + Express + TypeScript",                 2500),                dataCell("API REST com validação de regras de negócio e autenticação JWT", 4726)]),
          dataRow([dataCell("ORM",           1800, { bold: true }), dataCell("Prisma Client",                                  2500, { bg: C.gray }), dataCell("Migrations versionadas, type-safe, integração nativa com PostgreSQL", 4726, { bg: C.gray })]),
          dataRow([dataCell("Banco",         1800, { bold: true }), dataCell("PostgreSQL",                                     2500),                dataCell("Trigger para atualização automática de saldo + views de consulta", 4726)]),
          dataRow([dataCell("Infra",         1800, { bold: true }), dataCell("Docker + docker-compose",                        2500, { bg: C.gray }), dataCell("Contêineres isolados para App e Banco. Deploy em Railway, Render ou VPS própria", 4726, { bg: C.gray })]),
          dataRow([dataCell("Mobile (futuro)",1800,{ bold: true }), dataCell("Capacitor (Android/Java)",                       2500),                dataCell("Código web empacotado para app nativo — reutiliza toda a base Next.js", 4726)]),
          dataRow([dataCell("Notificações",  1800, { bold: true }), dataCell("Socket.io + FCM",                                2500, { bg: C.gray }), dataCell("WebSocket para alertas em tela + Firebase Cloud Messaging para push mobile", 4726, { bg: C.gray })]),
          dataRow([dataCell("E-mail",        1800, { bold: true }), dataCell("Nodemailer + Resend / Amazon SES",               2500),                dataCell("Templates modernos com React Email. Mailtrap para testes locais", 4726)]),
        ]
      }),

      // ══════════════════════════════════════════════════════════════════════
      // 5. FLUXO OPERACIONAL
      // ══════════════════════════════════════════════════════════════════════
      h1("5. Fluxo Operacional — Lançamento de Movimentação"),

      para([run("O diagrama abaixo descreve a jornada lógica do dado desde o momento em que o operador salva um novo lançamento até a atualização automática do saldo.")]),
      spacer(),

      new Table({
        width: { size: PAGE_W, type: WidthType.DXA },
        columnWidths: [600, 3213, 3213, 2000],
        rows: [
          dataRow([hdrCell("#", 600), hdrCell("Ator / Sistema", 3213), hdrCell("Ação", 3213), hdrCell("Resultado", 2000)]),
          dataRow([dataCell("1", 600, { center: true, bold: true }), dataCell("Operador (Tela Next.js)",   3213),                dataCell("POST /api/movimentacoes { produtoId, quantidade, tipoId, filial }",          3213, { bg: C.gray }), dataCell("Requisição enviada",          2000, { bg: C.gray })]),
          dataRow([dataCell("2", 600, { center: true, bold: true }), dataCell("Backend (Express)",          3213, { bg: C.gray }),dataCell("Validação de regras de negócio via TypeScript",                              3213),                dataCell("Dados validados",              2000)]),
          dataRow([dataCell("3", 600, { center: true, bold: true }), dataCell("Backend → Banco (Estoque)", 3213),                dataCell("Se SAÍDA: verifica se o saldo da filial comporta a quantidade solicitada",   3213, { bg: C.gray }), dataCell("Saldo verificado",             2000, { bg: C.gray })]),
          dataRow([dataCell("3a",600, { center: true, bold: true }), dataCell("Banco → Operador",          3213, { bg: C.red }), dataCell("Saldo insuficiente → retorna erro: Quantidade indisponível no estoque local", 3213, { bg: C.red }), dataCell("Bloqueado",                    2000, { bg: C.red })]),
          dataRow([dataCell("4", 600, { center: true, bold: true }), dataCell("Backend → Banco (Movim.)", 3213),                dataCell("prisma.movimentacao.create() — grava com ID do usuário e preço atual",        3213, { bg: C.gray }), dataCell("Histórico gravado",            2000, { bg: C.gray })]),
          dataRow([dataCell("5", 600, { center: true, bold: true }), dataCell("Backend → Banco (Estoque)",3213, { bg: C.gray }),dataCell("Incrementa ou decrementa o saldo na tabela estoques por filial",               3213),                dataCell("Saldo atualizado",             2000)]),
          dataRow([dataCell("6", 600, { center: true, bold: true }), dataCell("Backend → Operador",        3213),                dataCell("Se novo saldo ≤ estoque mínimo: retorna alerta visual toast em tela",          3213, { bg: C.yellow}),dataCell("Alerta disparado",             2000, { bg: C.yellow})]),
          dataRow([dataCell("7", 600, { center: true, bold: true }), dataCell("Backend → Operador",        3213, { bg: C.green}),dataCell("Sucesso: Lançamento efetuado com sucesso",                                     3213, { bg: C.green }),dataCell("Operação concluída",           2000, { bg: C.green })]),
        ]
      }),

      // ══════════════════════════════════════════════════════════════════════
      // 6. ESTRUTURA DE MENUS E NAVEGAÇÃO
      // ══════════════════════════════════════════════════════════════════════
      h1("6. Estrutura de Menus e Navegação"),

      para([run("O sistema utilizará um "), bold("Menu Lateral Retrátil (Sidebar)"), run(" como padrão de navegação. O menu se adapta ao perfil do usuário logado, exibindo apenas as opções às quais ele tem acesso.")]),
      spacer(),

      new Table({
        width: { size: PAGE_W, type: WidthType.DXA },
        columnWidths: [1800, 3000, 2226, 2000],
        rows: [
          dataRow([hdrCell("Seção", 1800), hdrCell("Página / Módulo", 3000), hdrCell("Descrição", 2226), hdrCell("Acesso", 2000)]),
          dataRow([dataCell("Painel Geral",        1800, { bold: true }), dataCell("Dashboard",                   3000, { bg: C.gray }), dataCell("KPIs, gráficos, alertas urgentes",          2226, { bg: C.gray }), dataCell("Todos",              2000, { bg: C.gray })]),
          dataRow([dataCell("Operações Diárias",   1800, { bold: true }), dataCell("Linha do Tempo",              3000),                dataCell("Feed de movimentações em tempo real",       2226),                dataCell("Todos",              2000)]),
          dataRow([dataCell("",                    1800),                  dataCell("Novo Lançamento",             3000, { bg: C.gray }), dataCell("Tela rápida otimizada p/ leitor de código", 2226, { bg: C.gray }), dataCell("Todos",              2000, { bg: C.gray })]),
          dataRow([dataCell("",                    1800),                  dataCell("Saldos por Filial",           3000),                dataCell("Consulta rápida de posição de estoque",     2226),                dataCell("Todos",              2000)]),
          dataRow([dataCell("Controles Avançados", 1800, { bold: true }), dataCell("Inventário / Ajuste",         3000, { bg: C.gray }), dataCell("Contagem mensal e balanço de estoque",      2226, { bg: C.gray }), dataCell("Admin / Gerente",    2000, { bg: C.gray })]),
          dataRow([dataCell("",                    1800),                  dataCell("Transferências",              3000),                dataCell("Painel para envio e recebimento entre filiais (Em Trânsito)", 2226), dataCell("Todos",         2000)]),
          dataRow([dataCell("Cadastros",           1800, { bold: true }), dataCell("Produtos (Catálogo)",         3000, { bg: C.gray }), dataCell("Cadastro e edição de itens",               2226, { bg: C.gray }), dataCell("Admin / Gerente",    2000, { bg: C.gray })]),
          dataRow([dataCell("",                    1800),                  dataCell("Categorias",                  3000),                dataCell("Gerenciamento de categorias",               2226),                dataCell("Admin / Gerente",    2000)]),
          dataRow([dataCell("",                    1800),                  dataCell("Clientes & Fornecedores",     3000, { bg: C.gray }), dataCell("Cadastro de parceiros externos",            2226, { bg: C.gray }), dataCell("Admin / Gerente",    2000, { bg: C.gray })]),
          dataRow([dataCell("",                    1800),                  dataCell("Usuários",                    3000),                dataCell("Gestão de acessos e perfis",               2226),                dataCell("Admin apenas",       2000, { bg: C.red })]),
        ]
      }),

      // ══════════════════════════════════════════════════════════════════════
      // 7. UI/UX
      // ══════════════════════════════════════════════════════════════════════
      h1("7. Diretrizes de Interface (UI/UX)"),

      h2("7.1  Tela de Novo Lançamento"),
      para([run("Esta é a tela mais crítica para a operação. O objetivo é "), bold("zero cliques de mouse"), run(" — o operador deve conseguir bipar, digitar e salvar usando apenas teclado ou leitor de código de barras.")]),
      spacer(),
      bullet("Foco automático: ao abrir a tela, cursor pisca direto no campo Código do Produto"),
      bullet("Bip de código de barras: sistema identifica o código, busca o produto em background, preenche nome e preço e pula o cursor para Quantidade"),
      bullet("Tecla Enter: salva e limpa os campos, retornando o cursor ao campo Código para o próximo bipe"),
      bullet("Chave seletora E/S: botão grande tipo Segmented Control no topo — ENTRADA (verde) ou SAÍDA (vermelho) com cor de borda da tela para sinalização visual forte"),
      bullet("Busca preditiva (Combobox): filtra por código (ex: MP-AD) ou parte da descrição à medida que o usuário digita"),
      spacer(),

      h2("7.2  Linha do Tempo (Movimentações)"),
      bullet("Badges coloridos: ENTRADA em verde suave, SAÍDA em vermelho suave em cada linha"),
      bullet("Filtros de um clique: chips rápidos no topo — Hoje, Paulínia, Timbó, Apenas Saídas, Itens Críticos"),
      bullet("Gaveta de detalhes (Drawer): clicar em uma linha abre um painel lateral com todos os detalhes — operador, horário, observações, NF"),
      bullet("Paginação: 20 / 50 / 100 linhas por página com somatório dinâmico no rodapé conforme filtros aplicados"),
      spacer(),

      h2("7.3  Dashboard"),
      bullet("Card vermelho piscante: número de produtos abaixo do estoque mínimo — clique leva para lista filtrada"),
      bullet("Gráfico de linha dupla: Entradas vs. Saídas ao longo dos dias do mês"),
      bullet("Gráfico donut: divisão financeira de capital por filial"),
      bullet("Mini-tabela: últimos 5 lançamentos com operador, hora e filial"),
      spacer(),

      h2("7.4  Módulo de Transferências"),
      para([run("Página dividida em duas abas:")]),
      spacer(),
      h3("Aba Enviar Carga (Origem)"),
      bullet("Campos: Filial de Destino, Grade de itens (código + quantidade), Documento de transporte / transportadora"),
      bullet("Validação em tempo real: bloqueia o botão e pinta a linha em vermelho se saldo insuficiente"),
      bullet("Ao despachar: gera Saída por Transferência e altera status para EM TRÂNSITO"),
      spacer(),
      h3("Aba A Caminho / Receber (Destino)"),
      bullet("Contador de cargas em trânsito com badge numérico no menu"),
      bullet("Cards por carga: Origem, Motorista, Guia, número de itens"),
      bullet("Tela de conferência dividida: lado esquerdo (o que foi enviado) × lado direito (o que chegou fisicamente)"),
      bullet("Confirmação total: gera Entrada por Transferência e credita saldo no destino"),
      bullet("Divergência: campo obrigatório de justificativa + alerta automático para o Gerente"),

      // ══════════════════════════════════════════════════════════════════════
      // 8. SISTEMA DE ALERTAS E EVENTOS
      // ══════════════════════════════════════════════════════════════════════
      h1("8. Sistema de Alertas e Eventos"),

      h2("8.1  Matriz de Disparos"),
      spacer(),
      new Table({
        width: { size: PAGE_W, type: WidthType.DXA },
        columnWidths: [2200, 2000, 2500, 1326, 1000],
        rows: [
          dataRow([hdrCell("Evento", 2200), hdrCell("Gatilho", 2000), hdrCell("Destinatários", 2500), hdrCell("Canal", 1326), hdrCell("Perfil", 1000)]),
          dataRow([dataCell("Estoque abaixo do mínimo",  2200, { bold: true }), dataCell("SAÍDA reduz saldo ≤ estoqueMinimo",    2000, { bg: C.gray }), dataCell("Compras, Almoxarife, Gerentes da filial",  2500, { bg: C.gray }), dataCell("E-mail + Toast", 1326, { bg: C.gray }), dataCell("Gerente",  1000, { bg: C.gray })]),
          dataRow([dataCell("Pedido separado / pronto",  2200, { bold: true }), dataCell("Status muda para SEPARADO",            2000),                dataCell("Cliente externo + Filial destino (interno)",  2500),            dataCell("E-mail + Push",  1326),                dataCell("Operador", 1000)]),
          dataRow([dataCell("Pedido despachado",         2200, { bold: true }), dataCell("Confirmação do despacho pelo operador",2000, { bg: C.gray }), dataCell("Cliente destinatário + Gerente de logística",  2500, { bg: C.gray }), dataCell("E-mail",     1326, { bg: C.gray }), dataCell("Gerente",  1000, { bg: C.gray })]),
          dataRow([dataCell("Divergência em recebimento",2200, { bold: true }), dataCell("Qtd recebida ≠ Qtd enviada",          2000),                dataCell("Gerente da filial destino",                   2500),            dataCell("Toast + E-mail", 1326),                dataCell("Gerente",  1000)]),
        ]
      }),
      spacer(),

      h2("8.2  Implementação Técnica"),
      h3("WebSockets (Socket.io) — Web"),
      para([run("Enquanto o operador estiver com a aba aberta no navegador, a API Express mantém canal aberto via WebSocket. Um alerta crítico em Paulínia surge imediatamente como toast no canto da tela de "), bold("todos os gerentes logados"), run(", sem necessidade de recarregar a página.")]),

      h3("Firebase Cloud Messaging (FCM) — Mobile"),
      para([run("Para alertas chegarem no celular do operador mesmo com o aplicativo fechado, utiliza-se o plugin oficial do Capacitor para Firebase. O Express sinaliza o FCM, que empurra a notificação nativa para o Android.")]),

      // ══════════════════════════════════════════════════════════════════════
      // 9. BIBLIOTECAS RECOMENDADAS
      // ══════════════════════════════════════════════════════════════════════
      h1("9. Bibliotecas Recomendadas (Next.js / Node.js)"),
      spacer(),
      new Table({
        width: { size: PAGE_W, type: WidthType.DXA },
        columnWidths: [2000, 2500, 4526],
        rows: [
          dataRow([hdrCell("Área", 2000), hdrCell("Biblioteca", 2500), hdrCell("Uso", 4526)]),
          dataRow([dataCell("Componentes UI",  2000, { bold: true }), dataCell("Shadcn/ui + Radix UI",      2500, { bg: C.gray }), dataCell("Combobox, Dialog, Toast, DataTable — baseados em Tailwind + TypeScript", 4526, { bg: C.gray })]),
          dataRow([dataCell("Tabelas",         2000, { bold: true }), dataCell("TanStack Table",             2500),                dataCell("Paginação, filtros por coluna e ordenação prontos", 4526)]),
          dataRow([dataCell("Gráficos",        2000, { bold: true }), dataCell("Recharts ou Chart.js",       2500, { bg: C.gray }), dataCell("Gráficos responsivos compatíveis com Tailwind", 4526, { bg: C.gray })]),
          dataRow([dataCell("Fetch de dados",  2000, { bold: true }), dataCell("SWR ou React Query",         2500),                dataCell("Atualização em tempo real sem recarregar página", 4526)]),
          dataRow([dataCell("E-mails",         2000, { bold: true }), dataCell("Nodemailer + React Email",   2500, { bg: C.gray }), dataCell("Templates modernos com componentes React. Mailtrap para testes", 4526, { bg: C.gray })]),
          dataRow([dataCell("Envio de e-mail", 2000, { bold: true }), dataCell("Resend ou Amazon SES",       2500),                dataCell("Produção — garante entrega sem cair em spam", 4526)]),
          dataRow([dataCell("Tempo real",      2000, { bold: true }), dataCell("Socket.io",                  2500, { bg: C.gray }), dataCell("WebSockets para notificações instantâneas em tela", 4526, { bg: C.gray })]),
          dataRow([dataCell("Push Mobile",     2000, { bold: true }), dataCell("Capacitor + FCM",            2500),                dataCell("Notificações nativas Android mesmo com app fechado", 4526)]),
          dataRow([dataCell("Autenticação",    2000, { bold: true }), dataCell("JWT + bcrypt",               2500, { bg: C.gray }), dataCell("Tokens de sessão + hash seguro de senhas", 4526, { bg: C.gray })]),
        ]
      }),

      // ══════════════════════════════════════════════════════════════════════
      // 10. PRÓXIMOS PASSOS
      // ══════════════════════════════════════════════════════════════════════
      h1("10. Próximos Passos para o Desenvolvedor"),
      spacer(),
      numbered("Configurar ambiente Docker (docker-compose com serviços: app, db)"),
      numbered("Criar projeto Next.js 16 + Express em monorepo TypeScript"),
      numbered("Configurar Prisma: datasource, models e rodar primeira migration"),
      numbered("Implementar autenticação JWT com perfis ADMIN / GERENTE / OPERADOR"),
      numbered("Desenvolver API REST: endpoints de produtos, categorias, clientes e movimentações"),
      numbered("Implementar trigger PostgreSQL de atualização automática de saldo"),
      numbered("Construir telas: Dashboard → Novo Lançamento → Linha do Tempo → Saldos"),
      numbered("Implementar Shadcn/ui com Combobox para busca de produto e TanStack Table"),
      numbered("Adicionar Socket.io para alertas em tempo real"),
      numbered("Configurar Nodemailer + Resend para disparos de e-mail"),
      numbered("Empacotar com Capacitor para Android e testar push notifications via FCM"),
      spacer(),
      note("A estrutura de dados definida neste documento foi projetada para ser diretamente compatível com uma futura importação dos dados da planilha Excel atual, minimizando retrabalho na migração."),

    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("/home/claude/TEEP_Especificacao_Tecnica.docx", buf);
  console.log("OK");
});
