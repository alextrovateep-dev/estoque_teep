import { processarAlertasRetornoVencidos } from "../services/alertaRetornoService";

const INTERVAL_MS = Number(
  process.env.ALERTA_RETORNO_INTERVAL_MS || 60 * 60 * 1000
); // 1h padrão (cobre o “diário” sem depender de cron externo)

let started = false;

/** Job periódico de alertas de retorno (demo/comodato). */
export function startAlertaRetornoJob(): void {
  if (started) return;
  if (process.env.ALERTA_RETORNO_JOB === "0") {
    console.log("[alertaRetornoJob] desligado (ALERTA_RETORNO_JOB=0)");
    return;
  }
  started = true;

  const run = () => {
    void processarAlertasRetornoVencidos()
      .then((r) => {
        if (r.enviados > 0 || r.erros > 0) {
          console.log(
            JSON.stringify({
              event: "alerta_retorno_job",
              enviados: r.enviados,
              erros: r.erros,
            })
          );
        }
      })
      .catch((e) => console.error("[alertaRetornoJob]", e));
  };

  // Primeira passagem após boot (30s) + intervalo
  setTimeout(run, 30_000);
  setInterval(run, INTERVAL_MS);
  console.log(
    `[alertaRetornoJob] ativo (intervalo ${INTERVAL_MS}ms)`
  );
}
