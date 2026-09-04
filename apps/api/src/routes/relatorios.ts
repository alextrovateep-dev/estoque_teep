import { Router } from "express";
import {
  authenticate,
  requireFilialOperador,
  AuthedRequest,
} from "../middleware/auth";
import { requirePermissao } from "../middleware/permissoes";
import { requireEstoqueParaOperar } from "../lib/estoqueGate";
import {
  carregarSaldosExport,
  exportarSaldosExcel,
  exportarSaldosPdf,
  type AlertaFiltro,
} from "../services/saldosExportService";
import {
  carregarProdutosExport,
  exportarProdutosExcel,
  exportarProdutosPdf,
} from "../services/produtosExportService";
import {
  carregarArvoreExport,
  exportarArvoreExcel,
  exportarArvorePdf,
} from "../services/arvoreExportService";

export const relatoriosRouter = Router();

relatoriosRouter.use(
  authenticate,
  requireFilialOperador,
  requireEstoqueParaOperar,
  requirePermissao("relatorios")
);

function parseAlerta(raw: unknown): AlertaFiltro | undefined {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "min" || v === "max" || v === "qualquer") return v;
  return undefined;
}

function parseSaldosQuery(req: AuthedRequest) {
  return {
    filialId: req.query.filialId ? String(req.query.filialId) : undefined,
    q: req.query.q ? String(req.query.q) : undefined,
    categoriaId: req.query.categoriaId
      ? String(req.query.categoriaId)
      : undefined,
    alerta: parseAlerta(req.query.alerta),
    soAlertas:
      req.query.soAlertas === "1" ||
      req.query.soAlertas === "true" ||
      req.query.soAlertas === "yes",
  };
}

function parseProdutosQuery(req: AuthedRequest) {
  const ativoRaw = String(req.query.ativo ?? "").trim().toLowerCase();
  let ativo: boolean | null = null;
  if (ativoRaw === "1" || ativoRaw === "true" || ativoRaw === "sim") {
    ativo = true;
  } else if (ativoRaw === "0" || ativoRaw === "false" || ativoRaw === "nao") {
    ativo = false;
  }
  return {
    q: req.query.q ? String(req.query.q) : undefined,
    categoriaId: req.query.categoriaId
      ? String(req.query.categoriaId)
      : undefined,
    ativo,
  };
}

function parseArvoreQuery(req: AuthedRequest) {
  const rawExplodir = req.query.explodir;
  let explodir: boolean | undefined;
  if (rawExplodir !== undefined) {
    const v = String(rawExplodir).toLowerCase();
    explodir = v === "1" || v === "true" || v === "sim";
  }
  return {
    q: req.query.q ? String(req.query.q) : undefined,
    produtoPaiId: req.query.produtoPaiId
      ? String(req.query.produtoPaiId)
      : undefined,
    explodir,
  };
}

function sendPdf(
  res: import("express").Response,
  buffer: Buffer,
  filename: string
) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.send(buffer);
}

function sendXlsx(
  res: import("express").Response,
  buffer: Buffer,
  filename: string
) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.send(buffer);
}

/** Preview paginado de saldos */
relatoriosRouter.get("/saldos", async (req: AuthedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
    const { rows, meta } = await carregarSaldosExport(
      req.user!,
      parseSaldosQuery(req)
    );
    const start = (page - 1) * pageSize;
    res.json({
      meta,
      page,
      pageSize,
      total: rows.length,
      rows: rows.slice(start, start + pageSize),
    });
  } catch (e) {
    next(e);
  }
});

relatoriosRouter.get(
  "/saldos/export.pdf",
  async (req: AuthedRequest, res, next) => {
    try {
      const { buffer, filename } = await exportarSaldosPdf(
        req.user!,
        parseSaldosQuery(req)
      );
      sendPdf(res, buffer, filename);
    } catch (e) {
      next(e);
    }
  }
);

relatoriosRouter.get(
  "/saldos/export.xlsx",
  async (req: AuthedRequest, res, next) => {
    try {
      const { buffer, filename } = await exportarSaldosExcel(
        req.user!,
        parseSaldosQuery(req)
      );
      sendXlsx(res, buffer, filename);
    } catch (e) {
      next(e);
    }
  }
);

relatoriosRouter.get("/produtos", async (req: AuthedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
    const { rows, meta } = await carregarProdutosExport(
      req.user!,
      parseProdutosQuery(req)
    );
    const start = (page - 1) * pageSize;
    res.json({
      meta,
      page,
      pageSize,
      total: rows.length,
      rows: rows.slice(start, start + pageSize),
    });
  } catch (e) {
    next(e);
  }
});

relatoriosRouter.get(
  "/produtos/export.pdf",
  async (req: AuthedRequest, res, next) => {
    try {
      const { buffer, filename } = await exportarProdutosPdf(
        req.user!,
        parseProdutosQuery(req)
      );
      sendPdf(res, buffer, filename);
    } catch (e) {
      next(e);
    }
  }
);

relatoriosRouter.get(
  "/produtos/export.xlsx",
  async (req: AuthedRequest, res, next) => {
    try {
      const { buffer, filename } = await exportarProdutosExcel(
        req.user!,
        parseProdutosQuery(req)
      );
      sendXlsx(res, buffer, filename);
    } catch (e) {
      next(e);
    }
  }
);

relatoriosRouter.get("/arvores", async (req: AuthedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const { rows, meta } = await carregarArvoreExport(
      req.user!,
      parseArvoreQuery(req)
    );
    const start = (page - 1) * pageSize;
    res.json({
      meta,
      page,
      pageSize,
      total: rows.length,
      rows: rows.slice(start, start + pageSize),
    });
  } catch (e) {
    next(e);
  }
});

relatoriosRouter.get(
  "/arvores/export.pdf",
  async (req: AuthedRequest, res, next) => {
    try {
      const { buffer, filename } = await exportarArvorePdf(
        req.user!,
        parseArvoreQuery(req)
      );
      sendPdf(res, buffer, filename);
    } catch (e) {
      next(e);
    }
  }
);

relatoriosRouter.get(
  "/arvores/export.xlsx",
  async (req: AuthedRequest, res, next) => {
    try {
      const { buffer, filename } = await exportarArvoreExcel(
        req.user!,
        parseArvoreQuery(req)
      );
      sendXlsx(res, buffer, filename);
    } catch (e) {
      next(e);
    }
  }
);
