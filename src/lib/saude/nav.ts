import { IdCard, Pill, Scissors, Stethoscope, Syringe, TestTube } from "lucide-react";

/** Abas da ferradura da Saúde. Carteirinhas é a raiz (/saude). */
export const SAUDE_TABS = [
  { key: "carteirinhas", href: "/saude", label: "Carteirinhas", icon: IdCard },
  { key: "consultas", href: "/saude/consultas", label: "Consultas", icon: Stethoscope },
  { key: "exames", href: "/saude/exames", label: "Exames", icon: TestTube },
  { key: "procedimentos", href: "/saude/procedimentos", label: "Procedimentos", icon: Scissors },
  { key: "medicamentos", href: "/saude/medicamentos", label: "Medicamentos", icon: Pill },
  { key: "vacinas", href: "/saude/vacinas", label: "Vacinas", icon: Syringe },
];
