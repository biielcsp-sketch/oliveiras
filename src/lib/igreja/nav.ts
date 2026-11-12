import { BookHeart, Church, GraduationCap, Users } from "lucide-react";

/**
 * Abas da ferradura da Igreja. Resumo fica selecionado no centro ao abrir (como na Casa),
 * com Devocional de um lado e Carisma e Consolidação do outro.
 */
export const IGREJA_TABS = [
  { key: "devocional", href: "/ministerio/devocional", label: "Devocional", icon: BookHeart },
  { key: "resumo", href: "/ministerio", label: "Resumo", icon: Church },
  { key: "carisma", href: "/ministerio/carisma", label: "Carisma", icon: GraduationCap },
  { key: "consolidacao", href: "/ministerio/consolidacao", label: "Consolidação", icon: Users },
];

/** Abas internas da Vida Devocional (páginas). */
export const DEVOCIONAL_TABS = [
  { key: "anotacoes", href: "/ministerio/devocional", label: "Anotações" },
  { key: "promessas", href: "/ministerio/devocional/promessas", label: "Promessas" },
  { key: "oracoes", href: "/ministerio/devocional/oracoes", label: "Orações" },
  { key: "propositos", href: "/ministerio/devocional/propositos", label: "Propósitos" },
] as const;

/** Aba interna ativa pelo caminho (a raiz /ministerio/devocional é Anotações). */
export function devocionalTabFor(path: string) {
  const exact = DEVOCIONAL_TABS.find((t) => t.href !== "/ministerio/devocional" && (path === t.href || path.startsWith(t.href + "/")));
  return exact?.key ?? "anotacoes";
}
