import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import rateLimit from "express-rate-limit";
import {
  authenticate,
  AuthedRequest,
} from "../middleware/auth";
import { loadPermissoes } from "../middleware/permissoes";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import {
  detectImageMime,
  detectUploadMime,
  ensureUploadDirs,
  extFromMime,
  getMaxUploadBytes,
  getUploadRoot,
  isAllowedMime,
  purgeOrphanAvatarFiles,
  purgeOrphanProdutoFiles,
  randomHash12,
  toPublicUrl,
} from "../lib/uploads";
import { writeRmaTmpFile } from "../lib/rmaUploads";

ensureUploadDirs();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: getMaxUploadBytes(), files: 1 },
});

const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitos uploads. Aguarde 1 minuto." },
});

export const uploadRouter = Router();
uploadRouter.use(authenticate, uploadLimiter);

uploadRouter.post(
  "/",
  upload.single("file"),
  async (req: AuthedRequest, res, next) => {
    try {
      if (!req.file) throw new AppError(400, "Arquivo obrigatório (campo file)");

      const context = String(req.body?.context || "");
      if (
        context !== "perfil" &&
        context !== "produto" &&
        context !== "nota-fiscal" &&
        context !== "documento" &&
        context !== "rma"
      ) {
        throw new AppError(
          400,
          "context deve ser perfil, produto, nota-fiscal, documento ou rma"
        );
      }

      const rmaKind = String(req.body?.kind || "nf");
      const docOpts =
        context === "documento" || (context === "rma" && rmaKind === "laudo")
          ? { pdf: true, word: true }
          : context === "nota-fiscal" ||
              (context === "rma" && rmaKind !== "laudo")
            ? { pdf: true, word: false }
            : null;
      const mime = docOpts
        ? detectUploadMime(req.file.buffer, docOpts)
        : detectImageMime(req.file.buffer);
      if (!mime || !isAllowedMime(mime, docOpts || {})) {
        throw new AppError(
          400,
          context === "documento" || (context === "rma" && rmaKind === "laudo")
            ? "Formato inválido — use PDF, Word (doc/docx), JPEG, PNG, GIF ou WebP"
            : context === "nota-fiscal" || context === "rma"
              ? "Formato inválido — use PDF, JPEG, PNG, GIF ou WebP"
              : "Formato inválido — use JPEG, PNG, GIF ou WebP"
        );
      }
      const ext = extFromMime(mime)!;
      const hash = randomHash12();
      const root = getUploadRoot();

      if (context === "perfil") {
        let targetUserId = req.user!.id;
        const requested = req.body?.usuarioId
          ? String(req.body.usuarioId)
          : "";
        if (requested && requested !== req.user!.id) {
          if (req.user!.perfil !== "ADMIN") {
            throw new AppError(403, "Só Admin altera avatar de outro usuário");
          }
          const u = await prisma.usuario.findUnique({
            where: { id: requested },
            select: { id: true },
          });
          if (!u) throw new AppError(404, "Usuário não encontrado");
          targetUserId = u.id;
        }

        const dir = path.join(root, "fotos-perfil");
        fs.mkdirSync(dir, { recursive: true });
        const filename = `${targetUserId}-${hash}.${ext}`;
        const abs = path.join(dir, filename);
        fs.writeFileSync(abs, req.file.buffer);
        const url = toPublicUrl(abs);

        const atual = await prisma.usuario.findUnique({
          where: { id: targetUserId },
          select: { fotoPerfil: true },
        });
        purgeOrphanAvatarFiles(targetUserId, [atual?.fotoPerfil, url]);

        return res.status(201).json({ url });
      }

      if (context === "rma") {
        const perms = await loadPermissoes(req);
        if (
          req.user!.perfil !== "ADMIN" &&
          !perms.rma &&
          !perms.rma_cobranca
        ) {
          throw new AppError(403, "Sem permissão para upload de anexo RMA");
        }
        const url = writeRmaTmpFile(req.user!.id, req.file.buffer, ext);
        return res.status(201).json({ url });
      }

      if (context === "nota-fiscal") {
        const perms = await loadPermissoes(req);
        if (
          req.user!.perfil !== "ADMIN" &&
          !perms.lancamentos &&
          !perms.rma &&
          !perms.rma_cobranca
        ) {
          throw new AppError(403, "Sem permissão para upload de nota fiscal");
        }
        const dir = path.join(root, "notas-fiscais");
        fs.mkdirSync(dir, { recursive: true });
        const filename = `${req.user!.id}-${hash}.${ext}`;
        const abs = path.join(dir, filename);
        fs.writeFileSync(abs, req.file.buffer);
        return res.status(201).json({ url: toPublicUrl(abs) });
      }

      if (context === "documento") {
        const perms = await loadPermissoes(req);
        if (
          req.user!.perfil !== "ADMIN" &&
          !perms.lancamentos &&
          !perms.rma &&
          !perms.rma_cobranca
        ) {
          throw new AppError(403, "Sem permissão para upload de documento");
        }
        const dir = path.join(root, "movimentacao-anexos");
        fs.mkdirSync(dir, { recursive: true });
        const filename = `${req.user!.id}-${hash}.${ext}`;
        const abs = path.join(dir, filename);
        fs.writeFileSync(abs, req.file.buffer);
        return res.status(201).json({ url: toPublicUrl(abs) });
      }

      // produto — exige ACL cadastros (não basta ser Gerente)
      if (req.user!.perfil === "OPERADOR") {
        throw new AppError(403, "Operador não envia fotos de produto");
      }
      const perms = await loadPermissoes(req);
      if (req.user!.perfil !== "ADMIN" && !perms.cadastros_produtos_editar) {
        throw new AppError(403, "Sem permissão para upload de produto");
      }
      const produtoId = String(req.body?.produtoId || "");
      if (!produtoId) {
        throw new AppError(400, "produtoId obrigatório para context=produto");
      }
      const produto = await prisma.produto.findUnique({
        where: { id: produtoId },
        select: { id: true, ativo: true, fotos: true },
      });
      if (!produto || !produto.ativo) {
        throw new AppError(404, "Produto não encontrado");
      }

      const dir = path.join(root, "conteudo", "produtos", produtoId);
      fs.mkdirSync(dir, { recursive: true });
      const filename = `${hash}.${ext}`;
      const abs = path.join(dir, filename);
      fs.writeFileSync(abs, req.file.buffer);
      const url = toPublicUrl(abs);

      const fotosDb = Array.isArray(produto.fotos)
        ? (produto.fotos as string[])
        : [];
      purgeOrphanProdutoFiles(produtoId, [...fotosDb, url]);

      return res.status(201).json({ url });
    } catch (e) {
      next(e);
    }
  }
);
