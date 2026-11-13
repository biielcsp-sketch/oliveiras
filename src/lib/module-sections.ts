import {
  ArrowLeftRight,
  Banknote,
  CalendarClock,
  ChartPie,
  FileText,
  HandHeart,
  IdCard,
  Landmark,
  Pill,
  Scissors,
  Stethoscope,
  Syringe,
  Tags,
  Target,
  TestTube,
  type LucideIcon,
} from "lucide-react";
import { CASA_TABS } from "@/lib/casa/nav";
import { IGREJA_TABS } from "@/lib/igreja/nav";

/**
 * Seções de cada módulo (Finanças, Saúde, Casa, Igreja): alimentam a grade de botões da página raiz
 * e a lista do botão ⋮ do topo. Só páginas que existem no app.
 */
export type ModuleSection = { key: string; href: string; label: string; icon: LucideIcon };
export type ModuleKey = "financas" | "saude" | "casa" | "ministerio";
export type ModuleInfo = { key: ModuleKey; title: string; root: string; sections: ModuleSection[] };

const notRoot = (t: { key: string }) => t.key !== "resumo";

export const MODULE_INFO: Record<ModuleKey, ModuleInfo> = {
  financas: {
    key: "financas",
    title: "Finanças",
    root: "/financas",
    sections: [
      { key: "lancamentos", href: "/financas/lancamentos", label: "Lançamentos", icon: ArrowLeftRight },
      { key: "orcamento", href: "/financas/orcamento", label: "Orçamento", icon: ChartPie },
      { key: "contas-fixas", href: "/financas/contas-fixas", label: "Contas fixas", icon: CalendarClock },
      { key: "documentos", href: "/financas/documentos", label: "Documentos", icon: FileText },
      { key: "metas", href: "/financas/metas", label: "Metas", icon: Target },
      { key: "contas", href: "/financas/contas", label: "Contas", icon: Banknote },
      { key: "categorias", href: "/financas/categorias", label: "Categorias", icon: Tags },
      { key: "open-finance", href: "/financas/open-finance", label: "Open Finance", icon: Landmark },
    ],
  },
  saude: {
    key: "saude",
    title: "Saúde",
    root: "/saude",
    // Carteirinhas continua na raiz (/saude), logo abaixo da grade.
    sections: [
      { key: "carteirinhas", href: "/saude", label: "Carteirinhas", icon: IdCard },
      { key: "consultas", href: "/saude/consultas", label: "Consultas", icon: Stethoscope },
      { key: "exames", href: "/saude/exames", label: "Exames", icon: TestTube },
      { key: "procedimentos", href: "/saude/procedimentos", label: "Procedimentos", icon: Scissors },
      { key: "medicamentos", href: "/saude/medicamentos", label: "Medicamentos", icon: Pill },
      { key: "vacinas", href: "/saude/vacinas", label: "Vacinas", icon: Syringe },
    ],
  },
  casa: {
    key: "casa",
    title: "Casa",
    root: "/casa",
    sections: CASA_TABS.filter(notRoot),
  },
  ministerio: {
    key: "ministerio",
    title: "Igreja",
    root: "/ministerio",
    sections: [
      ...IGREJA_TABS.filter(notRoot).slice(0, 1),
      // Orações é uma página real da Vida devocional; fica à mão na grade, como na prévia aprovada.
      { key: "oracoes", href: "/ministerio/devocional/oracoes", label: "Orações", icon: HandHeart },
      ...IGREJA_TABS.filter(notRoot).slice(1),
    ],
  },
};

/** Item da lista que corresponde à rota (o mais específico vence; a raiz só casa exato). -1 se nenhum. */
export function activeSectionIndex(info: ModuleInfo, path: string) {
  let best = -1;
  info.sections.forEach((s, i) => {
    const hit = s.href === info.root ? path === s.href : path === s.href || path.startsWith(s.href + "/");
    if (hit && (best < 0 || s.href.length > info.sections[best].href.length)) best = i;
  });
  return best;
}

/** Título do topo: o nome do módulo na raiz; nas páginas internas, o nome da seção (ou do módulo, se não houver). */
export function moduleTopTitle(info: ModuleInfo, path: string) {
  if (path === info.root) return info.title;
  const i = activeSectionIndex(info, path);
  return i >= 0 ? info.sections[i].label : info.title;
}
