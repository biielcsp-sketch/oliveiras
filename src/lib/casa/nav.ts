import { FileText, Home, ListChecks, Phone, Receipt, ShoppingCart, UtensilsCrossed, Wrench } from "lucide-react";

/**
 * Abas da ferradura da Casa. Resumo no meio (como nas Finanças): ao abrir a Casa ele já fica selecionado
 * no centro, com botões dos dois lados. Abas novas entram no fim da lista.
 */
export const CASA_TABS = [
  { key: "compras", href: "/casa/compras", label: "Compras", icon: ShoppingCart },
  { key: "cardapio", href: "/casa/cardapio", label: "Cardápio", icon: UtensilsCrossed },
  { key: "resumo", href: "/casa", label: "Resumo", icon: Home },
  { key: "tarefas", href: "/casa/tarefas", label: "Tarefas", icon: ListChecks },
  { key: "manutencao", href: "/casa/manutencao", label: "Manutenção", icon: Wrench },
  { key: "prestadores", href: "/casa/prestadores", label: "Prestadores", icon: Phone },
  { key: "contas", href: "/casa/contas", label: "Contas", icon: Receipt },
  { key: "documentos", href: "/casa/documentos", label: "Documentos", icon: FileText },
];
