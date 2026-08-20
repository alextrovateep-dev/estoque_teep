import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import {
  egestorConfigured,
  egestorSyncDesde,
  listarVendasParaSync,
  obterContatoEgestor,
  obterContatoVendaEgestor,
  obterVendaEgestor,
} from "../lib/egestorClient";
import {
  linhasProdutoEgestor,
  pedidoEgestorCandidatoLista,
  pedidoEgestorNaJanela,
  pedidoEgestorQualifica,
  pedidoTemProdutoEgestor,
} from "../lib/egestorPedidoRules";
import {
  clienteIdPorDocumento,
  indexClientesPorCnpj,
  interpretarDocumentoContatoEgestor,
} from "../lib/pedidoClienteMatch";

function parseDate(v: string | undefined): Date {
  const s = String(v || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00.000Z`);
  return new Date();
}

type SyncResult = {
  upserted: number;
  removed: number;
  skipped: number;
};

let inflight: Promise<SyncResult> | null = null;

export async function syncPedidosEgestor(): Promise<SyncResult> {
  if (inflight) return inflight;
  inflight = runSyncPedidosEgestor().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runSyncPedidosEgestor(): Promise<SyncResult> {
  if (!egestorConfigured()) {
    console.log("[egestorSync] sem EGESTOR_PERSONAL_TOKEN — ignorado");
    return { upserted: 0, removed: 0, skipped: 0 };
  }

  const listed = await listarVendasParaSync();
  const desde = egestorSyncDesde();
  const candidatos = listed.filter(
    (r) => pedidoEgestorCandidatoLista(r) && pedidoEgestorNaJanela(r, desde)
  );

  const separados = await prisma.pedidoVenda.findMany({
    where: { status: "SEPARADO" },
    select: { egestorCodigo: true },
  });
  const separadosSet = new Set(separados.map((s) => s.egestorCodigo));

  let upserted = 0;
  let skipped = 0;
  const produtos = await prisma.produto.findMany({
    where: { ativo: true },
    select: { id: true, codigo: true },
  });
  const produtoByCodigo = new Map(
    produtos.map((p) => [p.codigo.trim().toLowerCase(), p.id])
  );

  const clientes = await prisma.cliente.findMany({
    where: { ativo: true, documento: { not: null } },
    select: { id: true, documento: true, ativo: true },
  });
  const clienteByCnpj = indexClientesPorCnpj(clientes);

  /** Cache: codContato eGestor → CNPJ normalizado (ou null). */
  const contatoDocCache = new Map<number, string | null>();

  async function resolverDocumentoContato(
    codContato: number | null,
    codigoVenda: number
  ): Promise<string | null> {
    if (codContato && contatoDocCache.has(codContato)) {
      return contatoDocCache.get(codContato) ?? null;
    }
    const contato = codContato
      ? await obterContatoEgestor(codContato)
      : await obterContatoVendaEgestor(codigoVenda);
    const { documentoContato } = interpretarDocumentoContatoEgestor(
      contato?.cpfcnpj
    );
    if (codContato) contatoDocCache.set(codContato, documentoContato);
    return documentoContato;
  }

  const keepProductCodes = new Set<number>();

  for (const summary of candidatos) {
    const codigo = Number(summary.codigo);
    if (!codigo) continue;
    if (separadosSet.has(codigo)) {
      skipped += 1;
      continue;
    }

    const detalhe = await obterVendaEgestor(codigo);
    const situacao = Number(detalhe.summary.situacao ?? summary.situacao ?? 10);
    const situacaoOs =
      String(detalhe.summary.situacaoOS ?? summary.situacaoOS ?? "").trim() ||
      null;
    if (
      !pedidoEgestorQualifica({ situacao, situacaoOS: situacaoOs }) ||
      !pedidoEgestorNaJanela(
        {
          dtVenda: detalhe.summary.dtVenda || summary.dtVenda,
          dtCad: detalhe.summary.dtCad || summary.dtCad,
        },
        desde
      )
    ) {
      skipped += 1;
      continue;
    }
    const linhas = linhasProdutoEgestor(detalhe.produtos);
    if (!pedidoTemProdutoEgestor(detalhe.produtos)) {
      skipped += 1;
      continue;
    }
    keepProductCodes.add(codigo);

    const nomeContato =
      detalhe.summary.nomeContato || summary.nomeContato || "Cliente";
    const dtVenda = parseDate(detalhe.summary.dtVenda || summary.dtVenda);
    const valorTotal = Number(
      detalhe.summary.valorTotal ?? summary.valorTotal ?? 0
    );
    const codContato =
      detalhe.summary.codContato ?? summary.codContato ?? null;

    const documentoContato = await resolverDocumentoContato(
      codContato != null ? Number(codContato) : null,
      codigo
    );
    const clienteId = clienteIdPorDocumento(clienteByCnpj, documentoContato);

    const existing = await prisma.pedidoVenda.findUnique({
      where: { egestorCodigo: codigo },
    });

    const pedidoId = existing?.id || randomUUID();
    await prisma.pedidoVenda.upsert({
      where: { egestorCodigo: codigo },
      create: {
        id: pedidoId,
        egestorCodigo: codigo,
        nomeContato,
        codContato,
        documentoContato,
        clienteId,
        dtVenda,
        situacao,
        situacaoOs,
        valorTotal,
        status: "ABERTO",
        syncedAt: new Date(),
      },
      update: {
        nomeContato,
        codContato,
        documentoContato,
        clienteId,
        dtVenda,
        situacao,
        situacaoOs,
        valorTotal,
        syncedAt: new Date(),
      },
    });

    await prisma.pedidoVendaItem.deleteMany({ where: { pedidoId } });
    await prisma.pedidoVendaItem.createMany({
      data: linhas.map((l, idx) => {
        const codigoProprio = String(l.codigoProprio || "").trim() || "SEM-SKU";
        const produtoId =
          produtoByCodigo.get(codigoProprio.toLowerCase()) || null;
        return {
          pedidoId,
          egestorItemCodigo: l.codigo != null ? Number(l.codigo) : idx + 1,
          codigoProprio: codigoProprio.slice(0, 80),
          descricao: String(l.descricao || codigoProprio).slice(0, 200),
          quantidade: Number(l.quant || 0) || 0,
          produtoId,
        };
      }),
    });
    upserted += 1;
  }

  const abertos = await prisma.pedidoVenda.findMany({
    where: { status: "ABERTO" },
    select: { id: true, egestorCodigo: true },
  });
  let removed = 0;
  for (const row of abertos) {
    if (!keepProductCodes.has(row.egestorCodigo)) {
      await prisma.pedidoVenda.delete({ where: { id: row.id } });
      removed += 1;
    }
  }

  return { upserted, removed, skipped };
}
