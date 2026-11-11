"use client";

import { useEffect, useRef } from "react";
import type { Oli3D } from "./oli3d";
import { OliStage } from "./oli-stage";

const FIELDS = "input[name=email], input[name=password], input[name=confirm]";

/**
 * Oli compacto no topo do login: o mesmo avatar do Início, sem sessão de voz.
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
    <div className="mx-auto h-[200px] w-[200px] overflow-hidden rounded-[32px]">
      <OliStage apiRef={avatar} followPointer placeholderSrc="/oli/oli-login.webp" className="oli-stage--compact" />
    </div>
  );
}
