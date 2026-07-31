═══════════════════════════════════════════════════════════
  TEEP — SISTEMA DE CONTROLE DE ESTOQUE
  Pacote de documentação e arquivos do projeto
  Versão: 2.0  |  Junho 2026
═══════════════════════════════════════════════════════════

CONTEÚDO DA PASTA:

  01_Especificacao_Tecnica_v2.0.docx
     Documento completo com todos os módulos, cadastros,
     schema Prisma, fluxos operacionais, UI/UX e roadmap
     de desenvolvimento. 13 seções, 803 parágrafos.

  02_Planilha_Controle_Estoque.xlsx
     Planilha Excel de controle transitório (2 abas:
     Movimentações + Estoque) com 55 lançamentos da
     aba Paulínia já populados. Usar até o sistema ir ao ar.

  03_Script_Banco_PostgreSQL.sql
     Script SQL base para PostgreSQL com tabelas, índices,
     trigger de saldo automático e views de relatório.
     Referência — o schema oficial está no schema.prisma
     dentro do projeto Next.js.

NOVIDADES v2.0 (em relação à v1.0):
  ★ Cadastro de Filiais como tabela própria (FK em estoques e movimentações)
  ★ Inicialização de Estoque pelo Admin antes das movimentações
  ★ Configuração de Alertas dinâmica — cadastrável sem alterar código
  ★ Campos requerCliente e requerAprovacao nos Tipos de Movimentação
  ★ Campo status e estornoDeId na tabela de Movimentações
  ★ Roadmap ampliado para 15 etapas

COR INSTITUCIONAL TEEP:
  HEX: #5B8B83  |  RGB: 91, 139, 131  |  CMYK: 71, 31, 51, 7

CONTATO TÉCNICO:
  Dúvidas sobre esta documentação, contate o responsável
  técnico do projeto antes de iniciar o desenvolvimento.
═══════════════════════════════════════════════════════════
