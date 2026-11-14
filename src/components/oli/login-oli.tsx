"use client";

import { useEffect, useState } from "react";
import { OliSphere } from "./oli-sphere";

const FIELDS = "input[name=email], input[name=password], input[name=confirm]";

/**
 * Oli no topo do login: a esfera animada solta sobre o fundo (sem quadro), sem sessão de voz.
 * A altura é reservada por CSS (sem deslocamento de layout).
 * Ao focar em e-mail/senha ela passa a "ouvir"; ao sair do campo, volta ao repouso.
 */
export function LoginOli() {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof Element && t.matches(FIELDS);
    const onIn = (e: FocusEvent) => isField(e.target) && setListening(true);
    const onOut = (e: FocusEvent) => isField(e.target) && setListening(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  return (
    <div className="mx-auto grid h-[clamp(180px,32dvh,300px)] w-full place-items-center" data-testid="oli-stage">
      <div className="grid size-[clamp(170px,30dvh,240px)] place-items-center rounded-full bg-[radial-gradient(circle,var(--surface-solid)_0%,var(--soft)_58%,transparent_72%)]">
        <OliSphere size={150} state={listening ? "listen" : "idle"} label="Oli, o assistente da família" />
      </div>
    </div>
  );
}
