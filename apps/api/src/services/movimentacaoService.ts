import {
  TIPO_AJUSTE_NEG,
  TIPO_AJUSTE_POS,
  TIPO_ESTORNO,
  TIPO_INVENTARIO,
  Perfil,
  isAbaixoMinimo,
  isAcimaMaximo,
} from "@teep/shared";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { AuthUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import {
  alertasUiDeLimiares,
  notificarLimiaresEstoque,
  type AlertaUi,
} from "./alertaService";
import { aplicarSaldo, qtyReservadaTransferenciaPendente } from "./estoqueService";
import {
  criarTransferencia,
  criarTransferenciaImediata,
  criarTransferenciaPendenteAprovacao,
} from "./transferenciaService";
import { resolveOperadorFilialId } from "../lib/filialScope";
import { assertNotaFiscalNumeroLivre } from "../lib/notaFiscalNumero";
import { isValidRmaStoredPath } from "../lib/rmaUploads";
import { isValidUploadPath } from "../lib/uploads";
import {
  agendarAlertasRetorno,
  cancelarAlertasRetornoPendentes,
  syncAlertasAposLiberacaoSaida,
  syncAlertasAposRetorno,
} from "./alertaRetornoService";
import {
  mapaQtyOcupadaPorSaidas,
  qtyRestanteSaida,
  saidaTemRetornoAtivo,
} from "./retornoVinculoHelper";
import {
  aplicarSeriesEntrada,
  aplicarSeriesEstorno,
  aplicarSeriesInventario,
  aplicarSeriesRetorno,
  aplicarSeriesSaida,
  normalizarSeries,
  validarSeriesEntradaNovas,
  validarSeriesRetorno,
  validarSeriesSaidaDisponiveis,
} from "./serieService";
import {
  aplicarConsumoMontagem,
  assertSaldoComponentes,
  carregarBomProduto,
  linhasConsumoMontagem,
} from "./montagemService";

const movInclude = {
  produto: true,
  tipo: true,
  filial: true,
  filialDestino: true,
  cliente: true,
  usuario: { select: { id: true, nome: true, email: true } },
  movimentacaoOrigem: {
    select: {
      id: true,
      dataMovimento: true,
      quantidade: true,
      notaFiscalNumero: true,
      tipo: { select: { nome: true } },
    },
  },
  anexos: true,
  series: {
    include: {
      unidadeSerie: {
        select: { id: true, numeroSerie: true, status: true, filialId: true },
      },
    },
  },
} as const;

function tipoPermitidoParaPerfil(
  tipo: {
    permitidoOperador: boolean;
    permitidoGerente: boolean;
  },
  perfil: Perfil
): boolean {
  if (perfil === "OPERADOR") return tipo.permitidoOperador;
  if (perfil === "GERENTE" || perfil === "ADMIN") return tipo.permitidoGerente;
  return false;
}

function requireGerenteOuAdmin(user: AuthUser) {
  if (user.perfil !== "ADMIN" && user.perfil !== "GERENTE") {
    throw new AppError(403, "Apenas Admin ou Gerente");
  }
}

async function aplicarEfeitoSaldo(
  tx: Prisma.TransactionClient,
  mov: {
    produtoId: string;
    filialId: string;
    filialDestinoId: string | null;
    quantidade: Prisma.Decimal | number;
    operacao: string;
  },
  inverter = false
) {
  const qtd = Number(mov.quantidade);
  if (mov.operacao === "TRANSFERENCIA") {
    if (!mov.filialDestinoId) {
      throw new AppError(400, "Transferência sem estoque destino");
    }
    if (inverter) {
      await aplicarSaldo(tx, {
        produtoId: mov.produtoId,
        filialId: mov.filialDestinoId,
        operacao: "SAIDA",
        quantidade: qtd,
      });
      return aplicarSaldo(tx, {
        produtoId: mov.produtoId,
        filialId: mov.filialId,
        operacao: "ENTRADA",
        quantidade: qtd,
      });
    }
    const saida = await aplicarSaldo(tx, {
      produtoId: mov.produtoId,
      filialId: mov.filialId,
      operacao: "SAIDA",
      quantidade: qtd,
    });
    await aplicarSaldo(tx, {
      produtoId: mov.produtoId,
      filialId: mov.filialDestinoId,
      operacao: "ENTRADA",
      quantidade: qtd,
    });
    return saida;
  }

  const op = mov.operacao as "ENTRADA" | "SAIDA";
  const efetiva = inverter
    ? op === "ENTRADA"
      ? "SAIDA"
      : "ENTRADA"
    : op;
  return aplicarSaldo(tx, {
    produtoId: mov.produtoId,
    filialId: mov.filialId,
    operacao: efetiva,
    quantidade: qtd,
  });
}

export async function criarMovimentacao(
  user: AuthUser,
  input: {
    produtoId?: string;
    tipoId: string;
    filialId?: string;
    filialDestinoId?: string | null;
    /** Matéria-prima quando tipo.baixaPorArvore */
    filialComponentesId?: string | null;
    clienteId?: string | null;
    quantidade?: number;
    series?: string[];
    precoUnitario?: number;
    observacao?: string | null;
    notaFiscalNumero?: string | null;
    notaFiscalArquivo?: string | null;
    guiaTransporte?: string | null;
    creditoDestino?: "IMEDIATO" | "AGUARDAR_RECEBIMENTO";
    itens?: Array<{ produtoId: string; quantidade: number; series?: string[] }>;
    alertaEmails?: string[];
    movimentacaoOrigemId?: string | null;
    /** Agrupa linhas multi-SKU (uso interno / resposta) */
    grupoLancamentoId?: string | null;
    /** Entrada: reativa série SAIDO (ex. equipamento que volta em RMA) */
    permitirReativarSaido?: boolean;
    /**
     * Chamada pelo módulo RMA (não pelo Novo Lançamento).
     * Permite tipos cadastrados com flag RMA (entrada/saída automática).
     */
    usoInternoRma?: boolean;
    anexos?: Array<{
      tipo: "NOTA_FISCAL" | "TERMO_COMODATO" | "LAUDO" | "OUTRO";
      arquivo: string;
      label?: string | null;
    }>;
  }
) {
  const tipo = await prisma.tipoMovimentacao.findUnique({
    where: { id: input.tipoId },
  });
  if (!tipo || !tipo.ativo) throw new AppError(400, "Tipo inválido");
  const tipoRma =
    tipo.rmaEntradaEstoque === true || tipo.rmaSaidaCliente === true;
  if (tipo.sistema && !(input.usoInternoRma && tipoRma)) {
    throw new AppError(
      400,
      "Tipo de sistema não pode ser usado no lançamento manual"
    );
  }
  if (input.usoInternoRma && !tipoRma) {
    throw new AppError(400, "Tipo inválido para operação RMA");
  }

  if (!input.usoInternoRma && !tipoPermitidoParaPerfil(tipo, user.perfil)) {
    throw new AppError(403, "Perfil não autorizado para este tipo");
  }

  if (
    !input.usoInternoRma &&
    (tipo.operacao === "ENTRADA" || tipo.operacao === "SAIDA") &&
    (tipo.requerCliente || tipo.ehRetornoDeId)
  ) {
    await assertNotaFiscalNumeroLivre({
      numero: input.notaFiscalNumero,
      operacao: tipo.operacao,
      exclude: { grupoLancamentoId: input.grupoLancamentoId },
    });
  }

  // F15: TRANSFERÊNCIA pelo Novo Lançamento
  if (tipo.operacao === "TRANSFERENCIA") {
    if (!input.filialDestinoId) {
      throw new AppError(400, "Filial de destino obrigatória na transferência");
    }
    if (
      input.creditoDestino !== "IMEDIATO" &&
      input.creditoDestino !== "AGUARDAR_RECEBIMENTO"
    ) {
      throw new AppError(
        400,
        "Informe creditoDestino: IMEDIATO ou AGUARDAR_RECEBIMENTO"
      );
    }
    if (tipo.baixaPorArvore && tipo.requerAprovacao) {
      throw new AppError(
        400,
        "Transferência com baixa pela árvore não pode exigir aprovação — desative a aprovação no tipo"
      );
    }
    let itens = input.itens;
    if (!itens?.length) {
      if (!input.produtoId || !input.quantidade) {
        throw new AppError(400, "Informe itens ou produtoId+quantidade");
      }
      itens = [
        {
          produtoId: input.produtoId,
          quantidade: input.quantidade,
          series: input.series,
        },
      ];
    }
    const payload = {
      origemFilialId: input.filialId,
      destinoFilialId: input.filialDestinoId,
      guiaTransporte: input.guiaTransporte?.trim() || null,
      notaFiscalNumero: input.notaFiscalNumero?.trim() || null,
      observacao: input.observacao?.trim() || null,
      anexos: (input.anexos || []).filter((a) =>
        ["NOTA_FISCAL", "LAUDO", "OUTRO"].includes(a.tipo)
      ),
      itens,
      baixaPorArvore: tipo.baixaPorArvore === true,
    };

    const precisaAprovacao =
      user.perfil === "OPERADOR" &&
      tipo.requerAprovacao === true &&
      !tipo.baixaPorArvore;

    const result = precisaAprovacao
      ? await criarTransferenciaPendenteAprovacao(
          user,
          payload,
          input.creditoDestino
        )
      : input.creditoDestino === "IMEDIATO"
        ? await criarTransferenciaImediata(user, payload)
        : await criarTransferencia(user, payload);

    return {
      fluxo: "TRANSFERENCIA" as const,
      creditoDestino: input.creditoDestino,
      pendenteAprovacao: Boolean(result.pendenteAprovacao),
      transferencia: result.transferencia,
      /** Compat UI legada — status espelha a transferência */
      movimentacao: {
        status: result.transferencia.status,
        id: result.transferencia.id,
      },
      alertaEstoqueMinimo: (result.alertasEstoque || []).some(
        (a) => a.abaixoMinimo
      ),
      alertaEstoqueMaximo: (result.alertasEstoque || []).some(
        (a) => a.acimaMaximo
      ),
      alertas: result.alertas || [],
      temDivergencia: result.temDivergencia ?? false,
    };
  }

  // Normaliza itens[] (ENTRADA/SAIDA) — 1 SKU legado ou N no mesmo grupo
  let itensLancamento = input.itens;
  if (!itensLancamento?.length) {
    if (!input.produtoId || input.quantidade == null) {
      throw new AppError(400, "produtoId e quantidade obrigatórios");
    }
    itensLancamento = [
      {
        produtoId: input.produtoId,
        quantidade: input.quantidade,
        series: input.series,
      },
    ];
  } else {
    const ids = itensLancamento.map((i) => i.produtoId);
    if (new Set(ids).size !== ids.length) {
      throw new AppError(400, "Não repita o mesmo produto nos itens");
    }
  }

  if (itensLancamento.length > 1) {
    if (tipo.ehRetornoDeId) {
      throw new AppError(
        400,
        "Retorno vinculado aceita apenas um produto por lançamento"
      );
    }
    if (tipo.baixaPorArvore) {
      throw new AppError(
        400,
        "Baixa pela árvore aceita apenas um produto por lançamento nesta versão"
      );
    }

    let filialIdGrupo = input.filialId;
    if (user.perfil === "OPERADOR") {
      filialIdGrupo = resolveOperadorFilialId(user, input.filialId);
    }
    if (!filialIdGrupo) {
      throw new AppError(400, "Estoque (filial) obrigatório");
    }

    // Pré-valida produtos/séries/saldo antes de gravar qualquer linha
    // (as criações abaixo ainda são por item — falha no meio deixa parcial).
    await prisma.$transaction(async (tx) => {
      for (const item of itensLancamento) {
        const prod = await tx.produto.findFirst({
          where: { id: item.produtoId, ativo: true },
        });
        if (!prod) {
          throw new AppError(400, `Produto inválido: ${item.produtoId}`);
        }
        const qtdItem = Number(item.quantidade);
        if (!Number.isFinite(qtdItem) || qtdItem <= 0) {
          throw new AppError(
            400,
            `Produto ${prod.codigo}: quantidade inválida`
          );
        }
        if (prod.controlaSerie) {
          const seriesNorm = normalizarSeries(item.series);
          if (seriesNorm.length === 0) {
            throw new AppError(
              400,
              `Produto ${prod.codigo} exige números de série`
            );
          }
          if (seriesNorm.length !== qtdItem) {
            throw new AppError(
              400,
              `Produto ${prod.codigo}: informe ${qtdItem} série(s)`
            );
          }
          if (tipo.operacao === "SAIDA") {
            await validarSeriesSaidaDisponiveis(tx, {
              produtoId: item.produtoId,
              filialId: filialIdGrupo,
              series: seriesNorm,
              quantidade: seriesNorm.length,
            });
          } else if (tipo.operacao === "ENTRADA") {
            await validarSeriesEntradaNovas(tx, {
              produtoId: item.produtoId,
              series: seriesNorm,
              quantidade: seriesNorm.length,
              permitirReativarSaido: input.permitirReativarSaido === true,
            });
          }
        } else if (tipo.operacao === "SAIDA") {
          const estoque = await tx.estoque.findUnique({
            where: {
              uniq_produto_filial: {
                produtoId: item.produtoId,
                filialId: filialIdGrupo,
              },
            },
          });
          const saldo = Number(estoque?.saldoAtual ?? 0);
          const reservada = await qtyReservadaTransferenciaPendente(
            tx,
            item.produtoId,
            filialIdGrupo
          );
          const disponivel = saldo - reservada;
          if (qtdItem > disponivel + 1e-9) {
            throw new AppError(
              400,
              `Produto ${prod.codigo}: saldo insuficiente (disponível: ${disponivel})`
            );
          }
        }
      }
    });

    const grupoId = input.grupoLancamentoId || randomUUID();
    const resultados: Array<{
      movimentacao?: { id?: string; status?: string } | null;
      alertas?: AlertaUi[];
      alertaEstoqueMinimo?: boolean;
      alertaEstoqueMaximo?: boolean;
    }> = [];
    const alertasAll: AlertaUi[] = [];
    let alertaMin = false;
    let alertaMax = false;

    for (let i = 0; i < itensLancamento.length; i++) {
      const item = itensLancamento[i]!;
      try {
        const r = await criarMovimentacao(user, {
          ...input,
          produtoId: item.produtoId,
          quantidade: item.quantidade,
          series: item.series,
          itens: undefined,
          grupoLancamentoId: grupoId,
          // NF/termo: só na 1ª linha evita anexos duplicados idênticos
          anexos: i === 0 ? input.anexos : [],
          notaFiscalArquivo: i === 0 ? input.notaFiscalArquivo : null,
        });
        resultados.push(r);
        if ("alertas" in r && Array.isArray(r.alertas)) {
          alertasAll.push(...(r.alertas as AlertaUi[]));
        }
        if ("alertaEstoqueMinimo" in r && r.alertaEstoqueMinimo) alertaMin = true;
        if ("alertaEstoqueMaximo" in r && r.alertaEstoqueMaximo) alertaMax = true;
      } catch (e) {
        const msg = e instanceof AppError ? e.message : "erro ao gravar item";
        const gravadas = resultados.length;
        if (gravadas > 0) {
          throw new AppError(
            409,
            `Falha no item ${i + 1}: ${msg}. Já foram gravadas ${gravadas} linha(s) do grupo ${grupoId} — confira em Movimentações.`
          );
        }
        throw e;
      }
    }

    const movs = resultados
      .map((r) => r.movimentacao ?? null)
      .filter(Boolean);

    return {
      fluxo: "LANCAMENTO_GRUPO" as const,
      grupoLancamentoId: grupoId,
      movimentacoes: movs,
      /** Compat UI — primeira linha */
      movimentacao: movs[0],
      alertaEstoqueMinimo: alertaMin,
      alertaEstoqueMaximo: alertaMax,
      alertas: alertasAll,
    };
  }

  // Single SKU
  input = {
    ...input,
    produtoId: itensLancamento[0]!.produtoId,
    quantidade: itensLancamento[0]!.quantidade,
    series: itensLancamento[0]!.series,
    itens: undefined,
  };

  if (!input.produtoId || input.quantidade == null) {
    throw new AppError(400, "produtoId e quantidade obrigatórios");
  }

  const produto = await prisma.produto.findFirst({
    where: { id: input.produtoId, ativo: true },
  });
  if (!produto) throw new AppError(400, "Produto inválido ou inativo");

  let filialId = input.filialId;
  if (user.perfil === "OPERADOR") {
    filialId = resolveOperadorFilialId(user, input.filialId);
  }
  if (!filialId) {
    throw new AppError(400, "Estoque (filial) obrigatório");
  }

  const filial = await prisma.filial.findFirst({
    where: { id: filialId, ativo: true },
  });
  if (!filial) throw new AppError(400, "Estoque/filial inválido");

  if (tipo.requerCliente && !input.clienteId) {
    throw new AppError(400, "Cliente/fornecedor obrigatório para este tipo");
  }
  if (input.clienteId) {
    const cliente = await prisma.cliente.findFirst({
      where: { id: input.clienteId, ativo: true },
    });
    if (!cliente) throw new AppError(400, "Cliente/fornecedor inválido");
  }

  const alertaEmails = (input.alertaEmails || [])
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (tipo.geraAlertaRetorno && alertaEmails.length === 0) {
    throw new AppError(
      400,
      "Informe ao menos um e-mail para alertas de retorno"
    );
  }

  let notaFiscalNumero: string | null = null;
  let notaFiscalArquivo: string | null = null;
  if (tipo.requerCliente || tipo.ehRetornoDeId) {
    notaFiscalNumero = input.notaFiscalNumero?.trim() || null;
    notaFiscalArquivo = input.notaFiscalArquivo || null;
    if (
      notaFiscalArquivo &&
      !isValidUploadPath(notaFiscalArquivo, "nota-fiscal", user.id) &&
      !isValidUploadPath(notaFiscalArquivo, "documento", user.id) &&
      !isValidRmaStoredPath(notaFiscalArquivo, { userId: user.id })
    ) {
      throw new AppError(400, "Arquivo de nota fiscal inválido");
    }
  }

  const anexos = input.anexos || [];
  for (const a of anexos) {
    const okDoc = isValidUploadPath(a.arquivo, "documento", user.id);
    const okNf = isValidUploadPath(a.arquivo, "nota-fiscal", user.id);
    const okRma = isValidRmaStoredPath(a.arquivo, { userId: user.id });
    if (!okDoc && !okNf && !okRma) {
      throw new AppError(400, `Anexo inválido (${a.tipo})`);
    }
  }
  // Termo de comodato (requerTermoComodato): opcional no lançamento —
  // costuma voltar assinado depois; anexa em Movimentações.

  let movimentacaoOrigemId: string | null = null;
  if (tipo.ehRetornoDeId) {
    if (!input.movimentacaoOrigemId) {
      throw new AppError(
        400,
        "Selecione a saída aberta vinculada a este retorno"
      );
    }
    if (!input.clienteId) {
      throw new AppError(400, "Cliente obrigatório para retorno vinculado");
    }
    const nfNum = input.notaFiscalNumero?.trim() || "";
    if (!nfNum) {
      throw new AppError(400, "Informe o número da NF de retorno");
    }
    if (!input.notaFiscalArquivo) {
      throw new AppError(400, "Anexe o arquivo da NF de retorno");
    }
    if (
      !isValidUploadPath(input.notaFiscalArquivo, "nota-fiscal", user.id) &&
      !isValidRmaStoredPath(input.notaFiscalArquivo, { userId: user.id })
    ) {
      throw new AppError(400, "Arquivo de nota fiscal inválido");
    }
    movimentacaoOrigemId = input.movimentacaoOrigemId;
  } else if (input.movimentacaoOrigemId) {
    throw new AppError(400, "Este tipo não aceita vínculo com saída");
  }

  const preco =
    input.precoUnitario !== undefined &&
    (user.perfil === "ADMIN" || user.perfil === "GERENTE")
      ? input.precoUnitario
      : Number(produto.precoUnitario);

  const pendente =
    user.perfil === "OPERADOR" && tipo.requerAprovacao === true;
  if (tipo.baixaPorArvore && pendente) {
    throw new AppError(
      400,
      "Baixa pela árvore não pode ficar pendente de aprovação — desative a aprovação no tipo ou use perfil Gerente/Admin"
    );
  }
  const status = pendente ? "PENDENTE" : "CONCLUIDO";
  const operacao = tipo.operacao as "ENTRADA" | "SAIDA";

  let quantidade = Number(input.quantidade!);
  let seriesNorm = normalizarSeries(input.series);
  if (produto.controlaSerie) {
    if (seriesNorm.length === 0) {
      throw new AppError(
        400,
        "Produto exige número(s) de série — informe series[]"
      );
    }
    quantidade = seriesNorm.length;
  } else {
    seriesNorm = [];
  }

  /** Componentes saem do mesmo estoque da SAIDA. */
  let filialComponentesId: string | null = null;
  if (tipo.baixaPorArvore) {
    if (operacao !== "SAIDA") {
      throw new AppError(
        400,
        "Baixa pela árvore só se aplica a tipos de Saída ou Transferência"
      );
    }
    if (tipo.ehRetornoDeId) {
      throw new AppError(
        400,
        "Tipo com baixa pela árvore não pode ser retorno vinculado"
      );
    }
    if (produto.controlaSerie) {
      throw new AppError(
        400,
        "Produto com série ainda não pode usar baixa pela árvore — use um produto sem série"
      );
    }
    const bom = await carregarBomProduto(prisma, input.produtoId!);
    const consumo = linhasConsumoMontagem(bom, quantidade);
    if (consumo.length === 0) {
      throw new AppError(
        400,
        "Árvore sem componentes que baixem estoque (só fantasmas). Inclua ao menos um componente não-fantasma."
      );
    }
    filialComponentesId = filialId;
    await assertSaldoComponentes(prisma, {
      filialComponentesId,
      consumo,
    });
  } else if (input.filialComponentesId) {
    throw new AppError(
      400,
      "filialComponentesId não é aceito neste tipo de lançamento"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    let alertaEstoqueMinimo = false;
    let alertaEstoqueMaximo = false;
    let saldoAtual: number | undefined;

    if (movimentacaoOrigemId) {
      await tx.$queryRaw`SELECT id FROM movimentacoes WHERE id = ${movimentacaoOrigemId}::uuid FOR UPDATE`;
      const origem = await tx.movimentacao.findFirst({
        where: {
          id: movimentacaoOrigemId,
          tipoId: tipo.ehRetornoDeId!,
          clienteId: input.clienteId!,
          status: "CONCLUIDO",
          operacao: "SAIDA",
        },
      });
      if (!origem) {
        throw new AppError(400, "Saída aberta não encontrada para este cliente");
      }
      if (origem.produtoId !== input.produtoId) {
        throw new AppError(400, "Produto deve ser o da saída vinculada");
      }
      if (origem.filialId !== filialId) {
        throw new AppError(
          400,
          "Filial do retorno deve ser a mesma da saída vinculada"
        );
      }
      const restante = await qtyRestanteSaida(tx, origem);
      if (restante <= 1e-9) {
        throw new AppError(400, "Esta saída já foi totalmente retornada");
      }
      if (quantidade > restante + 1e-9) {
        throw new AppError(
          400,
          `Quantidade de retorno não pode exceder o saldo em aberto (${restante})`
        );
      }
    }

    if (produto.controlaSerie && status === "PENDENTE") {
      if (operacao === "SAIDA") {
        await validarSeriesSaidaDisponiveis(tx, {
          produtoId: input.produtoId!,
          filialId,
          series: seriesNorm,
          quantidade,
        });
      } else if (movimentacaoOrigemId) {
        await validarSeriesRetorno(tx, {
          produtoId: input.produtoId!,
          series: seriesNorm,
          quantidade,
          movimentacaoOrigemId,
          clienteId: input.clienteId,
        });
      } else {
        await validarSeriesEntradaNovas(tx, {
          produtoId: input.produtoId!,
          series: seriesNorm,
          quantidade,
          permitirReativarSaido: false,
        });
      }
    }

    if (status === "CONCLUIDO" && !(tipo.baixaPorArvore && operacao === "SAIDA")) {
      const saldo = await aplicarEfeitoSaldo(tx, {
        produtoId: input.produtoId!,
        filialId,
        filialDestinoId: null,
        quantidade,
        operacao,
      });
      alertaEstoqueMinimo = saldo.abaixoMinimo;
      alertaEstoqueMaximo = saldo.acimaMaximo;
      saldoAtual = Number(saldo.saldoAtual);
    }

    const mov = await tx.movimentacao.create({
      data: {
        produtoId: input.produtoId!,
        tipoId: input.tipoId,
        usuarioId: user.id,
        clienteId: input.clienteId || null,
        filialId,
        filialDestinoId: null,
        filialComponentesId,
        quantidade,
        precoUnitario: preco,
        operacao,
        observacao: input.observacao || null,
        notaFiscalNumero,
        notaFiscalArquivo,
        alertaEmails: alertaEmails as Prisma.InputJsonValue,
        seriesInformadas:
          produto.controlaSerie && status === "PENDENTE"
            ? (seriesNorm as Prisma.InputJsonValue)
            : ([] as Prisma.InputJsonValue),
        movimentacaoOrigemId,
        grupoLancamentoId: input.grupoLancamentoId || null,
        status,
        anexos:
          anexos.length > 0
            ? {
                create: anexos.map((a) => ({
                  tipo: a.tipo,
                  arquivo: a.arquivo,
                  label: a.label || null,
                })),
              }
            : undefined,
      },
      include: movInclude,
    });

    if (produto.controlaSerie && status === "CONCLUIDO") {
      if (movimentacaoOrigemId) {
        await aplicarSeriesRetorno(tx, {
          movimentacaoId: mov.id,
          produtoId: input.produtoId!,
          filialId,
          series: seriesNorm,
          quantidade,
          movimentacaoOrigemId,
          clienteId: input.clienteId,
        });
      } else if (operacao === "ENTRADA") {
        await aplicarSeriesEntrada(tx, {
          movimentacaoId: mov.id,
          produtoId: input.produtoId!,
          filialId,
          series: seriesNorm,
          quantidade,
          permitirReativarSaido: input.permitirReativarSaido === true,
        });
      } else {
        await aplicarSeriesSaida(tx, {
          movimentacaoId: mov.id,
          produtoId: input.produtoId!,
          filialId,
          series: seriesNorm,
          quantidade,
          clienteId: input.clienteId,
        });
      }
    }

    if (
      tipo.baixaPorArvore &&
      status === "CONCLUIDO" &&
      operacao === "SAIDA"
    ) {
      if (filialComponentesId) {
        await aplicarConsumoMontagem(tx, {
          montagemMovimentacaoId: mov.id,
          usuarioId: user.id,
          filialComponentesId,
          quantidadeMontada: quantidade,
          produtoPaiId: input.produtoId!,
          observacao: input.observacao,
        });
      } else {
        // BOM só fantasma: valida árvore mesmo sem consumo
        const bom = await carregarBomProduto(tx, input.produtoId!);
        linhasConsumoMontagem(bom, quantidade);
      }
    }

    if (tipo.geraAlertaRetorno && status === "CONCLUIDO") {
      await agendarAlertasRetorno(tx, {
        movimentacaoId: mov.id,
        dataMovimento: mov.dataMovimento,
        diasAlerta: tipo.diasAlerta,
        emails: alertaEmails,
      });
    }

    if (movimentacaoOrigemId && status === "CONCLUIDO") {
      await syncAlertasAposRetorno(tx, movimentacaoOrigemId);
    }

    const movFinal = await tx.movimentacao.findUniqueOrThrow({
      where: { id: mov.id },
      include: movInclude,
    });

    return {
      movimentacao: movFinal,
      alertaEstoqueMinimo,
      alertaEstoqueMaximo,
      saldoAtual,
    };
  });

  const produtoLabel = `${result.movimentacao.produto.codigo} (${result.movimentacao.produto.descricao})`;
  if (result.alertaEstoqueMinimo || result.alertaEstoqueMaximo) {
    notificarLimiaresEstoque({
      abaixoMinimo: result.alertaEstoqueMinimo,
      acimaMaximo: result.alertaEstoqueMaximo,
      produtoCodigo: result.movimentacao.produto.codigo,
      produtoDescricao: result.movimentacao.produto.descricao,
      filialNome: result.movimentacao.filial.nome,
      saldoAtual: result.saldoAtual,
    });
  }

  return {
    fluxo: "LANCAMENTO" as const,
    movimentacao: result.movimentacao,
    alertaEstoqueMinimo: result.alertaEstoqueMinimo,
    alertaEstoqueMaximo: result.alertaEstoqueMaximo,
    alertas: alertasUiDeLimiares({
      abaixoMinimo: result.alertaEstoqueMinimo,
      acimaMaximo: result.alertaEstoqueMaximo,
      produtoLabel,
    }),
  };
}

/** F6: PENDENTE → CONCLUIDO + aplica saldo */
export async function aprovarMovimentacao(user: AuthUser, id: string) {
  requireGerenteOuAdmin(user);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM movimentacoes WHERE id = ${id}::uuid FOR UPDATE`;
    const mov = await tx.movimentacao.findUnique({
      where: { id },
      include: { tipo: true, produto: true },
    });
    if (!mov) throw new AppError(404, "Movimentação não encontrada");
    if (mov.status !== "PENDENTE") {
      throw new AppError(400, "Só é possível aprovar movimentos PENDENTE");
    }

    // Lock origem antes do estoque (mesma ordem do create — evita deadlock)
    if (mov.movimentacaoOrigemId) {
      await tx.$queryRaw`SELECT id FROM movimentacoes WHERE id = ${mov.movimentacaoOrigemId}::uuid FOR UPDATE`;
      const origem = await tx.movimentacao.findFirst({
        where: {
          id: mov.movimentacaoOrigemId,
          status: "CONCLUIDO",
          operacao: "SAIDA",
        },
      });
      if (!origem) {
        throw new AppError(400, "Saída vinculada não está disponível");
      }
      if (mov.tipo.ehRetornoDeId && origem.tipoId !== mov.tipo.ehRetornoDeId) {
        throw new AppError(400, "Saída vinculada não corresponde ao tipo de retorno");
      }
      if (origem.clienteId !== mov.clienteId) {
        throw new AppError(400, "Cliente do retorno deve ser o da saída vinculada");
      }
      if (origem.produtoId !== mov.produtoId) {
        throw new AppError(400, "Produto deve ser o da saída vinculada");
      }
      if (origem.filialId !== mov.filialId) {
        throw new AppError(
          400,
          "Filial do retorno deve ser a mesma da saída vinculada"
        );
      }
      const restante = await qtyRestanteSaida(tx, origem, mov.id);
      if (Number(mov.quantidade) > restante + 1e-9) {
        throw new AppError(
          400,
          `Quantidade de retorno não pode exceder o saldo em aberto (${restante})`
        );
      }
    }

    const saidaArvore = mov.tipo.baixaPorArvore && mov.operacao === "SAIDA";
    const saldo = saidaArvore
      ? { abaixoMinimo: false, acimaMaximo: false, saldoAtual: 0 }
      : await aplicarEfeitoSaldo(tx, mov);

    const seriesPend = Array.isArray(mov.seriesInformadas)
      ? (mov.seriesInformadas as string[])
      : [];

    if (mov.produto.controlaSerie && !saidaArvore) {
      const qtd = Number(mov.quantidade);
      if (mov.movimentacaoOrigemId) {
        await aplicarSeriesRetorno(tx, {
          movimentacaoId: mov.id,
          produtoId: mov.produtoId,
          filialId: mov.filialId,
          series: seriesPend,
          quantidade: qtd,
          movimentacaoOrigemId: mov.movimentacaoOrigemId,
          clienteId: mov.clienteId,
        });
      } else if (mov.operacao === "ENTRADA") {
        await aplicarSeriesEntrada(tx, {
          movimentacaoId: mov.id,
          produtoId: mov.produtoId,
          filialId: mov.filialId,
          series: seriesPend,
          quantidade: qtd,
          permitirReativarSaido: false,
        });
      } else if (mov.operacao === "SAIDA") {
        await aplicarSeriesSaida(tx, {
          movimentacaoId: mov.id,
          produtoId: mov.produtoId,
          filialId: mov.filialId,
          series: seriesPend,
          quantidade: qtd,
          clienteId: mov.clienteId,
          excludeMovimentacaoId: mov.id,
        });
      }
    }

    if (saidaArvore) {
      await aplicarConsumoMontagem(tx, {
        montagemMovimentacaoId: mov.id,
        usuarioId: user.id,
        filialComponentesId: mov.filialId,
        quantidadeMontada: Number(mov.quantidade),
        produtoPaiId: mov.produtoId,
        observacao: mov.observacao,
      });
    }

    const updated = await tx.movimentacao.update({
      where: { id },
      data: {
        status: "CONCLUIDO",
        seriesInformadas: [] as Prisma.InputJsonValue,
      },
      include: { ...movInclude, tipo: true },
    });

    if (updated.tipo.geraAlertaRetorno) {
      const emails = Array.isArray(updated.alertaEmails)
        ? (updated.alertaEmails as string[])
        : [];
      await agendarAlertasRetorno(tx, {
        movimentacaoId: updated.id,
        dataMovimento: updated.dataMovimento,
        diasAlerta: updated.tipo.diasAlerta,
        emails,
      });
    }
    if (updated.movimentacaoOrigemId) {
      await syncAlertasAposRetorno(tx, updated.movimentacaoOrigemId);
    }

    return {
      movimentacao: updated,
      alertaEstoqueMinimo: saldo.abaixoMinimo,
      alertaEstoqueMaximo: saldo.acimaMaximo,
      saldoAtual: Number(saldo.saldoAtual),
    };
  });

  const produtoLabel = `${result.movimentacao.produto.codigo} (${result.movimentacao.produto.descricao})`;
  if (result.alertaEstoqueMinimo || result.alertaEstoqueMaximo) {
    notificarLimiaresEstoque({
      abaixoMinimo: result.alertaEstoqueMinimo,
      acimaMaximo: result.alertaEstoqueMaximo,
      produtoCodigo: result.movimentacao.produto.codigo,
      produtoDescricao: result.movimentacao.produto.descricao,
      filialNome: result.movimentacao.filial.nome,
      saldoAtual: result.saldoAtual,
    });
  }

  return {
    movimentacao: result.movimentacao,
    alertaEstoqueMinimo: result.alertaEstoqueMinimo,
    alertaEstoqueMaximo: result.alertaEstoqueMaximo,
    alertas: alertasUiDeLimiares({
      abaixoMinimo: result.alertaEstoqueMinimo,
      acimaMaximo: result.alertaEstoqueMaximo,
      produtoLabel,
    }),
  };
}

/** F6: PENDENTE → REJEITADO (sem mexer saldo) */
export async function rejeitarMovimentacao(
  user: AuthUser,
  id: string,
  motivo?: string,
  opts?: { bypassPerfil?: boolean }
) {
  if (!opts?.bypassPerfil) {
    requireGerenteOuAdmin(user);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM movimentacoes WHERE id = ${id}::uuid FOR UPDATE`;
    const mov = await tx.movimentacao.findUnique({ where: { id } });
    if (!mov) throw new AppError(404, "Movimentação não encontrada");
    if (mov.status !== "PENDENTE") {
      throw new AppError(400, "Só é possível rejeitar movimentos PENDENTE");
    }

    if (mov.movimentacaoOrigemId) {
      await tx.$queryRaw`SELECT id FROM movimentacoes WHERE id = ${mov.movimentacaoOrigemId}::uuid FOR UPDATE`;
    }

    const obs = [mov.observacao, motivo ? `Rejeitado: ${motivo}` : "Rejeitado"]
      .filter(Boolean)
      .join(" | ");

    const updated = await tx.movimentacao.update({
      where: { id },
      data: { status: "REJEITADO", observacao: obs },
      include: movInclude,
    });

    // Libera qty ocupada; reabre alertas se a saída voltou a ficar em aberto
    if (mov.movimentacaoOrigemId) {
      await syncAlertasAposLiberacaoSaida(tx, mov.movimentacaoOrigemId);
    }

    return { movimentacao: updated };
  });
}

