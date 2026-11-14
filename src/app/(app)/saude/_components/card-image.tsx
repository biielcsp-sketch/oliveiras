"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

/**
 * Foto da carteirinha num quadro com proporção de cartão (≈1,586:1, largura total do card).
 * Foto em retrato (mais alta que larga) é girada -90° só na tela, para ficar deitada e legível; o arquivo não muda.
 * Sem estilo inline (CSP): o tamanho do giro sai das porcentagens do quadro (63,05% = 1/1,586; 158,6% = 1,586).
 */
export function CardImage({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [portrait, setPortrait] = useState<boolean | null>(null);

  const check = (img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0) setPortrait(img.naturalHeight > img.naturalWidth);
  };
  // A imagem pode terminar de carregar antes da hidratação (cache): confere ao montar.
  useEffect(() => check(ref.current), []);

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="relative mt-3 block aspect-[1.586] w-full overflow-hidden rounded-xl border border-line bg-surface-2"
      data-testid="carteirinha-quadro"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- rota autenticada; o otimizador de imagens do Next não tem a sessão */}
      <img
        ref={ref}
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={(e) => check(e.currentTarget)}
        data-orientation={portrait === null ? undefined : portrait ? "retrato" : "paisagem"}
        className={clsx(
          "absolute object-contain",
          portrait ? "left-1/2 top-1/2 h-[158.6%] w-[63.05%] -translate-x-1/2 -translate-y-1/2 -rotate-90" : "inset-0 size-full",
        )}
      />
    </a>
  );
}
