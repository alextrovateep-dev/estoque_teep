"use client";

import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useCallback, useEffect, useRef, useState } from "react";

export type ImageLightboxProps = {
  open: boolean;
  onClose: () => void;
  /** URLs já resolvidas (ex.: via resolveAssetUrl). */
  images: string[];
  initialIndex?: number;
  title: string;
  subtitle?: string;
};

export function ImageLightbox({
  open,
  onClose,
  images,
  initialIndex = 0,
  title,
  subtitle,
}: ImageLightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(initialIndex);

  useBodyScrollLock(open);

  useEffect(() => {
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);

  const goPrev = useCallback(() => {
    if (images.length <= 1) return;
    setIndex((i) => (i <= 0 ? images.length - 1 : i - 1));
  }, [images.length]);

  const goNext = useCallback(() => {
    if (images.length <= 1) return;
    setIndex((i) => (i >= images.length - 1 ? 0 : i + 1));
  }, [images.length]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, goPrev, goNext]);

  if (!open || images.length === 0) return null;

  const current = images[Math.min(index, images.length - 1)] ?? images[0];
  const multi = images.length > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Foto de ${title}`}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {subtitle ? (
              <p className="truncate font-mono text-xs text-slate-500">
                {subtitle}
              </p>
            ) : null}
            <p className="truncate text-sm font-medium text-slate-900">
              {title}
            </p>
            {multi ? (
              <p className="mt-0.5 text-xs text-slate-500">
                Foto {index + 1} de {images.length}
                {index === 0 ? " · capa" : ""}
              </p>
            ) : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Fechar
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-slate-50 p-3 sm:p-4">
          {multi ? (
            <>
              <button
                type="button"
                onClick={goPrev}
                className="absolute left-2 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-slate-200 bg-white/95 px-2.5 py-2 text-lg text-slate-700 shadow hover:bg-white sm:block"
                aria-label="Foto anterior"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={goNext}
                className="absolute right-2 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-slate-200 bg-white/95 px-2.5 py-2 text-lg text-slate-700 shadow hover:bg-white sm:block"
                aria-label="Próxima foto"
              >
                ›
              </button>
            </>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current}
            alt={multi ? `${title} — foto ${index + 1}` : title}
            className="max-h-[58vh] max-w-full rounded-lg object-contain sm:max-h-[62vh]"
          />
        </div>

        {multi ? (
          <div className="shrink-0 border-t border-slate-100 bg-white px-3 py-2.5">
            <div className="flex gap-2 overflow-x-auto pb-0.5">
              {images.map((src, i) => (
                <button
                  key={`${src}-${i}`}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={`relative shrink-0 rounded-md ring-2 ring-offset-1 transition ${
                    i === index
                      ? "ring-brand"
                      : "ring-transparent opacity-75 hover:opacity-100"
                  }`}
                  aria-label={`Ver foto ${i + 1}${i === 0 ? " (capa)" : ""}`}
                  aria-current={i === index ? "true" : undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    className="h-14 w-14 rounded-md object-cover"
                  />
                  {i === 0 ? (
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">
                      Capa
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-center text-[11px] text-slate-500 sm:hidden">
              Deslize nas miniaturas · use ← → no teclado
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
