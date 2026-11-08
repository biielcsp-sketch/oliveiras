/** Regras do pop-up "Instalar o Oli" (funções puras, testadas em tests/unit/install-prompt.test.ts). */

export type InstallKind = "android" | "ios";

/** Chave no localStorage: até quando (ms desde 1970) o pop-up fica escondido. */
export const INSTALL_DISMISS_KEY = "oli-instalar-dispensado-ate";
/** "Agora não"/"Entendi" escondem o pop-up por 7 dias. */
export const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
/** Espera antes de aparecer, para não disputar atenção com o carregamento da tela. */
export const INSTALL_DELAY_MS = 2000;

/**
 * iPhone/iPad no Safari. No iOS só o Safari oferece "Adicionar à Tela de Início" de forma confiável;
 * outros navegadores (Chrome, Firefox, Edge, Opera, Google app) e navegadores embutidos (Instagram, Facebook)
 * ficam de fora. iPadOS se apresenta como Mac: reconhecido pelo toque (maxTouchPoints > 1).
 */
export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!ios) return false;
  if (!/Safari\//.test(userAgent)) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|FBAN|FBAV|Instagram|Line\//.test(userAgent);
}

/** Lê o "dispensado até" guardado; qualquer valor inválido conta como não dispensado. */
export function parseDismissedUntil(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type InstallInput = {
  /** O navegador entregou o `beforeinstallprompt` (Android/Chromium). */
  hasPromptEvent: boolean;
  /** iPhone/iPad no Safari (ver isIosSafari). */
  iosSafari: boolean;
  /** Já aberto como app (display-mode standalone ou navigator.standalone). */
  standalone: boolean;
  /** Recebeu `appinstalled` nesta visita. */
  installed: boolean;
  /** Dispensado até (ms); null se nunca dispensado. */
  dismissedUntil: number | null;
  now: number;
};

/** Qual pop-up mostrar: android (botão Instalar), ios (instrução do Compartilhar) ou nada. */
export function installPromptKind(i: InstallInput): InstallKind | null {
  if (i.standalone || i.installed) return null;
  if (i.dismissedUntil !== null && i.now < i.dismissedUntil) return null;
  if (i.hasPromptEvent) return "android";
  if (i.iosSafari) return "ios";
  return null;
}
