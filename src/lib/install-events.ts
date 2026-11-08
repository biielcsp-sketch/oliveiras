// Guarda o `beforeinstallprompt` do Chromium para o pop-up "Instalar o Oli" (src/components/install-prompt.tsx).
// O navegador entrega o evento uma vez por carregamento de página, muitas vezes já no /login; depois a
// navegação é no cliente. Por isso este módulo é importado também pelo RegisterSW (layout raiz): a escuta
// começa em qualquer tela, antes de o layout logado carregar.

/** Evento do Chromium (não está no lib.dom do TypeScript). */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // sem a mini barra do navegador: quem oferece é o nosso card
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export function subscribeInstall(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export const getInstallPrompt = () => deferred;
export const wasAppInstalled = () => installed;

/** Entrega o evento guardado e o descarta (o navegador só aceita um prompt() por evento). */
export function consumeInstallPrompt() {
  const ev = deferred;
  deferred = null;
  emit();
  return ev;
}