/** F6: gera movimento inverso CONCLUIDO; original → ESTORNADO */
export async function estornarMovimentacao(
  user: AuthUser,
  id: string,
  observacao?: string | null,
  opts?: { bypassPerfil?: boolean }
) {
  if (!opts?.bypassPerfil) {
    requireGerenteOuAdmin(user);
  }

  const tipoEstorno = await prisma.tipoMovimentacao.findUnique({
    where: { nome: TIPO_ESTORNO },
  });
  if (!tipoEstorno) throw new AppError(500, "Tipo Estorno não configurado");

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM movimentacoes WHERE id = ${id}::uuid FOR UPDATE`;
    const mov = await tx.movimentacao.findUnique({
      where: { id },
      include: {
        estornos: true,
        produto: true,
        tipo: true,
      },
    });
    if (!mov) throw new AppError(404, "Movimentação não encontrada");

    if (mov.status !== "CONCLUIDO") {
      throw new AppError(400, "Só é possível estornar movimentos CONCLUIDO");
    }
    if (mov.estornoDeId) {
      throw new AppError(400, "Não é possível estornar um estorno");
    }
    if (mov.estornos.length > 0) {
      throw new AppError(400, "Movimentação já possui estorno");
    }

    if (mov.movimentacaoMontagemId) {
      throw new AppError(
        400,
        "Esta baixa de componente faz parte de uma árvore. Estorne a saída ou cancele a transferência que a originou."
      );
    }

    // D28 + F8: movimentos de transferência só revertem pelo fluxo da carga (cancelar)
    if (mov.transferenciaItemId) {
      throw new AppError(
        400,
        "Não é possível estornar movimento de transferência por aqui. Use Cancelar na carga (se em trânsito) ou trate a divergência na conferência."
      );
    }

    // Saída com retorno ativo: estornar retornos primeiro (evita inflar estoque)
    if (await saidaTemRetornoAtivo(tx, mov.id)) {
      throw new AppError(
        400,
        "Não é possível estornar esta saída: há retorno vinculado (concluído ou pendente). Estorne os retornos primeiro."
      );
    }

    // Estorno de retorno: lock origem antes do estoque (ordem consistente)
    if (mov.movimentacaoOrigemId) {
      await tx.$queryRaw`SELECT id FROM movimentacoes WHERE id = ${mov.movimentacaoOrigemId}::uuid FOR UPDATE`;
    }

    // Baixa por árvore: primeiro devolve componentes ao estoque de origem
    const consumos = await tx.movimentacao.findMany({
      where: {
        movimentacaoMontagemId: mov.id,
        status: "CONCLUIDO",
        estornoDeId: null,
      },
      include: { produto: true, estornos: true },
    });
    for (const cons of consumos) {
      if (cons.estornos.length > 0) continue;
      await aplicarEfeitoSaldo(tx, cons, true);
      await tx.movimentacao.create({
        data: {
          produtoId: cons.produtoId,
          tipoId: tipoEstorno.id,
          usuarioId: user.id,
          filialId: cons.filialId,
          quantidade: cons.quantidade,
          precoUnitario: cons.precoUnitario,
          operacao: "ENTRADA",
          status: "CONCLUIDO",
          estornoDeId: cons.id,
          movimentacaoMontagemId: mov.id,
          observacao: `Estorno — devolve componente da árvore ${cons.id.slice(0, 8)}`,
        },
      });
      await tx.movimentacao.update({
        where: { id: cons.id },
        data: { status: "ESTORNADO" },
      });
    }

    // SAIDA com árvore não debitou o pai — só reverte componentes (acima).
    // Usa a flag do tipo (não a qtd de consumos): BOM só-fantasma também não debita o pai.
    const saidaSoArvore =
      mov.operacao === "SAIDA" && mov.tipo.baixaPorArvore === true;

    const saldo = saidaSoArvore
      ? { abaixoMinimo: false, acimaMaximo: false, saldoAtual: 0 }
      : await aplicarEfeitoSaldo(tx, mov, true);

    let operacaoEstorno: string;
    if (mov.operacao === "TRANSFERENCIA") {
      operacaoEstorno = "TRANSFERENCIA";
    } else if (mov.operacao === "ENTRADA") {
      operacaoEstorno = "SAIDA";
    } else {
      operacaoEstorno = "ENTRADA";
    }

    const estorno = await tx.movimentacao.create({
      data: {
        produtoId: mov.produtoId,
        tipoId: tipoEstorno.id,
        usuarioId: user.id,
        clienteId: mov.clienteId,
        filialId: mov.filialId,
        filialDestinoId: mov.filialDestinoId,
        quantidade: mov.quantidade,
        precoUnitario: mov.precoUnitario,
        operacao: operacaoEstorno,
        observacao:
          observacao || `Estorno do movimento ${mov.id.slice(0, 8)}`,
        status: "CONCLUIDO",
        estornoDeId: mov.id,
      },
      include: movInclude,
    });

    if (
      !saidaSoArvore &&
      mov.produto.controlaSerie &&
      (mov.operacao === "ENTRADA" || mov.operacao === "SAIDA")
    ) {
      await aplicarSeriesEstorno(tx, {
        movimentacaoOriginalId: mov.id,
        estornoId: estorno.id,
        operacaoOriginal: mov.operacao,
        filialId: mov.filialId,
        clienteId: mov.clienteId,
      });
    }

    await tx.movimentacao.update({
      where: { id: mov.id },
      data: { status: "ESTORNADO" },
    });

    await cancelarAlertasRetornoPendentes(tx, mov.id);

    // Estorno de retorno: reabre/cancela alertas conforme qty CONCLUIDO restante
    if (mov.movimentacaoOrigemId) {
      await syncAlertasAposLiberacaoSaida(tx, mov.movimentacaoOrigemId);
    }

    const estornoFinal = await tx.movimentacao.findUniqueOrThrow({
      where: { id: estorno.id },
      include: movInclude,
    });

    return {
      movimentacao: estornoFinal,
      alertaEstoqueMinimo: saldo.abaixoMinimo,
      alertaEstoqueMaximo: saldo.acimaMaximo,
      saldoAtual: Number(saldo.saldoAtual),
    };
  });

  const produtoLabel = `${result.movimentacao.produto.codigo} (${result.movimentacao.produto.descricao})`;
  if (result.alertaEstoqueMinimo || result.alertaEstoqueMaximo) {
    notificarLimiaresEstoque({
      abaixoMinimo: result.alertaEstoqueMinimo,
      acimaMaximo: result.alertaEstoqueMaximo,
      produtoCodigo: result.movimentacao.produto.codigo,
      produtoDescricao: result.movimentacao.produto.descricao,
      filialNome: result.movimentacao.filial.nome,
      saldoAtual: result.saldoAtual,
    });
  }

  return {
    movimentacao: result.movimentacao,
    alertaEstoqueMinimo: result.alertaEstoqueMinimo,
    alertaEstoqueMaximo: result.alertaEstoqueMaximo,
    alertas: alertasUiDeLimiares({
      abaixoMinimo: result.alertaEstoqueMinimo,
      acimaMaximo: result.alertaEstoqueMaximo,
      produtoLabel,
    }),
  };
}

export async function inicializarEstoque(
  user: AuthUser,
  input: {
    filialId: string;
    itens: Array<{ produtoId: string; saldo: number; series?: string[] }>;
    confirmarReinit?: boolean;
  }
) {
  if (user.perfil === "OPERADOR") {
    throw new AppError(403, "Operador não pode inicializar estoque");
  }

  const filial = await prisma.filial.findFirst({
    where: { id: input.filialId, ativo: true },
  });
  if (!filial) throw new AppError(400, "Filial inválida");

  const tipoInventario = await prisma.tipoMovimentacao.findUnique({
    where: { nome: TIPO_INVENTARIO },
  });
  const tipoAjustePos = await prisma.tipoMovimentacao.findUnique({
    where: { nome: TIPO_AJUSTE_POS },
  });
  const tipoAjusteNeg = await prisma.tipoMovimentacao.findUnique({
    where: { nome: TIPO_AJUSTE_NEG },
  });
  if (!tipoInventario || !tipoAjustePos || !tipoAjusteNeg) {
    throw new AppError(500, "Tipos de movimentação não configurados");
  }

  const result = await prisma.$transaction(async (tx) => {
    const resultados: Array<{ produtoId: string; acao: string }> = [];
    const limiares: Array<{
      produtoCodigo: string;
      produtoDescricao: string;
      saldoAtual: number;
      abaixoMinimo: boolean;
      acimaMaximo: boolean;
    }> = [];

    function registrarLimiar(
      produto: { codigo: string; descricao: string; estoqueMinimo: number; estoqueMaximo: number },
      saldoAtual: number,
      flags?: { abaixoMinimo: boolean; acimaMaximo: boolean }
    ) {
      const abaixoMinimo =
        flags?.abaixoMinimo ??
        isAbaixoMinimo(saldoAtual, produto.estoqueMinimo);
      const acimaMaximo =
        flags?.acimaMaximo ?? isAcimaMaximo(saldoAtual, produto.estoqueMaximo);
      if (!abaixoMinimo && !acimaMaximo) return;
      limiares.push({
        produtoCodigo: produto.codigo,
        produtoDescricao: produto.descricao,
        saldoAtual,
        abaixoMinimo,
        acimaMaximo,
      });
    }

    for (const item of input.itens) {
      const produto = await tx.produto.findFirst({
        where: { id: item.produtoId, ativo: true },
      });
      if (!produto) throw new AppError(400, `Produto inválido: ${item.produtoId}`);

      const seriesNorm = produto.controlaSerie
        ? normalizarSeries(item.series)
        : [];

      const atual = await tx.estoque.findUnique({
        where: {
          uniq_produto_filial: {
            produtoId: item.produtoId,
            filialId: input.filialId,
          },
        },
      });

      const saldoAtual = atual ? Number(atual.saldoAtual) : 0;
      const alvo = item.saldo;

      if (produto.controlaSerie && alvo > 0 && !Number.isInteger(alvo)) {
        throw new AppError(
          400,
          `Produto ${produto.codigo}: saldo com série deve ser inteiro`
        );
      }

      if (!atual) {
        if (alvo === 0) {
          await tx.estoque.create({
            data: {
              produtoId: item.produtoId,
              filialId: input.filialId,
              saldoAtual: 0,
            },
          });
          resultados.push({ produtoId: item.produtoId, acao: "zero" });
          registrarLimiar(produto, 0);
          continue;
        }
        if (produto.controlaSerie && seriesNorm.length !== alvo) {
          throw new AppError(
            400,
            `Produto ${produto.codigo}: informe ${alvo} número(s) de série`
          );
        }
        const saldo = await aplicarSaldo(tx, {
          produtoId: item.produtoId,
          filialId: input.filialId,
          operacao: "ENTRADA",
          quantidade: alvo,
        });
        const mov = await tx.movimentacao.create({
          data: {
            produtoId: item.produtoId,
            tipoId: tipoInventario.id,
            usuarioId: user.id,
            filialId: input.filialId,
            quantidade: alvo,
            precoUnitario: produto.precoUnitario,
            operacao: "ENTRADA",
            status: "CONCLUIDO",
            observacao: "Inicialização de estoque",
          },
        });
        if (produto.controlaSerie) {
          await aplicarSeriesInventario(tx, {
            movimentacaoId: mov.id,
            produtoId: item.produtoId,
            filialId: input.filialId,
            series: seriesNorm,
            quantidade: alvo,
          });
        }
        resultados.push({ produtoId: item.produtoId, acao: "inventario" });
        registrarLimiar(produto, Number(saldo.saldoAtual), saldo);
        continue;
      }

      if (saldoAtual === alvo) {
        resultados.push({ produtoId: item.produtoId, acao: "inalterado" });
        continue;
      }

      if (!input.confirmarReinit) {
        throw new AppError(
          409,
          `Produto ${produto.codigo} já possui saldo ${saldoAtual}. Envie confirmarReinit=true para ajustar.`
        );
      }

      const delta = alvo - saldoAtual;
      const tipo = delta > 0 ? tipoAjustePos : tipoAjusteNeg;
      const operacao = delta > 0 ? "ENTRADA" : "SAIDA";
      const qtd = Math.abs(delta);

      if (produto.controlaSerie) {
        if (seriesNorm.length !== qtd) {
          throw new AppError(
            400,
            `Produto ${produto.codigo}: informe ${qtd} série(s) para o ajuste (Δ=${delta})`
          );
        }
      }

      const saldo = await aplicarSaldo(tx, {
        produtoId: item.produtoId,
        filialId: input.filialId,
        operacao,
        quantidade: qtd,
      });
      const mov = await tx.movimentacao.create({
        data: {
          produtoId: item.produtoId,
          tipoId: tipo.id,
          usuarioId: user.id,
          filialId: input.filialId,
          quantidade: qtd,
          precoUnitario: produto.precoUnitario,
          operacao,
          status: "CONCLUIDO",
          observacao: `Reinicialização de estoque (ajuste Δ=${delta})`,
        },
      });
      if (produto.controlaSerie) {
        if (operacao === "ENTRADA") {
          await aplicarSeriesEntrada(tx, {
            movimentacaoId: mov.id,
            produtoId: item.produtoId,
            filialId: input.filialId,
            series: seriesNorm,
            quantidade: qtd,
            permitirReativarSaido: false,
          });
        } else {
          await aplicarSeriesSaida(tx, {
            movimentacaoId: mov.id,
            produtoId: item.produtoId,
            filialId: input.filialId,
            series: seriesNorm,
            quantidade: qtd,
          });
        }
      }
      resultados.push({ produtoId: item.produtoId, acao: "ajuste" });
      registrarLimiar(produto, Number(saldo.saldoAtual), saldo);
    }

    return { resultados, limiares };
  });

  const alertas: AlertaUi[] = [];
  for (const a of result.limiares) {
    notificarLimiaresEstoque({
      abaixoMinimo: a.abaixoMinimo,
      acimaMaximo: a.acimaMaximo,
      produtoCodigo: a.produtoCodigo,
      produtoDescricao: a.produtoDescricao,
      filialNome: filial.nome,
      saldoAtual: a.saldoAtual,
    });
    alertas.push(
      ...alertasUiDeLimiares({
        abaixoMinimo: a.abaixoMinimo,
        acimaMaximo: a.acimaMaximo,
        produtoLabel: `${a.produtoCodigo} (${a.produtoDescricao})`,
      })
    );
  }

  return { resultados: result.resultados, alertas };
}

/**
 * Saídas abertas de um tipo origem (ehRetornoDe) + cliente,
 * com qty restante > 0 (descontando CONCLUIDO+PENDENTE).
 */
export async function listarSaidasAbertas(opts: {
  tipoOrigemId: string;
  clienteId: string;
  /** Se informado, restringe à filial (ex.: operador). */
  filialId?: string | null;
  /** Filiais permitidas ao operador (se setado, filtra). */
  filialIdsPermitidas?: string[] | null;
}) {
  const filialFilter =
    opts.filialId ||
    (opts.filialIdsPermitidas && opts.filialIdsPermitidas.length > 0
      ? { in: opts.filialIdsPermitidas }
      : undefined);

  const where = {
    tipoId: opts.tipoOrigemId,
    clienteId: opts.clienteId,
    status: "CONCLUIDO" as const,
    operacao: "SAIDA" as const,
    ...(filialFilter ? { filialId: filialFilter } : {}),
  };

  const include = {
    produto: {
      select: {
        id: true,
        codigo: true,
        descricao: true,
        controlaSerie: true,
        precoUnitario: true,
      },
    },
    filial: { select: { id: true, sigla: true, nome: true } },
    tipo: { select: { id: true, nome: true } },
    cliente: { select: { id: true, nome: true } },
  };

  const abertas: Array<{
    id: string;
    dataMovimento: Date;
    quantidade: number;
    qtyRestante: number;
    notaFiscalNumero: string | null;
    produto: {
      id: string;
      codigo: string;
      descricao: string;
      controlaSerie: boolean;
      precoUnitario: Prisma.Decimal;
    };
    filial: { id: string; sigla: string; nome: string };
    tipo: { id: string; nome: string };
    cliente: { id: string; nome: string } | null;
  }> = [];

  const PAGE = 200;
  const MAX_ABERTAS = 100;
  const MAX_SCAN = 2000;
  let skip = 0;

  while (abertas.length < MAX_ABERTAS && skip < MAX_SCAN) {
    const rows = await prisma.movimentacao.findMany({
      where,
      include,
      orderBy: { dataMovimento: "desc" },
      take: PAGE,
      skip,
    });
    if (rows.length === 0) break;

    const ocupadaMap = await mapaQtyOcupadaPorSaidas(
      prisma,
      rows.map((r) => r.id)
    );

    for (const r of rows) {
      const qty = Number(r.quantidade);
      const qtyRestante = Math.max(0, qty - (ocupadaMap.get(r.id) || 0));
      if (qtyRestante <= 1e-9) continue;
      abertas.push({
        id: r.id,
        dataMovimento: r.dataMovimento,
        quantidade: qty,
        qtyRestante,
        notaFiscalNumero: r.notaFiscalNumero,
        produto: r.produto,
        filial: r.filial,
        tipo: r.tipo,
        cliente: r.cliente,
      });
      if (abertas.length >= MAX_ABERTAS) break;
    }

    skip += rows.length;
    if (rows.length < PAGE) break;
  }

  return abertas;
}

/**
 * Anexa termo de comodato a uma saída CONCLUIDA cujo tipo exige o termo
 * e ainda não tem TERMO_COMODATO.
 */
export async function anexarTermoComodato(
  user: AuthUser,
  movimentacaoId: string,
  input: { arquivo: string; label?: string | null }
) {
  if (
    !isValidUploadPath(input.arquivo, "documento", user.id) &&
    !isValidUploadPath(input.arquivo, "nota-fiscal", user.id)
  ) {
    throw new AppError(400, "Arquivo de termo inválido");
  }

  const mov = await prisma.movimentacao.findUnique({
    where: { id: movimentacaoId },
    include: {
      tipo: true,
      anexos: { select: { id: true, tipo: true } },
    },
  });
  if (!mov) throw new AppError(404, "Movimentação não encontrada");
  if (mov.operacao !== "SAIDA") {
    throw new AppError(400, "Termo só se aplica a saídas");
  }
  if (mov.status !== "CONCLUIDO") {
    throw new AppError(400, "Só é possível anexar termo em saída concluída");
  }
  if (mov.estornoDeId) {
    throw new AppError(400, "Não é possível anexar termo a um estorno");
  }
  if (!mov.tipo.requerTermoComodato) {
    throw new AppError(400, "Este tipo de saída não exige termo de comodato");
  }
  if (mov.anexos.some((a) => a.tipo === "TERMO_COMODATO")) {
    throw new AppError(400, "Esta saída já possui termo de comodato anexado");
  }

  const anexo = await prisma.movimentacaoAnexo.create({
    data: {
      movimentacaoId: mov.id,
      tipo: "TERMO_COMODATO",
      arquivo: input.arquivo,
      label: input.label?.trim() || "Termo de recebimento",
    },
  });

  return anexo;
}

export function decimalToNumber(v: Prisma.Decimal | number | null | undefined) {
  if (v == null) return 0;
  return Number(v);
}
