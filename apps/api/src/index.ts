import dotenv from "dotenv";
import path from "path";
import http from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";

/** Sempre carrega apps/api/.env (não depende do cwd do pnpm). */
dotenv.config({ path: path.resolve(__dirname, "../.env") });
import { prisma } from "./lib/prisma";
import { ensureRedis } from "./lib/redis";
import { initRealtime } from "./lib/realtime";
import { startEmailQueueWorker } from "./lib/emailQueue";
import { startAlertaRetornoJob } from "./lib/alertaRetornoJob";
import { ensureUploadDirs, getUploadRoot } from "./lib/uploads";
import { assertProductionEnv } from "./lib/env";
import { errorHandler } from "./middleware/error";
import { verifyAccessToken } from "./middleware/auth";
import { authRouter } from "./routes/auth";
import { cadastrosRouter } from "./routes/cadastros";
import { estoqueRouter } from "./routes/estoque";
import { transferenciasRouter } from "./routes/transferencias";
import {
  notificacoesRouter,
  emailAdminRouter,
} from "./routes/notificacoes";
import { uploadRouter } from "./routes/upload";
import { assistenteRouter } from "./routes/assistente";
import { seriesRouter } from "./routes/series";

assertProductionEnv();
ensureUploadDirs();

const app = express();
const port = Number(process.env.API_PORT || 4000);

if (process.env.TRUST_PROXY === "1" || process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  })
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));

/** Mídia autenticada: Bearer ou ?token= (para <img src>). */
app.use("/uploads", (req, res, next) => {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : "";
  const token = bearer || String(req.query.token || "");
  if (!token) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  try {
    verifyAccessToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
});

app.use(
  "/uploads",
  express.static(getUploadRoot(), {
    fallthrough: false,
    index: false,
  })
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "teep-api" });
});

app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redis = await ensureRedis();
    res.json({
      status: "ready",
      database: true,
      redis: Boolean(redis),
      uploads: getUploadRoot(),
    });
  } catch (e) {
    res.status(503).json({ status: "not_ready", error: String(e) });
  }
});

app.use("/auth", authRouter);
app.use("/upload", uploadRouter);
app.use(cadastrosRouter);
app.use(estoqueRouter);
app.use("/transferencias", transferenciasRouter);
app.use("/series", seriesRouter);
app.use("/notificacoes", notificacoesRouter);
app.use("/admin/email", emailAdminRouter);
app.use("/assistente", assistenteRouter);

app.use(errorHandler);

const server = http.createServer(app);
initRealtime(server);

server.listen(port, () => {
  console.log(`API listening on :${port} (http + socket.io)`);
  console.log(`Uploads dir: ${path.resolve(getUploadRoot())}`);
  startEmailQueueWorker();
  startAlertaRetornoJob();
});
