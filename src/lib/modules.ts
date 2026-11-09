import {
  CalendarDays,
  HeartPulse,
  Home,
  LayoutGrid,
  Sparkles,
  Users,
  Wallet,
  Church,
  type LucideIcon,
} from "lucide-react";

export type ModuleDef = {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  phase?: number;
};

export const MODULES: ModuleDef[] = [
  { href: "/financas", label: "Finanças", icon: Wallet, description: "Contas, cartões, orçamento e metas", phase: 1 },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, description: "Agendas do casal integradas ao Google", phase: 3 },
  { href: "/saude", label: "Saúde", icon: HeartPulse, description: "Carteirinhas, consultas, exames, medicamentos e vacinas", phase: 4 },
  { href: "/casa", label: "Casa", icon: Home, description: "Compras, tarefas, manutenção e documentos", phase: 5 },
  { href: "/ministerio", label: "Igreja", icon: Church, description: "Carisma, Consolidação e GC", phase: 6 },
];

/** O Oli mora na tela Início (/assistente redireciona para lá). */
export const ASSISTANT: ModuleDef = {
  href: "/inicio",
  label: "Oli",
  icon: Sparkles,
  description: "Pergunte sobre qualquer área da vida da família",
  phase: 7,
};

export const HOME: ModuleDef = { href: "/inicio", label: "Início", icon: LayoutGrid, description: "" };
export const FAMILY: ModuleDef = { href: "/familia", label: "Família", icon: Users, description: "Membros e convite" };

const byHref = (href: string) => MODULES.find((m) => m.href === href)!;

/** Barra inferior do celular: Finanças · Saúde · [Oli] · Casa · Igreja. Início fica no logo; Agenda no topo. */
export const MOBILE_NAV_LEFT = [byHref("/financas"), byHref("/saude")];
export const MOBILE_NAV_RIGHT = [byHref("/casa"), byHref("/ministerio")];
export const AGENDA = byHref("/agenda");

/** Barra lateral no desktop (Agenda abre o calendário, separado). O Oli está no Início. */
export const SIDEBAR_NAV = [HOME, ...MODULES.filter((m) => m.href !== "/agenda")];
