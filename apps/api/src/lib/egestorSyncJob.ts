import { syncPedidosEgestor } from "../services/pedidoVendaSyncService";

const INTERVAL_MS = Number(process.env.EGESTOR_SYNC_INTERVAL_MS || 5 * 60 * 1000);

let started = false;

export function startEgestorSyncJob(): void {
  if (started) return;
  if (process.env.EGESTOR_SYNC === "0") {
    console.log("[egestorSync] desligado (EGESTOR_SYNC=0)");
    return;
  }
  started = true;

  const run = () => {
    void syncPedidosEgestor()
      .then((r) => {
        if (r.upserted > 0 || r.removed > 0) {
          console.log(
            JSON.stringify({ event: "egestor_sync", ...r })
          );
        }
      })
      .catch((e) => console.error("[egestorSync]", e));
  };

  setTimeout(run, 45_000);
  setInterval(run, INTERVAL_MS);
  console.log(`[egestorSync] ativo (intervalo ${INTERVAL_MS}ms)`);
}
