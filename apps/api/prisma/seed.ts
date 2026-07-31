import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@teep.com.br";
  const password = process.env.SEED_ADMIN_PASSWORD || "Admin@123";

  const paulinia = await prisma.filial.upsert({
    where: { sigla: "PLN" },
    update: {},
    create: {
      nome: "Paulínia",
      sigla: "PLN",
      cidade: "Paulínia",
      estado: "SP",
      responsavel: "Almoxarifado",
      emailContato: "paulinia@teep.com.br",
    },
  });

  const timbo = await prisma.filial.upsert({
    where: { sigla: "TBO" },
    update: {},
    create: {
      nome: "Timbó",
      sigla: "TBO",
      cidade: "Timbó",
      estado: "SC",
      responsavel: "Almoxarifado",
      emailContato: "timbo@teep.com.br",
    },
  });

  const senhaHash = await bcrypt.hash(password, 12);

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

  /** Seed inicial — Admin pode criar/editar tipos livres depois */
  const tipos: Array<{
    nome: string;
    operacao: "ENTRADA" | "SAIDA" | "TRANSFERENCIA";
    requerCliente: boolean;
    requerAprovacao: boolean;
    permitidoOperador: boolean;
    permitidoGerente: boolean;
    sistema: boolean;
    descricao: string;
  }> = [
    {
      nome: "Compra",
      operacao: "ENTRADA",
      requerCliente: true,
      requerAprovacao: false,
      permitidoOperador: true,
      permitidoGerente: true,
      sistema: false,
      descricao: "Recebimento no estoque da filial informada",
    },
    {
      nome: "Inventário / Saldo Inicial",
      operacao: "ENTRADA",
      requerCliente: false,
      requerAprovacao: true,
      permitidoOperador: false,
      permitidoGerente: false,
      sistema: true,
      descricao: "Somente via Inicialização de Estoque",
    },
    {
      nome: "Devolução de Cliente",
      operacao: "ENTRADA",
      requerCliente: true,
      requerAprovacao: true,
      permitidoOperador: true,
      permitidoGerente: true,
      sistema: false,
      descricao:
        "Entra no estoque da filial — Operador gera PENDENTE (F6 aprovação)",
    },
    {
      nome: "Transferência Recebida",
      operacao: "ENTRADA",
      requerCliente: false,
      requerAprovacao: false,
      permitidoOperador: false,
      permitidoGerente: false,
      sistema: true,
      descricao: "Gerado pelo módulo Transferências na conferência do destino",
    },
    {
      nome: "Ajuste Positivo",
      operacao: "ENTRADA",
      requerCliente: false,
      requerAprovacao: true,
      permitidoOperador: false,
      permitidoGerente: true,
      sistema: false,
      descricao: "Entra no estoque da filial informada",
    },
    {
      nome: "Venda / Entrega",
      operacao: "SAIDA",
      requerCliente: true,
      requerAprovacao: false,
      permitidoOperador: true,
      permitidoGerente: true,
      sistema: false,
      descricao: "Sai do estoque da filial informada",
    },
    {
      nome: "Montagem / Produção",
      operacao: "SAIDA",
      requerCliente: false,
      requerAprovacao: false,
      permitidoOperador: true,
      permitidoGerente: true,
      sistema: false,
      descricao: "Sai do estoque da filial informada",
    },
    {
      nome: "Transferência Enviada",
      operacao: "SAIDA",
      requerCliente: false,
      requerAprovacao: false,
      permitidoOperador: false,
      permitidoGerente: false,
      sistema: true,
      descricao: "Gerado pelo módulo Transferências (F8)",
    },
    {
      nome: "Perda / Avaria",
      operacao: "SAIDA",
      requerCliente: false,
      requerAprovacao: true,
      permitidoOperador: false,
      permitidoGerente: true,
      sistema: false,
      descricao: "Sai do estoque da filial informada (perda)",
    },
    {
      nome: "Ajuste Negativo",
      operacao: "SAIDA",
      requerCliente: false,
      requerAprovacao: true,
      permitidoOperador: false,
      permitidoGerente: true,
      sistema: false,
      descricao: "Sai do estoque da filial informada",
    },
    {
      nome: "Estorno",
      operacao: "ENTRADA",
      requerCliente: false,
      requerAprovacao: true,
      permitidoOperador: false,
      permitidoGerente: false,
      sistema: true,
      descricao: "Gerado pelo sistema ao estornar",
    },
    {
      nome: "Transferência entre estoques",
      operacao: "TRANSFERENCIA",
      requerCliente: false,
      requerAprovacao: false,
      permitidoOperador: true,
      permitidoGerente: true,
      sistema: false,
      descricao:
        "Lançamento A->B: creditar destino agora ou aguardar confirmação de recebimento (F15)",
    },
    {
      nome: "Saída Demonstração",
      operacao: "SAIDA",
      requerCliente: true,
      requerAprovacao: false,
      permitidoOperador: true,
      permitidoGerente: true,
      sistema: false,
      descricao:
        "Equipamento enviado para demonstração — alertas de retorno 15/30/45/60 dias",
    },
    {
      nome: "Retorno Demonstração",
      operacao: "ENTRADA",
      requerCliente: true,
      requerAprovacao: false,
      permitidoOperador: true,
      permitidoGerente: true,
      sistema: false,
      descricao: "Retorno de equipamento de demonstração (vincular à saída aberta)",
    },
    {
      nome: "Saída Comodato",
      operacao: "SAIDA",
      requerCliente: true,
      requerAprovacao: false,
      permitidoOperador: true,
      permitidoGerente: true,
      sistema: false,
      descricao:
        "Equipamento em comodato — alertas de retorno; anexe o termo assinado",
    },
    {
      nome: "Retorno Comodato",
      operacao: "ENTRADA",
      requerCliente: true,
      requerAprovacao: false,
      permitidoOperador: true,
      permitidoGerente: true,
      sistema: false,
      descricao: "Retorno de equipamento em comodato (vincular à saída aberta)",
    },
  ];

  for (const t of tipos) {
    await prisma.tipoMovimentacao.upsert({
      where: { nome: t.nome },
      update: {
        operacao: t.operacao,
        requerCliente: t.requerCliente,
        requerAprovacao: t.requerAprovacao,
        permitidoOperador: t.permitidoOperador,
        permitidoGerente: t.permitidoGerente,
        sistema: t.sistema,
        descricao: t.descricao,
        ativo: true,
      },
      create: t,
    });
  }

  /** Demo/Comodato: flags de alerta e vínculo retorno → saída */
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

  /** Homologação / smoke (F10): SEED_DEMO=1 — produtos e cliente de exemplo (sem saldos). */
  if (process.env.SEED_DEMO === "1") {
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
      where: { documento: "00.000.000/0001-91" },
    });
    if (!clienteDemo) {
      await prisma.cliente.create({
        data: {
          nome: "Fornecedor Demo TEEP",
          documento: "00.000.000/0001-91",
          tipo: "FORNECEDOR",
          email: "fornecedor.demo@teep.com.br",
          cidade: "Paulínia",
          estado: "SP",
        },
      });
    }

    console.log("Seed DEMO OK: 3 produtos + 1 fornecedor (saldos via /estoque/init)");
  }

  console.log("Seed OK:", {
    admin: email,
    filiais: ["PLN", "TBO"],
    tipos: tipos.length,
    ops: ["gerente@teep.com.br", "operador@teep.com.br", "operador.tbo@teep.com.br"],
    demo: process.env.SEED_DEMO === "1",
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
