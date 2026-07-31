import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import type { AlertaEvento } from "@teep/shared";
import { verifyAccessToken } from "../middleware/auth";

export type AlertaSocketPayload = {
  id?: string;
  evento: AlertaEvento;
  titulo: string;
  mensagem: string;
  meta?: Record<string, unknown>;
  em: string;
};

let io: Server | null = null;

export function initRealtime(httpServer: HttpServer): Server {
  const origin = process.env.CORS_ORIGIN || "http://localhost:3000";
  io = new Server(httpServer, {
    cors: { origin, credentials: true },
    path: "/socket.io",
  });

  io.use((socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (typeof socket.handshake.headers.authorization === "string" &&
        socket.handshake.headers.authorization.startsWith("Bearer ")
          ? socket.handshake.headers.authorization.slice(7)
          : undefined);
      if (!token) return next(new Error("Não autenticado"));
      socket.data.user = verifyAccessToken(token);
      next();
    } catch {
      next(new Error("Token inválido"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.user?.id as string | undefined;
    if (userId) socket.join(`user:${userId}`);
  });

  return io;
}

export function emitAlertaToUser(
  userId: string,
  payload: AlertaSocketPayload
): void {
  io?.to(`user:${userId}`).emit("alerta", payload);
}
