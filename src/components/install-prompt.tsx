"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Share } from "lucide-react";
import { Button } from "@/components/ui";
import {
  INSTALL_DELAY_MS,
  INSTALL_DISMISS_KEY,
  INSTALL_DISMISS_MS,
  installPromptKind,
  isIosSafari,
  parseDismissedUntil,
} from "@/lib/install-prompt";
import { consumeInstallPrompt, getInstallPrompt, subscribeInstall, wasAppInstalled } from "@/lib/install-events";
import { OliSphere } from "@/components/oli/oli-sphere";

type Env = { iosSafari: boolean; standalone: boolean; dismissedUntil: number | null; now: number };

function readEnv(): Env {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(INSTALL_DISMISS_KEY);
  } catch {
    // localStorage bloqueado (modo privado antigo): só não lembra a escolha.
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    iosSafari: isIosSafari(nav.userAgent, nav.maxTouchPoints),
    standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
    dismissedUntil: parseDismissedUntil(stored),
    now: Date.now(),
  };
}

/** "Agora não"/"Entendi"/Esc: esconde por 7 dias. */
function rememberDismissal() {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now() + INSTALL_DISMISS_MS));
  } catch {
    // sem localStorage: esconde só nesta visita
  }
}

/** Pop-up "Instalar o Oli": botão nativo no Android/Chromium, instrução do Compartilhar no iPhone/iPad. */
export function InstallPrompt() {
  const promptEvent = useSyncExternalStore(subscribeInstall, getInstallPrompt, () => null);
  const wasInstalled = useSyncExternalStore(subscribeInstall, wasAppInstalled, () => false);
  const [env, setEnv] = useState<Env | null>(null);
  const [closed, setClosed] = useState(false);
  const titleId = useId();
  const textId = useId();

  // Aparece ~2 s depois de abrir.
  useEffect(() => {
    const t = window.setTimeout(() => setEnv(readEnv()), INSTALL_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  const kind =
    env && !closed
      ? installPromptKind({ ...env, hasPromptEvent: promptEvent !== null, installed: wasInstalled })
      : null;

  function dismiss() {
    rememberDismissal();
    setClosed(true);
  }

  async function install() {
    const ev = consumeInstallPrompt();
    if (!ev) return;
    setClosed(true);
    try {
      await ev.prompt();
      await ev.userChoice;
    } catch {
      // o navegador recusou abrir a janela: nada a fazer
    }
  }

  // Esc fecha (como "Agora não"/"Entendi"), sem atrapalhar diálogos modais abertos.
  useEffect(() => {
    if (!kind) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      rememberDismissal();
      setClosed(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [kind]);

  if (!kind) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={textId}
      className="oli-rise fixed inset-x-4 bottom-[calc(7.25rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md md:inset-x-auto md:bottom-6 md:right-6 md:w-[380px]"
    >
      {/* Fundo sólido (não vidro): fica por cima do conteúdo e precisa ser legível. */}
      <div className="flex gap-4 rounded-[24px] border border-line bg-surface-solid p-4 shadow-card">
        <div className="grid size-14 shrink-0 place-items-center rounded-full bg-accent-soft">
          <OliSphere size={46} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[17px] font-semibold tracking-tight">
            Instalar o Oli
          </h2>
          {kind === "android" ? (
            <p id={textId} className="mt-0.5 text-sm text-muted">
              Abra direto da tela inicial, em tela cheia.
            </p>
          ) : (
            <p id={textId} className="mt-0.5 text-sm text-muted">
              Toque em Compartilhar{" "}
              <Share size={16} strokeWidth={2} aria-hidden className="inline-block -translate-y-px align-middle text-primary" />{" "}
              e depois em Adicionar à Tela de Início.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {kind === "android" ? (
              <>
                <Button type="button" onClick={install}>
                  Instalar
                </Button>
                <Button type="button" variant="ghost" onClick={dismiss}>
                  Agora não
                </Button>
              </>
            ) : (
              <Button type="button" onClick={dismiss}>
                Entendi
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
