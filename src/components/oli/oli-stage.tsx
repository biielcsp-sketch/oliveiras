"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Oli3D } from "./oli3d";
import { probeWebGL } from "./gpu";

/**
 * Palco do avatar 3D. O three.js só é baixado depois da primeira pintura
 * (import dinâmico em tempo ocioso), para não pesar o carregamento da tela.
 * Sem GPU (renderizador por software), mostra a imagem estática do mesmo avatar: ali cada quadro
 * WebGL trava a página por mais de um segundo.
 */
export function OliStage({
  apiRef,
  followPointer = false,
  className,
  placeholderSrc,
}: {
  apiRef: RefObject<Oli3D | null>;
  /** Olhar segue também o toque em qualquer ponto da tela (login). */
  followPointer?: boolean;
  className?: string;
  /**
   * Imagem leve renderizada já no HTML do servidor (com prioridade) enquanto o 3D não carrega; some quando o
   * canvas assume. Sem isso, o poster só aparece sem GPU e depois da hidratação.
   */
  placeholderSrc?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [poster, setPoster] = useState(Boolean(placeholderSrc));

  useEffect(() => {
    let cancelled = false;
    let instance: Oli3D | null = null;
    let hideTimer = 0;
    const load = () => {
      const container = el.current;
      if (!container || cancelled) return;
      const gpu = probeWebGL();
      if (gpu === "none") {
        setPoster(false);
        return setFailed(true);
      }
      if (gpu === "software") return setPoster(true);
      import("./oli3d")
        .then(({ createOli3D }) => createOli3D(container, { followPointer }))
        .then((oli) => {
          if (cancelled) return oli.dispose();
          instance = oli;
          apiRef.current = oli;
          // O canvas já está por cima: tira o placeholder depois do primeiro quadro.
          if (placeholderSrc) hideTimer = window.setTimeout(() => setPoster(false), 800);
        })
        .catch((e) => {
          console.warn("Oli 3D indisponível:", e instanceof Error ? e.message : e);
          if (!cancelled) {
            setPoster(false);
            setFailed(true);
          }
        });
    };
    // Depois do evento load da página e num momento ocioso: o 3D não disputa a primeira pintura.
    const idle = typeof window.requestIdleCallback === "function";
    let handle = 0;
    const schedule = () => {
      handle = idle ? window.requestIdleCallback(load, { timeout: 1200 }) : window.setTimeout(load, 200);
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
    return () => {
      cancelled = true;
      window.clearTimeout(hideTimer);
      window.removeEventListener("load", schedule);
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      instance?.dispose();
      apiRef.current = null;
    };
  }, [apiRef, followPointer, placeholderSrc]);

  return (
    <div ref={el} className={className ? `oli-stage ${className}` : "oli-stage"} data-testid="oli-stage">
      {poster && (
        <Image
          src={placeholderSrc ?? "/oli/oli-poster.webp"}
          alt="Oli, o assistente da família"
          width={placeholderSrc ? 400 : 780}
          height={placeholderSrc ? 400 : 780}
          unoptimized
          loading={placeholderSrc ? "eager" : undefined}
          fetchPriority={placeholderSrc ? "high" : undefined}
          className="absolute inset-0 size-full object-contain"
        />
      )}
      {failed && (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/75">
          Não foi possível carregar o Oli em 3D neste aparelho. Você ainda pode conversar normalmente.
        </p>
      )}
    </div>
  );
}
