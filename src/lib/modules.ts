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
  { href: "/saude", label: "Saúde", icon: HeartPulse, description: "Carteirinhas, consultas e exames", phase: 4 },
  { href: "/casa", label: "Casa", icon: Home, description: "Compras, tarefas, manutenção e documentos", phase: 5 },
  { href: "/ministerio", label: "Ministério", icon: Church, description: "Carisma, Consolidação e GC", phase: 6 },
];

export const ASSISTANT: ModuleDef = {
  href: "/assistente",
  label: "Assistente",
  icon: Sparkles,
  description: "Pergunte sobre qualquer área da vida da família",
  phase: 7,
};

export const HOME: ModuleDef = { href: "/inicio", label: "Início", icon: LayoutGrid, description: "" };
export const FAMILY: ModuleDef = { href: "/familia", label: "Família", icon: Users, description: "Membros e convite" };

/** Barra inferior do celular: 5 itens. Ministério fica no Início e no menu. */
export const MOBILE_NAV = [HOME, MODULES[0], MODULES[1], MODULES[2], MODULES[3]];
