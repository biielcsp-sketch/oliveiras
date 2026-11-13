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
  /** Página que o menu abre, quando não é a raiz do módulo (a raiz continua valendo para marcar o item ativo). */
  entry?: string;
};

export const MODULES: ModuleDef[] = [
  { href: "/financas", label: "Finanças", icon: Wallet, description: "Contas, cartões, orçamento e metas", phase: 1 },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, description: "Agendas do casal integradas ao Google", phase: 3 },
  { href: "/saude", label: "Saúde", icon: HeartPulse, description: "Carteirinhas, consultas, exames, medicamentos e vacinas", phase: 4 },
  { href: "/casa", label: "Casa", icon: Home, description: "Compras, tarefas, manutenção e documentos", phase: 5 },
  { href: "/ministerio", label: "Igreja", icon: Church, description: "Vida devocional, Carisma e Consolidação", phase: 6 },
];

/** O Oli tem tela própria (/assistente); o Início é o painel da família. */
export const ASSISTANT: ModuleDef = {
  href: "/assistente",
  label: "Oli",
  icon: Sparkles,
  description: "Pergunte sobre qualquer área da vida da família",
  phase: 7,
};

export const HOME: ModuleDef = { href: "/inicio", label: "Início", icon: LayoutGrid, description: "" };
export const FAMILY: ModuleDef = { href: "/familia", label: "Família", icon: Users, description: "Membros e convite" };

const byHref = (href: string) => MODULES.find((m) => m.href === href)!;

/** Barra inferior do celular: Finanças · Saúde · [Oli] · Casa · Igreja. Início fica no logo; Agenda no topo do Início. */
export const MOBILE_NAV_LEFT = [byHref("/financas"), byHref("/saude")];
export const MOBILE_NAV_RIGHT = [byHref("/casa"), byHref("/ministerio")];
export const AGENDA = byHref("/agenda");

/** Barra lateral no desktop (Agenda abre o calendário, separado). */
export const SIDEBAR_NAV = [HOME, ASSISTANT, ...MODULES.filter((m) => m.href !== "/agenda")];

/** Módulos do arco do Início, na ordem da prévia aprovada. */
export const HOME_MODULES = [byHref("/financas"), byHref("/saude"), byHref("/casa"), byHref("/ministerio")];
