"use client";

import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import {
  createContext,
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

/** Liga a setinha da ponta do cabeçalho (ModuleHero) a um conteúdo escondido da página (HeroDrawer). */
export function HeroDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [hasPanel, setHasPanel] = useState(false);
  const panelId = useId();
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

const arrowCls =
  "glass-orb absolute bottom-[-18px] left-1/2 grid size-12 -translate-x-1/2 place-items-center rounded-full text-white";

/**
 * Setinha da ponta em V. Quando a página tem um HeroDrawer, vira botão que mostra/esconde esse conteúdo;
 * nas demais telas é só decorativa.
 */
export function HeroDrawerButton({ label }: { label: string }) {
  const ctx = useContext(HeroDrawerCtx);
  const icon = (
    <ChevronDown
      size={20}
      strokeWidth={2}
      aria-hidden
      className={clsx(
        "transition-transform duration-300",
        ctx?.open && "rotate-180",
      )}
    />
  );
  if (!ctx?.hasPanel) {
    return (
      <span aria-hidden="true" className={arrowCls}>
        {icon}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={ctx.toggle}
      aria-expanded={ctx.open}
      aria-controls={ctx.panelId}
      aria-label={`${ctx.open ? "Ocultar" : "Mostrar"} ${label}`}
      className={clsx(arrowCls, "transition active:scale-95")}
    >
      {icon}
    </button>
  );
}

/** Conteúdo escondido que abre pela setinha do cabeçalho (fechado ao entrar na tela). */
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
