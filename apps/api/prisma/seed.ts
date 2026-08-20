import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ensureSystemTipos } from "../src/lib/ensureSystemTipos";

const prisma = new PrismaClient();

const DEMO_USER_EMAILS = [
  "gerente@teep.com.br",
  "operador@teep.com.br",
  "operador.tbo@teep.com.br",
];

/**
 * Instalação limpa (SEED_DEMO≠1):
 * - só admin + tipos internos (sistema)
 * - remove herança de cadastros de negócio sem uso (Compra/Venda/categorias/demo users)
 *
 * Homologação: SEED_DEMO=1 cria estoques, ops, categorias, produtos demo.
 */
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@teep.com.br";
  const password = process.env.SEED_ADMIN_PASSWORD || "Admin@123";
  const seedDemo = process.env.SEED_DEMO === "1";

  const senhaHash = await bcrypt.hash(password, 12);

  const admin = await prisma.usuario.upsert({
    where: { email },
    update: {
      senhaHash,
      ativo: true,
      perfil: "ADMIN",
      perfilCompleto: true,
      ...(!seedDemo ? { filialId: null } : {}),
    },
    create: {
      nome: "Administrador TEEP",
      email,
      senhaHash,
      perfil: "ADMIN",
      perfilCompleto: true,
    },
  });
  if (!seedDemo) {
    await prisma.usuarioFilial.deleteMany({ where: { usuarioId: admin.id } });
  }

  /** Tipos internos (não são cadastro de negócio). */
  const nSistema = await ensureSystemTipos();

  let filiaisSeed: string[] = [];

  if (seedDemo) {
    const paulinia = await prisma.filial.upsert({
      where: { sigla: "PLN" },
      update: { estoqueAcabados: true },
      create: {
        nome: "Paulínia",
        sigla: "PLN",
        cidade: "Paulínia",
        estado: "SP",
        estoqueAcabados: true,
      },
    });

    const timbo = await prisma.filial.upsert({
      where: { sigla: "TBO" },
      update: { estoqueAcabados: true },
      create: {
        nome: "Timbó",
        sigla: "TBO",
        cidade: "Timbó",
        estado: "SC",
        estoqueAcabados: true,
      },
    });

    const estoqueRma = await prisma.filial.upsert({
      where: { sigla: "RMA" },
      update: { nome: "Estoque RMA", ativo: true },
      create: {
        nome: "Estoque RMA",
        sigla: "RMA",
        cidade: "Paulínia",
        estado: "SP",
      },
    });

    await prisma.filial.upsert({
      where: { sigla: "DESC" },
      update: { nome: "Estoque Descarte", ativo: true },
      create: {
        nome: "Estoque Descarte",
        sigla: "DESC",
        cidade: "Paulínia",
        estado: "SP",
      },
    });

    filiaisSeed = ["PLN", "TBO", "RMA", "DESC"];

    async function upsertUsuarioComFiliais(opts: {
      email: string;
      nome: string;
      perfil: "ADMIN" | "GERENTE" | "OPERADOR";
      senhaHash: string;
      filialId: string;
    }) {
      const u = await prisma.usuario.upsert({
        where: { email: opts.email },
        update: {
          senhaHash: opts.senhaHash,
          ativo: true,
          perfil: opts.perfil,
          filialId: opts.filialId,
          perfilCompleto: true,
        },
        create: {
          nome: opts.nome,
          email: opts.email,
          senhaHash: opts.senhaHash,
          perfil: opts.perfil,
          filialId: opts.filialId,
          perfilCompleto: true,
        },
      });
      await prisma.usuarioFilial.deleteMany({ where: { usuarioId: u.id } });
      await prisma.usuarioFilial.create({
        data: { usuarioId: u.id, filialId: opts.filialId },
      });
      return u;
    }

    await upsertUsuarioComFiliais({
      email,
      nome: "Administrador TEEP",
      perfil: "ADMIN",
      senhaHash,
      filialId: paulinia.id,
    });

    const senhaOps = await bcrypt.hash(
      process.env.SEED_OPS_PASSWORD || "Oper@123",
      12
    );
    await upsertUsuarioComFiliais({
      email: "gerente@teep.com.br",
      nome: "Gerente Homologação",
      perfil: "GERENTE",
      senhaHash: senhaOps,
      filialId: paulinia.id,
    });
    await upsertUsuarioComFiliais({
      email: "operador@teep.com.br",
      nome: "Operador Homologação",
      perfil: "OPERADOR",
      senhaHash: senhaOps,
      filialId: paulinia.id,
    });
    await upsertUsuarioComFiliais({
      email: "operador.tbo@teep.com.br",
      nome: "Operador Timbó",
      perfil: "OPERADOR",
      senhaHash: senhaOps,
      filialId: timbo.id,
    });

    for (const em of [email, ...DEMO_USER_EMAILS]) {
      const u = await prisma.usuario.findUnique({ where: { email: em } });
      if (!u) continue;
      await prisma.usuarioFilial.upsert({
        where: {
          usuarioId_filialId: {
            usuarioId: u.id,
            filialId: estoqueRma.id,
          },
        },
        update: {},
        create: { usuarioId: u.id, filialId: estoqueRma.id },
      });
    }

    type TipoSeed = {
      codigo: string;
      nome: string;
      operacao: "ENTRADA" | "SAIDA" | "TRANSFERENCIA";
      requerCliente: boolean;
      requerAprovacao: boolean;
      permitidoOperador: boolean;
      permitidoGerente: boolean;
      sistema: boolean;
      descricao: string;
      baixaPorArvore?: boolean;
      saidaPedidoVenda?: boolean;
      /** Sigla do estoque (PLN/TBO…); omitido em pedido eGestor */
      filialSigla?: string;
      filialDestinoSigla?: string;
    };

    const tiposHomolog: TipoSeed[] = [
      {
        codigo: "ENT-COMPRA",
        nome: "Compra",
        operacao: "ENTRADA",
        requerCliente: true,
        requerAprovacao: false,
        permitidoOperador: true,
        permitidoGerente: true,
        sistema: false,
        filialSigla: "PLN",
        descricao: "Recebimento no estoque amarrado ao tipo",
      },
      {
        codigo: "ENT-DEV-CLI",
        nome: "Devolução de Cliente",
        operacao: "ENTRADA",
        requerCliente: true,
        requerAprovacao: true,
        permitidoOperador: true,
        permitidoGerente: true,
        sistema: false,
        filialSigla: "PLN",
        descricao:
          "Entra no estoque do tipo — Operador gera PENDENTE (F6 aprovação)",
      },
      {
        codigo: "SAI-VENDA",
        nome: "Venda / Entrega",
        operacao: "SAIDA",
        requerCliente: true,
        requerAprovacao: false,
        permitidoOperador: true,
        permitidoGerente: true,
        sistema: false,
        filialSigla: "PLN",
        descricao: "Sai do estoque amarrado ao tipo",
      },
      {
        codigo: "SAI-ARVORE",
        nome: "Saída com árvore",
        operacao: "SAIDA",
        requerCliente: false,
        requerAprovacao: false,
        permitidoOperador: true,
        permitidoGerente: true,
        sistema: false,
        baixaPorArvore: true,
        filialSigla: "PLN",
        descricao:
          "Na saída, baixa os componentes da árvore deste produto no mesmo estoque",
      },
      {
        codigo: "SAI-PERDA",
        nome: "Perda / Avaria",
        operacao: "SAIDA",
        requerCliente: false,
        requerAprovacao: true,
        permitidoOperador: false,
        permitidoGerente: true,
        sistema: false,
        filialSigla: "PLN",
        descricao: "Sai do estoque do tipo (perda)",
      },
      {
        codigo: "SAI-DEMO",
        nome: "Saída Demonstração",
        operacao: "SAIDA",
        requerCliente: true,
        requerAprovacao: false,
        permitidoOperador: true,
        permitidoGerente: true,
        sistema: false,
        filialSigla: "PLN",
        descricao:
          "Equipamento enviado para demonstração — alertas de retorno 15/30/45/60 dias",
      },
      {
        codigo: "ENT-DEMO",
        nome: "Retorno Demonstração",
        operacao: "ENTRADA",
        requerCliente: true,
        requerAprovacao: false,
        permitidoOperador: true,
        permitidoGerente: true,
        sistema: false,
        filialSigla: "PLN",
        descricao:
          "Retorno de equipamento de demonstração (vincular à saída aberta)",
      },
      {
        codigo: "SAI-COMODATO",
        nome: "Saída Comodato",
        operacao: "SAIDA",
        requerCliente: true,
        requerAprovacao: false,
        permitidoOperador: true,
        permitidoGerente: true,
        sistema: false,
        filialSigla: "PLN",
        descricao:
          "Equipamento em comodato — alertas de retorno; anexe o termo assinado",
      },
      {
        codigo: "ENT-COMODATO",
        nome: "Retorno Comodato",
        operacao: "ENTRADA",
        requerCliente: true,
        requerAprovacao: false,
        permitidoOperador: true,
        permitidoGerente: true,
        sistema: false,
        filialSigla: "PLN",
        descricao:
          "Retorno de equipamento em comodato (vincular à saída aberta)",
      },
      {
        codigo: "TR-PLN-TBO",
        nome: "Transferência PLN → TBO",
        operacao: "TRANSFERENCIA",
        requerCliente: false,
        requerAprovacao: false,
        permitidoOperador: true,
        permitidoGerente: true,
        sistema: false,
        filialSigla: "PLN",
        filialDestinoSigla: "TBO",
        descricao: "Transferência fixa Paulínia → Timbó (homolog)",
      },
      {
        codigo: "SAI-PEDIDO",
        nome: "Saída pedido eGestor",
        operacao: "SAIDA",
        requerCliente: false,
        requerAprovacao: false,
        permitidoOperador: true,
        permitidoGerente: true,
        sistema: false,
        saidaPedidoVenda: true,
        descricao: "Saída automática na separação de pedidos eGestor",
      },
    ];

    const antigoMontagem = await prisma.tipoMovimentacao.findUnique({
      where: { nome: "Montagem / Produção" },
    });
    if (antigoMontagem) {
      const novo = await prisma.tipoMovimentacao.findUnique({
        where: { nome: "Saída com árvore" },
      });
      if (!novo) {
        await prisma.tipoMovimentacao.update({
          where: { id: antigoMontagem.id },
          data: { nome: "Saída com árvore" },
        });
      } else if (antigoMontagem.id !== novo.id) {
        await prisma.tipoMovimentacao.update({
          where: { id: antigoMontagem.id },
          data: { ativo: false, baixaPorArvore: false },
        });
      }
    }

    const filialBySigla = async (sigla?: string) => {
      if (!sigla) return null;
      const f = await prisma.filial.findUnique({ where: { sigla } });
      return f?.id ?? null;
    };

    for (const t of tiposHomolog) {
      const {
        baixaPorArvore,
        saidaPedidoVenda,
        filialSigla,
        filialDestinoSigla,
        ...base
      } = t;
      const filialId = await filialBySigla(filialSigla);
      const filialDestinoId = await filialBySigla(filialDestinoSigla);
      await prisma.tipoMovimentacao.upsert({
        where: { nome: t.nome },
        update: {
          ...base,
          baixaPorArvore: baixaPorArvore === true,
          saidaPedidoVenda: saidaPedidoVenda === true,
          filialId,
          filialDestinoId,
          ativo: true,
        },
        create: {
          ...base,
          baixaPorArvore: baixaPorArvore === true,
          saidaPedidoVenda: saidaPedidoVenda === true,
          filialId,
          filialDestinoId,
        },
      });
    }

    const saidaPedidoTipo = await prisma.tipoMovimentacao.findUnique({
      where: { nome: "Saída pedido eGestor" },
    });
    if (saidaPedidoTipo) {
      await prisma.tipoMovimentacao.updateMany({
        where: { id: { not: saidaPedidoTipo.id } },
        data: { saidaPedidoVenda: false },
      });
      await prisma.tipoMovimentacao.update({
        where: { id: saidaPedidoTipo.id },
        data: {
          saidaPedidoVenda: true,
          operacao: "SAIDA",
          requerAprovacao: false,
        },
      });
    }

    const saidaDemo = await prisma.tipoMovimentacao.findUnique({
      where: { nome: "Saída Demonstração" },
    });
    const retornoDemo = await prisma.tipoMovimentacao.findUnique({
      where: { nome: "Retorno Demonstração" },
    });
    const saidaComodato = await prisma.tipoMovimentacao.findUnique({
      where: { nome: "Saída Comodato" },
    });
    const retornoComodato = await prisma.tipoMovimentacao.findUnique({
      where: { nome: "Retorno Comodato" },
    });

    if (saidaDemo) {
      await prisma.tipoMovimentacao.update({
        where: { id: saidaDemo.id },
        data: {
          geraAlertaRetorno: true,
          diasAlerta: [15, 30, 45, 60],
          ehRetornoDeId: null,
          requerCliente: true,
        },
      });
    }
    if (retornoDemo && saidaDemo) {
      await prisma.tipoMovimentacao.update({
        where: { id: retornoDemo.id },
        data: {
          geraAlertaRetorno: false,
          ehRetornoDeId: saidaDemo.id,
          requerCliente: true,
        },
      });
    }
    if (saidaComodato) {
      await prisma.tipoMovimentacao.update({
        where: { id: saidaComodato.id },
        data: {
          geraAlertaRetorno: true,
          diasAlerta: [15, 30, 45, 60],
          ehRetornoDeId: null,
          requerTermoComodato: true,
          requerCliente: true,
        },
      });
    }
    if (retornoComodato && saidaComodato) {
      await prisma.tipoMovimentacao.update({
        where: { id: retornoComodato.id },
        data: {
          geraAlertaRetorno: false,
          ehRetornoDeId: saidaComodato.id,
          requerCliente: true,
        },
      });
    }

    const categorias = [
      "Eletrônico",
      "Adesivos",
      "Cabos",
      "Gabinetes",
      "Conectores",
      "Fontes",
      "Módulos",
      "Fixação",
      "Acessórios",
      "Dispositivos",
    ];
    for (const nome of categorias) {
      await prisma.categoria.upsert({
        where: { nome },
        update: {},
        create: { nome },
      });
    }

    const cat = await prisma.categoria.findFirst({
      where: { nome: "Eletrônico" },
    });
    if (!cat) throw new Error("Categoria Eletrônico ausente");

    const demos = [
      {
        codigo: "DEMO-CABO-01",
        descricao: "Cabo HDMI 2m (demo)",
        unidade: "UN",
        precoUnitario: 45.9,
        estoqueMinimo: 5,
        estoqueMaximo: 100,
      },
      {
        codigo: "DEMO-FONT-01",
        descricao: "Fonte 12V 5A (demo)",
        unidade: "UN",
        precoUnitario: 89.0,
        estoqueMinimo: 3,
        estoqueMaximo: 50,
      },
      {
        codigo: "DEMO-MOD-01",
        descricao: "Módulo relé 4 canais (demo)",
        unidade: "UN",
        precoUnitario: 62.5,
        estoqueMinimo: 2,
        estoqueMaximo: 40,
      },
    ];

    for (const p of demos) {
      await prisma.produto.upsert({
        where: { codigo: p.codigo },
        update: {
          descricao: p.descricao,
          categoriaId: cat.id,
          unidade: p.unidade,
          precoUnitario: p.precoUnitario,
          estoqueMinimo: p.estoqueMinimo,
          estoqueMaximo: p.estoqueMaximo,
          ativo: true,
        },
        create: {
          ...p,
          categoriaId: cat.id,
        },
      });
    }

    const clienteDemo = await prisma.cliente.findFirst({
      where: {
        documento: { in: ["00.000.000/0001-91", "11.222.333/0001-81"] },
      },
    });
    if (!clienteDemo) {
      await prisma.cliente.create({
        data: {
          nome: "Fornecedor Demo TEEP",
          documento: "11.222.333/0001-81",
          tipo: "FORNECEDOR",
          email: "fornecedor.demo@teep.com.br",
          cidade: "Paulínia",
          estado: "SP",
        },
      });
    }

    console.log("Seed DEMO OK: 3 produtos + 1 fornecedor (saldos via /estoque/init)");
  } else {
    /**
     * Remove herança de seeds antigos (Compra/Venda/categorias/usuários demo)
     * quando não há vínculo em movimentação. Banco sujo com movimentos → use migrate reset.
     */
    await prisma.usuario.deleteMany({
      where: { email: { in: DEMO_USER_EMAILS } },
    });

    const categorias = await prisma.categoria.findMany({
      select: { id: true },
    });
    for (const c of categorias) {
      const usados = await prisma.produto.count({
        where: { categoriaId: c.id },
      });
      if (usados === 0) {
        await prisma.categoria.delete({ where: { id: c.id } }).catch(() => {});
      }
    }

    const tiposLivres = await prisma.tipoMovimentacao.findMany({
      where: { sistema: false },
      select: { id: true, nome: true },
    });
    for (const t of tiposLivres) {
      const usados = await prisma.movimentacao.count({
        where: { tipoId: t.id },
      });
      if (usados === 0) {
        await prisma.tipoMovimentacao
          .delete({ where: { id: t.id } })
          .catch(() => {});
      }
    }
  }

  console.log("Seed OK:", {
    admin: email,
    filiais: filiaisSeed.length
      ? filiaisSeed
      : "(nenhum — cadastre em Admin → Estoques)",
    tiposSistema: nSistema,
    tiposCadastro: seedDemo ? "homolog" : "(nenhum — cadastre em Admin → Tipos)",
    ops: seedDemo ? DEMO_USER_EMAILS : [],
    demo: seedDemo,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
