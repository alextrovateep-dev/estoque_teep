"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  clearMicStaleReloadGuard,
  MIC_MESSAGES,
  resolveMicSpeechErrorMessage,
  safariStopRecognition,
  startRecognitionWithRetry,
  usesSafariSpeechEngine,
} from "@/lib/speechRecognitionBrowser";

export type UseSpeechRecognitionOptions = {
  onFinalTranscript: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function disposeRecognition(recognition: SpeechRecognitionLike | null): void {
  if (!recognition) return;
  safariStopRecognition(recognition);
}

/**
 * Ditado por voz (Web Speech API) — padrão ChamadoPro.
 * Front-only: sem Whisper, sem upload, sem backend.
 */
export function useSpeechRecognition(options: UseSpeechRecognitionOptions) {
  const { onFinalTranscript, onInterimTranscript, onError, onEnd } = options;
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [supportsSpeech, setSupportsSpeech] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const interimAccumRef = useRef("");
  const userWantsRecordingRef = useRef(false);
  const sessionHadFinalRef = useRef(false);
  const safariModeRef = useRef(false);

  const callbacksRef = useRef({
    onFinalTranscript,
    onInterimTranscript,
    onError,
    onEnd,
  });
  useEffect(() => {
    callbacksRef.current = {
      onFinalTranscript,
      onInterimTranscript,
      onError,
      onEnd,
    };
  }, [onFinalTranscript, onInterimTranscript, onError, onEnd]);

  useEffect(() => {
    setSupportsSpeech(!!getSpeechRecognitionCtor());
    safariModeRef.current = usesSafariSpeechEngine();
  }, []);

  const resetRecognitionInstance = useCallback(() => {
    disposeRecognition(recognitionRef.current);
    recognitionRef.current = null;
  }, []);

  const ensureRecognition = useCallback(() => {
    if (recognitionRef.current) return recognitionRef.current;

    const SpeechRecognition = getSpeechRecognitionCtor();
    if (!SpeechRecognition) return null;

    const safariMode = usesSafariSpeechEngine();
    safariModeRef.current = safariMode;

    const r = new SpeechRecognition();
    r.lang = "pt-BR";
    r.interimResults = true;
    r.continuous = !safariMode;

    r.onresult = (event: SpeechRecognitionEventLike) => {
      let finalTranscript = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + " ";
        } else {
          interim += transcript;
        }
      }
      const trimmedFinal = finalTranscript.trim();
      if (trimmedFinal) {
        clearMicStaleReloadGuard();
        sessionHadFinalRef.current = true;
        callbacksRef.current.onFinalTranscript(trimmedFinal);
      }
      interimAccumRef.current = interim;
      setInterimText(interim);
      callbacksRef.current.onInterimTranscript?.(interim);
    };

    r.onerror = (event: { error?: string }) => {
      const code = event?.error || "";
      if (
        code === "no-speech" &&
        userWantsRecordingRef.current &&
        safariModeRef.current
      ) {
        return;
      }
      if (code === "aborted") return;

      userWantsRecordingRef.current = false;
      setIsRecording(false);

      if (code === "audio-capture" || code === "not-allowed") {
        resetRecognitionInstance();
      }

      void resolveMicSpeechErrorMessage(code).then((msg) => {
        if (msg) callbacksRef.current.onError?.(msg);
      });
    };

    r.onend = () => {
      setInterimText("");
      const pending = interimAccumRef.current.trim();
      let hadPendingInterim = false;
      if (pending) {
        hadPendingInterim = true;
        callbacksRef.current.onFinalTranscript(pending);
      }
      interimAccumRef.current = "";

      if (userWantsRecordingRef.current && safariModeRef.current) {
        const restarted = startRecognitionWithRetry(r);
        if (restarted) {
          setIsRecording(true);
          return;
        }
        userWantsRecordingRef.current = false;
      }

      setIsRecording(false);
      const shouldNotifyParent =
        sessionHadFinalRef.current || hadPendingInterim;
      sessionHadFinalRef.current = false;
      if (shouldNotifyParent) callbacksRef.current.onEnd?.();
    };

    recognitionRef.current = r;
    return r;
  }, [resetRecognitionInstance]);

  const stopRecording = useCallback(() => {
    userWantsRecordingRef.current = false;
    // Promover interim pendente antes do dispose — senão onend vê ref vazia e perde o texto
    const pending = interimAccumRef.current.trim();
    interimAccumRef.current = "";
    setInterimText("");
    if (pending) {
      sessionHadFinalRef.current = true;
      callbacksRef.current.onFinalTranscript(pending);
    }
    const r = recognitionRef.current;
    if (!r) {
      setIsRecording(false);
      return;
    }
    disposeRecognition(r);
    setIsRecording(false);
  }, []);

  const toggle = useCallback(async (): Promise<boolean> => {
    const r = ensureRecognition();
    if (!r) return false;

    if (userWantsRecordingRef.current) {
      stopRecording();
      return true;
    }

    sessionHadFinalRef.current = false;
    userWantsRecordingRef.current = true;
    const started = startRecognitionWithRetry(r);
    if (started) {
      clearMicStaleReloadGuard();
      setIsRecording(true);
      return true;
    }

    userWantsRecordingRef.current = false;
    setIsRecording(false);
    resetRecognitionInstance();
    callbacksRef.current.onError?.(MIC_MESSAGES.startFailed);
    return false;
  }, [ensureRecognition, resetRecognitionInstance, stopRecording]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "hidden" &&
        userWantsRecordingRef.current
      ) {
        stopRecording();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [stopRecording]);

  useEffect(() => {
    return () => {
      userWantsRecordingRef.current = false;
      resetRecognitionInstance();
    };
  }, [resetRecognitionInstance]);

  return {
    isRecording,
    isListening: isRecording,
    toggle,
    stop: stopRecording,
    supportsSpeech,
    interimText,
  };
}
