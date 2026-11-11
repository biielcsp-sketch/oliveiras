"use client";

import { useEffect, useRef } from "react";
import type { Oli3D } from "./oli3d";
import { OliStage } from "./oli-stage";

const FIELDS = "input[name=email], input[name=password], input[name=confirm]";

/**
 * Oli grande e solto no topo do login (sem quadro, o fundo da tela é o palco): o mesmo avatar do Início, sem sessão de voz.
 * A altura é reservada por CSS (sem deslocamento de layout quando o 3D ou o poster chegam).
 * Ao focar em e-mail/senha ele passa a "ouvir"; ao sair do campo, volta ao repouso.
 */
export function LoginOli() {
  const avatar = useRef<Oli3D | null>(null);

  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof Element && t.matches(FIELDS);
    const onIn = (e: FocusEvent) => isField(e.target) && avatar.current?.setState("listen");
    const onOut = (e: FocusEvent) => isField(e.target) && avatar.current?.setState("idle");
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  return (
    <div className="mx-auto h-[clamp(200px,40dvh,380px)] w-full">
      <OliStage apiRef={avatar} followPointer placeholderSrc="/oli/oli-login-transparent.webp" className="oli-stage--fullscreen" />
    </div>
  );
}
