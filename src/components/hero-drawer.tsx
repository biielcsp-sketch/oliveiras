"use client";

import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";

type Ctx = {
  open: boolean;
  toggle: () => void;
  panelId: string;
  hasPanel: boolean;
  setHasPanel: (v: boolean) => void;
};
const HeroDrawerCtx = createContext<Ctx | null>(null);

/** Liga o botão "mostrar/ocultar" (HeroDrawerButton) a um conteúdo escondido da página (HeroDrawer). */
export function HeroDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [hasPanel, setHasPanelState] = useState(false);
  const panelId = useId();
  // Ao sair da tela que tem o conteúdo, ele volta fechado
  const setHasPanel = useCallback((v: boolean) => {
    setHasPanelState(v);
    if (!v) setOpen(false);
  }, []);
  return (
    <HeroDrawerCtx.Provider
      value={{
        open,
        toggle: () => setOpen((o) => !o),
        panelId,
        hasPanel,
        setHasPanel,
      }}
    >
      {children}
    </HeroDrawerCtx.Provider>
  );
}

/**
 * Botão que mostra/esconde o conteúdo reservado da página (HeroDrawer), como o saldo das contas nas Finanças.
 * `title`: texto visível do botão. Sem HeroDrawer na tela, não aparece.
 */
export function HeroDrawerButton({ label, title }: { label: string; title: string }) {
  const ctx = useContext(HeroDrawerCtx);
  if (!ctx?.hasPanel) return null;
  return (
    <button
      type="button"
      onClick={ctx.toggle}
      aria-expanded={ctx.open}
      aria-controls={ctx.panelId}
      aria-label={`${ctx.open ? "Ocultar" : "Mostrar"} ${label}`}
      className="glass-card flex min-h-11 w-full items-center justify-between gap-3 rounded-full px-4 text-[14px] font-semibold text-deep transition active:scale-[0.99]"
    >
      {title}
      <ChevronDown size={18} strokeWidth={2} aria-hidden className={clsx("transition-transform duration-300", ctx.open && "rotate-180")} />
    </button>
  );
}

/** Conteúdo escondido que abre pelo HeroDrawerButton (fechado ao entrar na tela). */
export function HeroDrawer({ children }: { children: ReactNode }) {
  const ctx = useContext(HeroDrawerCtx);
  const setHasPanel = ctx?.setHasPanel;
  useEffect(() => {
    setHasPanel?.(true);
    return () => setHasPanel?.(false);
  }, [setHasPanel]);
  const open = ctx?.open ?? true;
  return (
    <div
      id={ctx?.panelId}
      inert={!open}
      className={clsx(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      {/* Margem lateral para a sombra do card não ser cortada */}
      <div className="-mx-6 overflow-hidden px-6 pt-2 -mt-2">{children}</div>
    </div>
  );
}
