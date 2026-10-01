/** Contador de requests visíveis (não usar em polling em background). */

let count = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function loadingBegin() {
  count += 1;
  emit();
}

export function loadingEnd() {
  count = Math.max(0, count - 1);
  emit();
}

export function loadingCount() {
  return count;
}

export function subscribeLoading(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function withLoading<T>(fn: () => Promise<T>): Promise<T> {
  loadingBegin();
  try {
    return await fn();
  } finally {
    loadingEnd();
  }
}
