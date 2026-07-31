/** Heurística UX: iPhone / iPod / iPad (incl. iPadOS com UA Macintosh + touch). */
export function isIosLikeClient(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod/i.test(ua)) return true;
  if (/\biPad\b/i.test(ua)) return true;
  if (navigator.maxTouchPoints > 1 && /\bMacintosh\b/i.test(ua)) return true;
  return false;
}

/** Safari / iOS usa webkitSpeechRecognition e tem comportamento diferente do Chrome. */
export function usesSafariSpeechEngine(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  if (isIosLikeClient()) return true;
  const w = window as Window & {
    webkitSpeechRecognition?: unknown;
    SpeechRecognition?: unknown;
  };
  return !!w.webkitSpeechRecognition && !w.SpeechRecognition;
}

type RecognitionLike = {
  start?: () => void;
  abort?: () => void;
  stop?: () => void;
};

/** Workaround WebKit: stop() sozinho às vezes não libera o microfone no Safari. */
export function safariStopRecognition(recognition: RecognitionLike): void {
  if (usesSafariSpeechEngine()) {
    try {
      recognition.start?.();
    } catch {
      /* ignore */
    }
  }
  try {
    recognition.abort?.();
  } catch {
    /* ignore */
  }
  try {
    recognition.stop?.();
  } catch {
    /* ignore */
  }
}

/** Tenta start(); se a instância estiver presa, reinicia e tenta de novo. */
export function startRecognitionWithRetry(
  recognition: RecognitionLike & { start: () => void }
): boolean {
  try {
    recognition.start();
    return true;
  } catch {
    safariStopRecognition(recognition);
    try {
      recognition.start();
      return true;
    } catch {
      return false;
    }
  }
}

function isLocalDevHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

export function isSecureMicContext(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  return (
    window.location.protocol === "http:" &&
    isLocalDevHost(window.location.hostname || "")
  );
}

export type MicrophonePreflightReason = "unsupported" | "insecure";

export type MicrophonePreflightResult =
  | { ok: true }
  | { ok: false; reason: MicrophonePreflightReason };

/** Mensagens únicas — preflight e Web Speech usam a mesma fonte. */
export const MIC_MESSAGES = {
  unsupported:
    "Seu navegador não suporta microfone para ditado. Abra no Chrome ou Edge (não use a prévia embutida do editor).",
  insecure:
    "O ditado por voz exige contexto seguro. Use http://localhost:3000 (ou HTTPS).",
  needsReload:
    "O Chrome já liberou o microfone nesta aba, mas a página precisa ser atualizada. Clique em Recarregar (F5) e toque no microfone de novo.",
  denied:
    "Microfone bloqueado para este site. No Chrome: cadeado → Microfone → Permitir. Se aparecer a faixa azul Recarregar, clique nela (ou F5) e tente de novo.",
  unavailable:
    "Nenhum microfone encontrado ou o Windows bloqueou o acesso. Em Configurações → Privacidade → Microfone, permita o Chrome/Edge.",
  busy:
    "O microfone está em uso por outro app. Feche Zoom/Teams/outras abas e tente de novo.",
  noSpeech: "Nenhuma fala detectada. Tente novamente.",
  network:
    "O ditado por voz precisa de internet. Verifique sua conexão e tente novamente.",
  serviceNotAllowed:
    "Ditado por voz indisponível neste contexto. Use http://localhost:3000 ou HTTPS no Chrome/Edge.",
  startFailed:
    "Não foi possível iniciar o ditado. Toque no microfone novamente.",
} as const;

export const PREFLIGHT_MESSAGES: Record<MicrophonePreflightReason, string> = {
  unsupported: MIC_MESSAGES.unsupported,
  insecure: MIC_MESSAGES.insecure,
};

async function queryMicPermission(): Promise<PermissionState | "unknown"> {
  try {
    if (!navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state;
  } catch {
    return "unknown";
  }
}

/**
 * Preflight leve (sem getUserMedia).
 * Não abrir o mic aqui: no Chrome, após mudar a permissão no cadeado a página
 * fica “stale” até Recarregar — getUserMedia falha com NotAllowedError mesmo
 * com o medidor de áudio já liberado na UI, gerando falso “bloqueado”.
 * O Web Speech API pede o microfone no start().
 */
export async function preflightMicrophoneForSpeech(): Promise<MicrophonePreflightResult> {
  if (isIosLikeClient()) return { ok: true };

  if (!isSecureMicContext()) {
    return { ok: false, reason: "insecure" };
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "unsupported" };
  }

  return { ok: true };
}

const MIC_STALE_RELOAD_KEY = "teep_mic_stale_reload";

/** Limpa o guard de auto-reload após o mic funcionar de verdade. */
export function clearMicStaleReloadGuard(): void {
  try {
    sessionStorage.removeItem(MIC_STALE_RELOAD_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Traduz erro do Web Speech — se o Chrome já concedeu mic mas a página
 * é antiga, recarrega uma vez (mesmo motivo da faixa azul do Chrome).
 */
export async function resolveMicSpeechErrorMessage(
  code: string
): Promise<string> {
  if (!code || code === "aborted") return "";

  if (code === "not-allowed") {
    const perm = await queryMicPermission();
    if (perm === "granted") {
      try {
        if (!sessionStorage.getItem(MIC_STALE_RELOAD_KEY)) {
          sessionStorage.setItem(MIC_STALE_RELOAD_KEY, "1");
          window.location.reload();
          return "";
        }
      } catch {
        /* ignore */
      }
      return MIC_MESSAGES.needsReload;
    }
    return MIC_MESSAGES.denied;
  }

  if (code === "audio-capture") return MIC_MESSAGES.unavailable;
  if (code === "no-speech") return MIC_MESSAGES.noSpeech;
  if (code === "network") return MIC_MESSAGES.network;
  if (code === "service-not-allowed") return MIC_MESSAGES.serviceNotAllowed;

  return MIC_MESSAGES.startFailed;
}
