/** eGestor: 60 req/min. Sem Retry-After no dump oficial — usa header se vier. */

export function esperaRateLimitMs(
  retryAfter: string | null | undefined,
  remaining: string | null | undefined,
  attempt: number
): number {
  if (retryAfter != null && String(retryAfter).trim() !== "") {
    const asSeconds = Number(retryAfter);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return Math.min(Math.max(Math.ceil(asSeconds) * 1000, 1000), 120_000);
    }
    const when = Date.parse(retryAfter);
    if (Number.isFinite(when)) {
      return Math.min(Math.max(when - Date.now(), 1000), 120_000);
    }
  }
  if (remaining != null && remaining !== "" && Number(remaining) === 0) {
    return 20_000;
  }
  const exp = 15_000 * 2 ** Math.min(Math.max(attempt, 0), 3);
  return Math.min(exp, 60_000);
}
