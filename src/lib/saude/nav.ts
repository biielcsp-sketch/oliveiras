import { Activity, IdCard, Pill, Scissors, Stethoscope, Syringe, TestTube } from "lucide-react";

/** Abas da ferradura da Saúde. O Resumo é a raiz (/saude); Carteirinhas fica em /saude/carteirinhas. */
export const SAUDE_TABS = [
  { key: "resumo", href: "/saude", label: "Resumo", icon: Activity },
  { key: "carteirinhas", href: "/saude/carteirinhas", label: "Carteirinhas", icon: IdCard },
  { key: "consultas", href: "/saude/consultas", label: "Consultas", icon: Stethoscope },
  { key: "exames", href: "/saude/exames", label: "Exames", icon: TestTube },
  { key: "procedimentos", href: "/saude/procedimentos", label: "Procedimentos", icon: Scissors },
  { key: "medicamentos", href: "/saude/medicamentos", label: "Medicamentos", icon: Pill },
  { key: "vacinas", href: "/saude/vacinas", label: "Vacinas", icon: Syringe },
];
