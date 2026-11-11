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
}: {
  apiRef: RefObject<Oli3D | null>;
  /** Olhar segue também o toque em qualquer ponto da tela (login). */
  followPointer?: boolean;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [poster, setPoster] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let instance: Oli3D | null = null;
    const load = () => {
      const container = el.current;
      if (!container || cancelled) return;
      const gpu = probeWebGL();
      if (gpu === "none") return setFailed(true);
      if (gpu === "software") return setPoster(true);
      import("./oli3d")
        .then(({ createOli3D }) => createOli3D(container, { followPointer }))
        .then((oli) => {
          if (cancelled) return oli.dispose();
          instance = oli;
          apiRef.current = oli;
        })
        .catch((e) => {
          console.warn("Oli 3D indisponível:", e instanceof Error ? e.message : e);
          if (!cancelled) setFailed(true);
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
      window.removeEventListener("load", schedule);
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      instance?.dispose();
      apiRef.current = null;
    };
  }, [apiRef, followPointer]);

  return (
    <div ref={el} className={className ? `oli-stage ${className}` : "oli-stage"} data-testid="oli-stage">
      {poster && (
        <Image
          src="/oli/oli-poster.webp"
          alt="Oli, o assistente da família"
          width={780}
          height={780}
          unoptimized
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
